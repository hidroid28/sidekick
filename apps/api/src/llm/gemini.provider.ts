import { Inject, Injectable, Logger } from '@nestjs/common';
import { CONFIG } from '../config.js';
import type { AppConfig } from '../config.js';
import { ModelError } from './model-provider.js';
import type { ModelMessage, ModelProvider } from './model-provider.js';

interface Part { text?: string; thought?: boolean; inlineData?: { mimeType: string; data: string } }
interface Content { role: 'user' | 'model'; parts: Part[] }

/** Converts our messages to Gemini `contents`, merging neighbours with the same role. */
export function toGeminiRequest(messages: ModelMessage[], useSystemInstruction: boolean) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.text).join('\n\n');
  const contents: Content[] = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    const role = message.role === 'assistant' ? 'model' : 'user';
    const parts: Part[] = [{ text: message.text }];
    if (message.image) parts.push({ inlineData: message.image });
    const last = contents.at(-1);
    if (last?.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  }
  if (system && !useSystemInstruction) {
    const firstUser = contents.find((c) => c.role === 'user');
    if (firstUser) firstUser.parts.unshift({ text: system });
    else contents.unshift({ role: 'user', parts: [{ text: system }] });
  }
  return {
    contents,
    ...(system && useSystemInstruction ? { systemInstruction: { parts: [{ text: system }] } } : {}),
  };
}

/** Reads `data:` payloads from a server-sent event stream, across chunk boundaries. */
export async function* readSseData(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const clean = line.replace(/\r$/, '');
      if (clean.startsWith('data:')) yield clean.slice(5).trim();
    }
  }
  const last = (buffer + decoder.decode()).trim();
  if (last.startsWith('data:')) yield last.slice(5).trim();
}

function replyText(payload: string) {
  const reply = JSON.parse(payload) as { candidates?: { content?: { parts?: Part[] } }[] };
  const parts = reply.candidates?.[0]?.content?.parts ?? [];
  return parts.filter((p) => !p.thought && p.text).map((p) => p.text).join('');
}

@Injectable()
export class GeminiProvider implements ModelProvider {
  private readonly logger = new Logger(GeminiProvider.name);

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  async *stream(messages: ModelMessage[], options: { signal?: AbortSignal }) {
    const { apiKey, model, apiBase, useSystemInstruction } = this.config;
    if (!apiKey || !model) {
      throw new ModelError('The assistant is not set up yet. Add GOOGLE_API_KEY and GEMMA_MODEL to apps/api/.env.');
    }
    // The key goes in a header, so it can never appear in a logged URL.
    const response = await fetch(`${apiBase}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(toGeminiRequest(messages, useSystemInstruction)),
      signal: options.signal,
    });
    if (!response.ok || !response.body) {
      this.logger.warn(`Gemini API ${response.status}: ${(await response.text()).slice(0, 500)}`);
      throw new ModelError(
        response.status === 429
          ? 'The model is busy right now. Please try again in a minute.'
          : 'The model could not answer. Please try again.',
      );
    }
    for await (const payload of readSseData(response.body)) {
      if (payload === '[DONE]') return;
      const text = replyText(payload);
      if (text) yield text;
    }
  }
}
