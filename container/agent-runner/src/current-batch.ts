/**
 * Per-batch context the poll loop publishes for downstream consumers
 * (MCP tools, etc.) that don't sit on the poll-loop's call stack.
 *
 * Today the only field is `inReplyTo` — the id of the first inbound
 * message in the batch the agent is currently processing. MCP tools like
 * `send_message` and `send_file` read this and stamp it onto the outbound
 * row so the host's a2a return-path routing can correlate replies back to
 * the originating session.
 *
 * This is module-level state on purpose: the agent-runner is single-process
 * and processes one batch at a time. Poll-loop calls `setCurrentInReplyTo`
 * before invoking the provider and `clearCurrentInReplyTo` after the batch
 * completes (or errors out).
 */
let currentInReplyTo: string | null = null;

export function setCurrentInReplyTo(id: string | null): void {
  currentInReplyTo = id;
}

export function clearCurrentInReplyTo(): void {
  currentInReplyTo = null;
  sentInBatch.clear();
}

export function getCurrentInReplyTo(): string | null {
  return currentInReplyTo;
}

/**
 * Per-batch dedup tracking — fingerprints of content already sent during
 * this batch via send_message / send_file tool calls or earlier <message>
 * blocks in the same final-response text.
 *
 * Why this exists: when the model emits the same content via both a mid-turn
 * tool call (mcp__nanoclaw__send_message) AND a final-response <message>
 * block — or repeats the same <message> block twice in one final response —
 * the user sees the same reply two or three times within seconds. The
 * agent-runner has no way to know the model intended a duplicate vs.
 * intentionally distinct messages, so we conservatively suppress duplicates
 * keyed on (destination, content hash) within a single batch.
 *
 * Cleared by `clearCurrentInReplyTo` at end of each batch, so the same
 * content can be sent again on the next user message (e.g. a periodic
 * reminder template that happens to repeat).
 */
const sentInBatch = new Set<string>();

function fingerprint(destinationKey: string, content: string): string {
  // Normalise whitespace + URL formatting so the model emitting slightly
  // different but semantically identical text still dedups. Keep it cheap.
  const normalised = content
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // strip markdown link URLs
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return `${destinationKey}:${normalised}`;
}

/**
 * Record that a message was sent this batch. Returns true if this is the
 * first time the (destination, content) pair has been seen — i.e. the
 * caller should proceed with the send. Returns false if it's a duplicate
 * and the caller should skip.
 */
export function shouldSendInBatch(destinationKey: string, content: string): boolean {
  const fp = fingerprint(destinationKey, content);
  if (sentInBatch.has(fp)) return false;
  sentInBatch.add(fp);
  return true;
}

