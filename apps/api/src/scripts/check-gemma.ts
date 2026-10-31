/**
 * Step 1 of the build: tests what your key and Gemma 4 model really support.
 * Run with `npm run check:gemma`. It sends a few small requests to the Gemini API.
 */
import { loadConfig } from '../config.js';

const config = loadConfig();
if (!config.apiKey) {
  console.error('GOOGLE_API_KEY is missing. Add it to apps/api/.env first.');
  process.exit(1);
}
const headers = { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey };

const listing = await fetch(`${config.apiBase}/models?pageSize=200`, { headers, signal: AbortSignal.timeout(30_000) });
if (!listing.ok) {
  console.error(`Could not list models: HTTP ${listing.status}`);
  process.exit(1);
}
const { models = [] } = (await listing.json()) as { models?: { name: string }[] };
const gemma = models.map((m) => m.name.replace('models/', '')).filter((n) => n.includes('gemma-4'));
console.log('Gemma 4 models on this key:', gemma.length ? gemma.join(', ') : 'none');

const model = config.model;
if (!model) {
  console.log('Set GEMMA_MODEL in apps/api/.env to one of these, then run this again.');
  process.exit(0);
}

const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const user = (text: string) => [{ role: 'user', parts: [{ text }] }];
const checks: [string, Record<string, unknown>][] = [
  ['plain text', { contents: user('Reply with the word ok.') }],
  ['systemInstruction', { contents: user('Say hi.'), systemInstruction: { parts: [{ text: 'Be brief.' }] } }],
  ['JSON mode', { contents: user('Give {"ok":true}.'), generationConfig: { responseMimeType: 'application/json' } }],
  ['image input', {
    contents: [{ role: 'user', parts: [{ text: 'What is this?' }, { inlineData: { mimeType: 'image/png', data: PIXEL } }] }],
  }],
  ['native tools', {
    contents: user('Call ping.'),
    tools: [{ functionDeclarations: [{ name: 'ping', description: 'Ping' }] }],
  }],
  ['text tool protocol', {
    contents: user('Reply with only a fenced code block with the language tag tool, containing {"tool":"ping","args":{}}.'),
  }],
];

const TIMEOUT_MS = 90_000;
for (const [name, body] of checks) {
  const started = Date.now();
  const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
  try {
    const response = await fetch(`${config.apiBase}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    const ok = name === 'text tool protocol' ? response.ok && text.includes('tool') : response.ok;
    const detail = ok ? '' : `  ${text.replace(/\s+/g, ' ').slice(0, 220)}`;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (HTTP ${response.status}, ${elapsed()})${detail}`);
  } catch (error) {
    const reason = error instanceof Error ? error.name : 'error';
    console.log(`FAIL  ${name}  (${reason} after ${elapsed()})`);
  }
}
console.log('If systemInstruction passes, you can set GEMMA_USE_SYSTEM_INSTRUCTION=true.');
