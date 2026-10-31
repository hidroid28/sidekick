import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { RunEvent } from '@sidekick/shared';
import { AppModule } from '../src/app.module.js';
import { CONFIG } from '../src/config.js';
import { configureApp } from '../src/configure.js';
import { MODEL_PROVIDER } from '../src/llm/model-provider.js';
import { FakeModel, testConfig, toolBlock } from './helpers.js';

const QUOTE = { client: 'Sunrise', items: [{ description: 'Uniform', quantity: 3, unit_price: 100 }] };

describe('HTTP API', () => {
  let app: NestExpressApplication;
  let base: string;
  let model: FakeModel;
  const script: (string | string[] | Error)[] = [];

  const json = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${base}${path}`, {
      headers: { 'content-type': 'application/json' },
      ...init,
    });
    return { status: response.status, body: (await response.json()) as any };
  };
  const post = (path: string, body: unknown) => json(path, { method: 'POST', body: JSON.stringify(body) });

  const events = async (runId: string) => {
    const response = await fetch(`${base}/runs/${runId}/events`);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const text = await response.text();
    return text
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)) as RunEvent);
  };

  beforeEach(async () => {
    script.length = 0;
    model = new FakeModel(script);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG)
      .useValue(testConfig())
      .overrideProvider(MODEL_PROVIDER)
      .useValue(model)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
    configureApp(app, app.get(CONFIG));
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');
  });

  afterEach(() => app.close());

  it('streams a reply over the two-step flow and saves history', async () => {
    script.push(['Hi ', 'there']);
    const { body: conversation } = await post('/conversations', {});
    const { status, body } = await post(`/conversations/${conversation.id}/messages`, { text: 'hello' });
    expect(status).toBe(201);
    const stream = await events(body.runId);
    expect(stream).toEqual([
      { type: 'text', text: 'Hi ' },
      { type: 'text', text: 'there' },
      { type: 'done' },
    ]);
    const { body: detail } = await json(`/conversations/${conversation.id}`);
    expect(detail.title).toBe('hello');
    expect(detail.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
  });

  it('runs a whole quote: slash skill, approval, then record', async () => {
    script.push(toolBlock('create_quote', QUOTE), 'Saved your quote.');
    const { body: conversation } = await post('/conversations', {});
    const sent = await post(`/conversations/${conversation.id}/messages`, { text: '/draft-quote 3 uniforms' });
    const approval = (await events(sent.body.runId)).find((e) => e.type === 'approval');
    if (approval?.type !== 'approval') throw new Error('expected an approval');
    expect(approval.approval.summary).toContain('300.00');
    expect((await json('/records')).body).toEqual([]);

    const blocked = await post(`/conversations/${conversation.id}/messages`, { text: 'hi' });
    expect(blocked.status).toBe(409);

    const decided = await post(`/approvals/${approval.approval.id}/decision`, { approve: true });
    expect(decided.status).toBe(201);
    expect((await events(decided.body.runId)).at(0)).toEqual({ type: 'text', text: 'Saved your quote.' });
    expect((await json('/records')).body[0]).toMatchObject({ kind: 'quote', amountCents: 30000 });
  });

  it('never runs an approved action twice', async () => {
    script.push(toolBlock('create_quote', QUOTE), 'Saved.', 'Should not be used.');
    const { body: conversation } = await post('/conversations', {});
    const sent = await post(`/conversations/${conversation.id}/messages`, { text: '/draft-quote x' });
    const approval = (await events(sent.body.runId)).find((e) => e.type === 'approval');
    if (approval?.type !== 'approval') throw new Error('expected an approval');
    const path = `/approvals/${approval.approval.id}/decision`;
    const first = await post(path, { approve: true });
    await events(first.body.runId);
    expect((await post(path, { approve: true })).status).toBe(409);
    expect((await json('/records')).body).toHaveLength(1);
  });

  it('saves nothing when an action is declined', async () => {
    script.push(toolBlock('create_quote', QUOTE), 'Okay, nothing saved.');
    const { body: conversation } = await post('/conversations', {});
    const sent = await post(`/conversations/${conversation.id}/messages`, { text: '/draft-quote x' });
    const approval = (await events(sent.body.runId)).find((e) => e.type === 'approval');
    if (approval?.type !== 'approval') throw new Error('expected an approval');
    const decided = await post(`/approvals/${approval.approval.id}/decision`, { approve: false });
    await events(decided.body.runId);
    expect((await json('/records')).body).toEqual([]);
    expect(model.prompts.at(-1)!.at(-1)!.text).toContain('The user declined');
  });

  it('treats an unknown slash command as ordinary text', async () => {
    script.push('ok');
    const { body: conversation } = await post('/conversations', {});
    const sent = await post(`/conversations/${conversation.id}/messages`, { text: '/nope hello' });
    await events(sent.body.runId);
    const { body: detail } = await json(`/conversations/${conversation.id}`);
    expect(detail.activeSkill).toBeNull();
    expect(detail.messages[0].text).toBe('/nope hello');
  });

  it('accepts a large photo within the body limit', async () => {
    script.push('Got it');
    const { body: conversation } = await post('/conversations', {});
    const image = { mimeType: 'image/jpeg', data: 'a'.repeat(5_000_000) };
    const sent = await post(`/conversations/${conversation.id}/messages`, { text: '', image });
    expect(sent.status).toBe(201);
    await events(sent.body.runId);
    expect(model.prompts[0]!.at(-1)!.image).toBeDefined();
  });

  it('returns useful errors', async () => {
    const { body: conversation } = await post('/conversations', {});
    expect((await post(`/conversations/${conversation.id}/messages`, { text: '' })).status).toBe(400);
    expect((await post('/conversations/missing/messages', { text: 'hi' })).status).toBe(404);
    expect((await post('/approvals/missing/decision', { approve: true })).status).toBe(404);
    expect((await json('/runs/missing/events')).status).toBe(404);
  });

  it('saves and reads the profile', async () => {
    const profile = { name: 'Mwila', work: 'Tailor', currency: 'ZMW' };
    await json('/profile', { method: 'PUT', body: JSON.stringify(profile) });
    expect((await json('/profile')).body).toEqual(profile);
  });

  it('uploads, lists, and deletes a document', async () => {
    const data = Buffer.from('The deposit is 40%.').toString('base64');
    const { status } = await post('/documents', { name: 'c.txt', mimeType: 'text/plain', data });
    expect(status).toBe(201);
    const [document] = (await json('/documents')).body;
    expect(document).toMatchObject({ name: 'c.txt', parts: 1 });
    expect((await json(`/documents/${document.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await json('/documents')).body).toEqual([]);
  });

  it('refuses unsupported upload types', async () => {
    const response = await post('/documents', { name: 'a.exe', mimeType: 'application/x-msdownload', data: 'AAAA' });
    expect(response.status).toBe(400);
  });

  it('lists and edits the library', async () => {
    const items = (await json('/library')).body as { kind: string; name: string }[];
    expect(items.some((i) => i.kind === 'skills' && i.name === 'draft-quote')).toBe(true);
    const content = '---\ntitle: Tone\npriority: 20\n---\nSpeak like a pirate.';
    expect((await json('/library/rules/20-tone', { method: 'PUT', body: JSON.stringify({ content }) })).status).toBe(200);
    expect((await json('/library/rules/20-tone')).body.content).toBe(content);
  });
});
