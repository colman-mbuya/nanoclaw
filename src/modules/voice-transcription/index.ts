/**
 * Voice transcription — converts WhatsApp voice notes to text before they
 * reach the agent. The agent sees `[Voice: <transcript>]` instead of an
 * opaque audio attachment.
 *
 * Detection: ptt=true (recorded voice notes) OR opus codec mimetype
 * (catches forwarded voice notes, which lose the ptt flag).
 *
 * Failure mode: returns null on any error (missing key, API failure, file
 * read error) — the channel adapter falls back to leaving the audio
 * attachment in place untouched.
 */
import fs from 'fs';

import OpenAI from 'openai';

import { readEnvFile } from '../../env.js';

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (cachedClient) return cachedClient;
  const apiKey = readEnvFile(['OPENAI_API_KEY']).OPENAI_API_KEY;
  if (!apiKey) return null;
  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

export function isVoiceMessage(audioMessage: { ptt?: boolean | null; mimetype?: string | null }): boolean {
  if (audioMessage.ptt === true) return true;
  return /opus/i.test(audioMessage.mimetype || '');
}

/**
 * Read an audio file from disk, transcribe via OpenAI Whisper, return the
 * transcript or null on any failure.
 */
export async function transcribeAudioFile(localPath: string): Promise<string | null> {
  const client = getClient();
  if (!client) return null;
  try {
    const buffer = fs.readFileSync(localPath);
    const file = await OpenAI.toFile(buffer, 'voice.ogg', { type: 'audio/ogg' });
    const transcript = await client.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      response_format: 'text',
    });
    return (transcript as unknown as string).trim() || null;
  } catch {
    return null;
  }
}
