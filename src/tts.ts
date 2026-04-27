import OpenAI from 'openai';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

const MAX_TTS_LENGTH = 4096;

let client: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (client) return client;
  const apiKey = readEnvFile(['OPENAI_API_KEY']).OPENAI_API_KEY;
  if (!apiKey) return null;
  client = new OpenAI({ apiKey });
  return client;
}

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

/**
 * Transform text into something a TTS engine can read naturally. Strips
 * markdown, replaces URLs/emails/paths with spoken equivalents, spells out
 * currency amounts, and expands common abbreviations.
 */
export function prepareForSpeech(text: string): string {
  let s = text;

  // Code blocks first — their contents might otherwise trip later rules
  s = s.replace(/```[\s\S]*?```/g, ' code omitted ');
  // Inline code — keep the identifier, drop the backticks
  s = s.replace(/`([^`]+)`/g, '$1');

  // Markdown links [text](url) → just the text
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Bare URLs → "link"
  s = s.replace(/https?:\/\/[^\s)]+/g, 'link');
  s = s.replace(/\bwww\.[^\s)]+/g, 'link');

  // Email addresses → "email address"
  s = s.replace(
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    'email address',
  );

  // Absolute-ish file paths → "file path"
  s = s.replace(/\/[A-Za-z0-9_\-./]+\.[A-Za-z]{1,5}\b/g, 'file path');

  // Currency: symbol/code optionally followed by space, then number with
  // optional thousands and decimals.
  s = s.replace(
    /\b(ZAR|USD|GBP|EUR|JPY|R)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\b/g,
    (_m, sym, num) => speakCurrency(sym, num),
  );
  s = s.replace(
    /([\$£€¥])\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/g,
    (_m, sym, num) => speakCurrency(sym, num),
  );

  // Markdown emphasis
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/\*([^*]+)\*/g, '$1');
  s = s.replace(/(^|\s)_([^_]+)_(?=\s|$|[.,!?;:])/g, '$1$2');
  s = s.replace(/~~([^~]+)~~/g, '$1');

  // Headers and bullet markers
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  s = s.replace(/^\s*[-*•]\s+/gm, '');

  // Common abbreviations
  s = s.replace(/\be\.g\.\s*/gi, 'for example, ');
  s = s.replace(/\bi\.e\.\s*/gi, 'that is, ');
  s = s.replace(/\betc\./gi, 'and so on');
  s = s.replace(/\bvs\.?/gi, 'versus');

  // Collapse whitespace — turn paragraph breaks into pauses
  s = s.replace(/\n{2,}/g, '. ');
  s = s.replace(/\n/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  // Clean up any double punctuation from paragraph-break substitution
  s = s.replace(/([.!?])\.\s/g, '$1 ');

  return s;
}

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
    const out = response.choices[0]?.message?.content?.trim();
    if (!out) return null;
    return out;
  } catch (err) {
    logger.warn({ err }, 'LLM speech rewrite failed, using regex fallback');
    return null;
  }
}

export async function synthesizeSpeech(text: string): Promise<Buffer | null> {
  const c = getClient();
  if (!c) {
    logger.warn('OPENAI_API_KEY not set, cannot synthesize speech');
    return null;
  }
  const llmVersion = await rewriteForSpeech(text);
  const speakable = llmVersion ?? prepareForSpeech(text);
  if (speakable.length > MAX_TTS_LENGTH) {
    logger.warn(
      { length: speakable.length, max: MAX_TTS_LENGTH },
      'Text too long for TTS, falling back to text',
    );
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
    logger.info(
      { usedLLM: !!llmVersion, originalLength: text.length, speakableLength: speakable.length },
      'Speech synthesis completed',
    );
    return Buffer.from(arrayBuffer);
  } catch (err) {
    logger.error({ err }, 'TTS synthesis failed');
    return null;
  }
}
