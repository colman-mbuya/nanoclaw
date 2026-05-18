/**
 * TTS mirror — when the user sends a voice note, also reply with a voice
 * note alongside the text. Uses OpenAI's `gpt-4o-mini` to rewrite the
 * agent's reply into TTS-friendly prose (URLs → "link", currency spelled
 * out, markdown stripped), then `tts-1` with the `onyx` voice to produce
 * an opus audio buffer.
 *
 * Per-chat state ("last inbound was voice") is volatile, kept in an
 * in-memory Map on the host process. On host restart, the flag resets to
 * false; voice mirroring resumes after the user sends their next voice
 * note. This is acceptable — the alternative (persisting in v2.db on every
 * inbound) is more invasive for the same UX.
 *
 * All failure modes are silent + non-blocking: if the key is missing, the
 * LLM call errors, or the synthesis fails, the agent's text reply still
 * goes out. The voice note is purely additive.
 */
import OpenAI from 'openai';

import { readEnvFile } from '../../env.js';
import { log } from '../../log.js';

const MAX_TTS_LENGTH = 4096;

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (cachedClient) return cachedClient;
  const apiKey = readEnvFile(['OPENAI_API_KEY']).OPENAI_API_KEY;
  if (!apiKey) return null;
  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

// Per-platformId flag. true = the most recent inbound was a voice note.
const lastInboundWasVoice = new Map<string, boolean>();

export function markInboundVoice(platformId: string, isVoice: boolean): void {
  lastInboundWasVoice.set(platformId, isVoice);
}

export function shouldMirrorVoice(platformId: string): boolean {
  return lastInboundWasVoice.get(platformId) === true;
}

// --- Speech prep helpers (ported from v1's fork) ---

const CURRENCY_INFO: Record<string, { major: string; minor: string | null }> = {
  R: { major: 'rand', minor: 'cents' },
  ZAR: { major: 'rand', minor: 'cents' },
  $: { major: 'dollars', minor: 'cents' },
  USD: { major: 'dollars', minor: 'cents' },
  '£': { major: 'pounds', minor: 'pence' },
  GBP: { major: 'pounds', minor: 'pence' },
  '€': { major: 'euros', minor: 'cents' },
  EUR: { major: 'euros', minor: 'cents' },
  '¥': { major: 'yen', minor: null },
  JPY: { major: 'yen', minor: null },
};

function speakCurrency(symbol: string, numStr: string): string {
  const info = CURRENCY_INFO[symbol];
  if (!info) return `${symbol}${numStr}`;
  const cleaned = numStr.replace(/,/g, '');
  const [majorStr, minorStr] = cleaned.split('.');
  const major = parseInt(majorStr, 10);
  if (!minorStr || !info.minor) return `${major} ${info.major}`;
  const minor = parseInt(minorStr.padEnd(2, '0'), 10);
  if (minor === 0) return `${major} ${info.major}`;
  return `${major} ${info.major} and ${minor} ${info.minor}`;
}

/** Regex fallback when the LLM rewrite is unavailable. */
export function prepareForSpeech(text: string): string {
  let s = text;
  s = s.replace(/```[\s\S]*?```/g, ' code omitted ');
  s = s.replace(/`([^`]+)`/g, '$1');
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  s = s.replace(/https?:\/\/[^\s)]+/g, 'link');
  s = s.replace(/\bwww\.[^\s)]+/g, 'link');
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'email address');
  s = s.replace(/\/[A-Za-z0-9_\-./]+\.[A-Za-z]{1,5}\b/g, 'file path');
  s = s.replace(/\b(ZAR|USD|GBP|EUR|JPY|R)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\b/g, (_m, sym, num) =>
    speakCurrency(sym, num),
  );
  s = s.replace(/([\$£€¥])\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/g, (_m, sym, num) => speakCurrency(sym, num));
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/\*([^*]+)\*/g, '$1');
  s = s.replace(/(^|\s)_([^_]+)_(?=\s|$|[.,!?;:])/g, '$1$2');
  s = s.replace(/~~([^~]+)~~/g, '$1');
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  s = s.replace(/^\s*[-*•]\s+/gm, '');
  s = s.replace(/\be\.g\.\s*/gi, 'for example, ');
  s = s.replace(/\bi\.e\.\s*/gi, 'that is, ');
  s = s.replace(/\betc\./gi, 'and so on');
  s = s.replace(/\bvs\.?/gi, 'versus');
  s = s.replace(/\n{2,}/g, '. ');
  s = s.replace(/\n/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/([.!?])\.\s/g, '$1 ');
  return s;
}

const SPEECH_REWRITE_SYSTEM_PROMPT = `You rewrite text so it reads naturally when spoken by a text-to-speech engine.

Rules:
- Remove all markdown syntax (bold, italic, headers, bullets, inline and block code markers) but keep the underlying words.
- Replace URLs with natural phrases like "a link" or drop them if awkward. If the text has a markdown link, keep only the link text.
- Replace email addresses with "an email address" unless the specific address matters.
- Replace code blocks with a brief mention, e.g. "here's a code snippet", rather than reading them character-by-character.
- Spell currency amounts as words. Example: "R25.82" becomes "twenty-five rand and eighty-two cents". Handle R, $, £, €, ¥ and the codes ZAR, USD, GBP, EUR, JPY.
- Keep numbers, dates, and times as digits — the TTS engine handles those well.
- Convert short bullet lists into flowing prose when it sounds more natural aloud.
- Expand obvious abbreviations where a reader would hesitate (e.g. "vs" → "versus").
- Preserve the original meaning, tone, and roughly the same length. Do not shorten by dropping important content.
- Do not add greetings, disclaimers, or commentary. Return ONLY the rewritten text.`;

async function rewriteForSpeech(text: string): Promise<string | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const response = await c.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SPEECH_REWRITE_SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      temperature: 0.3,
    });
    return response.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    log.debug('LLM speech rewrite failed, using regex fallback', { err });
    return null;
  }
}

/** Synthesize text to an opus audio buffer suitable for WhatsApp voice notes. */
export async function synthesizeSpeech(text: string): Promise<Buffer | null> {
  const c = getClient();
  if (!c) return null;
  const llmVersion = await rewriteForSpeech(text);
  const speakable = llmVersion ?? prepareForSpeech(text);
  if (speakable.length > MAX_TTS_LENGTH) {
    log.debug('Text too long for TTS, skipping voice mirror', {
      length: speakable.length,
      max: MAX_TTS_LENGTH,
    });
    return null;
  }
  try {
    const response = await c.audio.speech.create({
      model: 'tts-1',
      voice: 'onyx',
      input: speakable,
      response_format: 'opus',
    });
    const arrayBuffer = await response.arrayBuffer();
    log.info('TTS synthesis completed', {
      usedLLM: !!llmVersion,
      originalLength: text.length,
      speakableLength: speakable.length,
    });
    return Buffer.from(arrayBuffer);
  } catch (err) {
    log.warn('TTS synthesis failed', { err });
    return null;
  }
}
