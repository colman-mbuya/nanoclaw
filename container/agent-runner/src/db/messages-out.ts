/**
 * Outbound message operations (container side).
 *
 * Writes to outbound.db (container-owned).
 * The host polls this DB (read-only) for undelivered messages.
 */
import { getInboundDb, getOutboundDb } from './connection.js';

export interface MessageOutRow {
  id: string;
  seq: number | null;
  in_reply_to: string | null;
  timestamp: string;
  deliver_after: string | null;
  recurrence: string | null;
  kind: string;
  platform_id: string | null;
  channel_type: string | null;
  thread_id: string | null;
  content: string;
}

export interface WriteMessageOut {
  id: string;
  in_reply_to?: string | null;
  deliver_after?: string | null;
  recurrence?: string | null;
  kind: string;
  platform_id?: string | null;
  channel_type?: string | null;
  thread_id?: string | null;
  content: string;
}

/**
 * Normalise an outbound message's text for duplicate comparison. Returns null
 * when the message should never be deduped (edits/reactions, file-only sends,
 * empty text). Mirrors the fingerprinting in current-batch.ts so both layers
 * agree on what "the same message" means.
 */
function normalizeForDedup(content: string): string | null {
  let text: string;
  try {
    const parsed = JSON.parse(content) as { text?: unknown; files?: unknown; operation?: unknown };
    if (parsed.operation) return null; // edit / reaction — never dedup
    const hasFiles = Array.isArray(parsed.files) && parsed.files.length > 0;
    text = typeof parsed.text === 'string' ? parsed.text : '';
    if (hasFiles && text.trim() === '') return null; // file-only send
  } catch {
    text = content;
  }
  if (text.trim() === '') return null;
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // strip markdown link URLs
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Cross-process duplicate suppression. The MCP tool server (send_message /
 * send_file) runs in a SEPARATE process from the poll-loop that dispatches
 * <message> blocks, so the in-memory per-batch dedup in current-batch.ts
 * cannot catch a reply the model emitted via BOTH paths — each process has
 * its own state. outbound.db is the only shared medium, so we dedup here:
 * if an equivalent chat message (same destination + normalized text) was
 * written in the last 30 seconds, skip the insert and reuse the prior seq.
 *
 * The 30s window catches the dual-path duplicate (the two sends land within
 * seconds) without suppressing a genuinely repeated template (reminders etc.)
 * that recurs minutes or hours apart in a later batch.
 */
function findRecentDuplicateSeq(
  outbound: ReturnType<typeof getOutboundDb>,
  msg: WriteMessageOut,
): number | null {
  if (msg.kind !== 'chat') return null;
  const norm = normalizeForDedup(msg.content);
  if (norm === null) return null;
  const rows = outbound
    .prepare(
      `SELECT seq, content FROM messages_out
       WHERE kind = 'chat'
         AND IFNULL(platform_id, '') = IFNULL($platform_id, '')
         AND IFNULL(channel_type, '') = IFNULL($channel_type, '')
         AND IFNULL(thread_id, '') = IFNULL($thread_id, '')
         AND timestamp >= datetime('now', '-30 seconds')`,
    )
    .all({
      $platform_id: msg.platform_id ?? null,
      $channel_type: msg.channel_type ?? null,
      $thread_id: msg.thread_id ?? null,
    }) as { seq: number; content: string }[];
  for (const r of rows) {
    if (normalizeForDedup(r.content) === norm) return r.seq;
  }
  return null;
}

/**
 * Write a new outbound message, auto-assigning an odd seq number.
 * Container uses odd seq (1, 3, 5...), host uses even (2, 4, 6...).
 *
 * The disjoint namespace is load-bearing, not just collision avoidance:
 * seq is the agent-facing message ID returned by send_message and accepted
 * by edit_message / add_reaction, and getMessageIdBySeq() below looks up
 * by seq across BOTH tables. If inbound and outbound could share a seq,
 * the agent's "edit message #5" could resolve to the wrong row.
 */
export function writeMessageOut(msg: WriteMessageOut): number {
  const outbound = getOutboundDb();
  const inbound = getInboundDb();

  // Cross-process duplicate suppression (see findRecentDuplicateSeq). Returns
  // the existing row's seq so callers still get a valid id, but no second
  // physical message is delivered.
  const dupSeq = findRecentDuplicateSeq(outbound, msg);
  if (dupSeq !== null) {
    console.error(`[messages-out] suppressed cross-process duplicate → reusing seq ${dupSeq}`);
    return dupSeq;
  }

  // Read max seq from both DBs to maintain global ordering.
  // Safe: each side only reads the other DB, never writes to it.
  const maxOut = (outbound.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM messages_out').get() as { m: number }).m;
  const maxIn = (inbound.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM messages_in').get() as { m: number }).m;
  const max = Math.max(maxOut, maxIn);
  const nextSeq = max % 2 === 0 ? max + 1 : max + 2; // next odd

  // bun:sqlite requires named parameters to be passed with the prefix character
  // in the JS object keys (better-sqlite3 auto-stripped it, bun:sqlite does not).
  outbound
    .prepare(
      `INSERT INTO messages_out (id, seq, in_reply_to, timestamp, deliver_after, recurrence, kind, platform_id, channel_type, thread_id, content)
     VALUES ($id, $seq, $in_reply_to, datetime('now'), $deliver_after, $recurrence, $kind, $platform_id, $channel_type, $thread_id, $content)`,
    )
    .run({
      $id: msg.id,
      $seq: nextSeq,
      $in_reply_to: msg.in_reply_to ?? null,
      $deliver_after: msg.deliver_after ?? null,
      $recurrence: msg.recurrence ?? null,
      $kind: msg.kind,
      $platform_id: msg.platform_id ?? null,
      $channel_type: msg.channel_type ?? null,
      $thread_id: msg.thread_id ?? null,
      $content: msg.content,
    });

  return nextSeq;
}

/**
 * Look up a message's platform ID by seq number.
 * Searches both inbound and outbound DBs since seq spans both.
 *
 * For inbound messages, the Chat SDK message ID is already the platform message ID
 * (e.g., "6037840640:42" for Telegram).
 *
 * For outbound messages, the internal ID (msg-xxx) won't work for edits/reactions.
 * Instead, look up the platform_message_id from the delivered table (host writes this
 * after successful delivery).
 */
export function getMessageIdBySeq(seq: number): string | null {
  const inbound = getInboundDb();

  // Inbound messages: ID is already the platform message ID
  const inRow = inbound.prepare('SELECT id FROM messages_in WHERE seq = ?').get(seq) as
    | { id: string }
    | undefined;
  if (inRow) return inRow.id;

  // Outbound messages: look up platform message ID from delivered table
  const outRow = getOutboundDb().prepare('SELECT id FROM messages_out WHERE seq = ?').get(seq) as
    | { id: string }
    | undefined;
  if (!outRow) return null;

  // Check if host has stored the platform message ID after delivery
  const deliveredRow = inbound
    .prepare('SELECT platform_message_id FROM delivered WHERE message_out_id = ?')
    .get(outRow.id) as { platform_message_id: string | null } | undefined;
  if (deliveredRow?.platform_message_id) return deliveredRow.platform_message_id;

  // Fallback to internal ID (edits/reactions on undelivered messages won't work)
  return outRow.id;
}

/**
 * Look up the routing fields for a message by seq (for edit/reaction targeting).
 * Returns the channel_type, platform_id, thread_id of the referenced message.
 */
export function getRoutingBySeq(
  seq: number,
): { channel_type: string | null; platform_id: string | null; thread_id: string | null } | null {
  const inbound = getInboundDb();
  const inRow = inbound
    .prepare('SELECT channel_type, platform_id, thread_id FROM messages_in WHERE seq = ?')
    .get(seq) as { channel_type: string | null; platform_id: string | null; thread_id: string | null } | undefined;
  if (inRow) return inRow;

  const outRow = getOutboundDb()
    .prepare('SELECT channel_type, platform_id, thread_id FROM messages_out WHERE seq = ?')
    .get(seq) as { channel_type: string | null; platform_id: string | null; thread_id: string | null } | undefined;
  return outRow ?? null;
}

/** Get undelivered messages (for host polling — reads from outbound.db). */
export function getUndeliveredMessages(): MessageOutRow[] {
  return getOutboundDb()
    .prepare(
      `SELECT * FROM messages_out
       WHERE (deliver_after IS NULL OR deliver_after <= datetime('now'))
       ORDER BY timestamp ASC`,
    )
    .all() as MessageOutRow[];
}
