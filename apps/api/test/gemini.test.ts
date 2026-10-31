import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider, readSseData, toGeminiRequest } from '../src/llm/gemini.provider.js';
import type { ModelMessage } from '../src/llm/model-provider.js';
import { testConfig } from './helpers.js';

const encoder = new TextEncoder();
const streamOf = (...chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(encoder.encode(c)));
      controller.close();
    },
  });

const sse = (parts: unknown[]) => `data: ${JSON.stringify({ candidates: [{ content: { parts } }] })}\n\n`;
const config = () => testConfig({ apiKey: 'test-key', model: 'gemma-test' });

async function all<T>(source: AsyncIterable<T>) {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
}

const messages: ModelMessage[] = [
  { role: 'system', text: 'Rules' },
  { role: 'user', text: 'Hi' },
];

afterEach(() => vi.unstubAllGlobals());

describe('toGeminiRequest', () => {
  it('puts the system text in the first user message by default', () => {
    const request = toGeminiRequest(messages, false);
    expect(request.contents).toEqual([{ role: 'user', parts: [{ text: 'Rules' }, { text: 'Hi' }] }]);
    expect(request).not.toHaveProperty('systemInstruction');
  });

  it('uses systemInstruction when turned on', () => {
    const request = toGeminiRequest(messages, true);
    expect(request.systemInstruction).toEqual({ parts: [{ text: 'Rules' }] });
    expect(request.contents).toEqual([{ role: 'user', parts: [{ text: 'Hi' }] }]);
  });

  it('merges neighbouring roles and maps assistant to model', () => {
    const { contents } = toGeminiRequest(
      [
        { role: 'user', text: 'a' },
        { role: 'user', text: 'b' },
        { role: 'assistant', text: 'c' },
      ],
      false,
    );
    expect(contents.map((c) => c.role)).toEqual(['user', 'model']);
    expect(contents[0]!.parts).toHaveLength(2);
  });

  it('attaches images as inline data', () => {
    const image = { mimeType: 'image/png' as const, data: 'abc' };
    const { contents } = toGeminiRequest([{ role: 'user', text: 'a', image }], false);
    expect(contents[0]!.parts[1]).toEqual({ inlineData: image });
  });
});

describe('readSseData', () => {
  it('rebuilds events split across chunks, with CRLF', async () => {
    expect(await all(readSseData(streamOf('data: {"a"', ':1}\r\n\r\ndata: 2\n')))).toEqual(['{"a":1}', '2']);
  });

  it('keeps multi-byte text split across chunks', async () => {
    const bytes = encoder.encode('data: é\n');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 7));
        controller.enqueue(bytes.slice(7));
        controller.close();
      },
    });
    expect(await all(readSseData(body))).toEqual(['é']);
  });

  it('reads a final event with no newline and skips other lines', async () => {
    expect(await all(readSseData(streamOf(': comment\nevent: x\ndata: last')))).toEqual(['last']);
  });
});

describe('GeminiProvider', () => {
  it('sends the key in a header, not the URL', async () => {
    const fetchMock = vi.fn(async () => new Response(streamOf(sse([{ text: 'Hi' }]))));
    vi.stubGlobal('fetch', fetchMock);
    await all(new GeminiProvider(config()).stream(messages, {}));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/models/gemma-test:streamGenerateContent?alt=sse');
    expect(url).not.toContain('test-key');
    expect(init.headers).toMatchObject({ 'x-goog-api-key': 'test-key' });
  });

  it('drops thought parts', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(streamOf(sse([{ text: 'secret plan', thought: true }, { text: 'Answer' }]))));
    expect(await all(new GeminiProvider(config()).stream(messages, {}))).toEqual(['Answer']);
  });

  it('skips blocked replies with no parts', async () => {
    vi.stubGlobal('fetch', async () => new Response(streamOf('data: {"candidates":[{"finishReason":"SAFETY"}]}\n\n')));
    expect(await all(new GeminiProvider(config()).stream(messages, {}))).toEqual([]);
  });

  it('explains missing setup without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(all(new GeminiProvider(testConfig()).stream(messages, {}))).rejects.toThrow(/GOOGLE_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns rate limits into a friendly message', async () => {
    vi.stubGlobal('fetch', async () => new Response('quota', { status: 429 }));
    await expect(all(new GeminiProvider(config()).stream(messages, {}))).rejects.toThrow(/busy/);
  });

  it('keeps upstream error bodies away from the user', async () => {
    vi.stubGlobal('fetch', async () => new Response('internal detail', { status: 500 }));
    await expect(all(new GeminiProvider(config()).stream(messages, {}))).rejects.toThrow('The model could not answer. Please try again.');
  });
});
