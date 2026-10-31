import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { RunEvent } from '@sidekick/shared';
import { AgentService } from '../src/agent/agent.service.js';
import { loadConfig } from '../src/config.js';
import type { AppConfig } from '../src/config.js';
import { DatabaseService } from '../src/db/database.service.js';
import { KnowledgeService } from '../src/knowledge/knowledge.service.js';
import { LibraryService } from '../src/library/library.service.js';
import type { ModelMessage, ModelProvider } from '../src/llm/model-provider.js';
import { ToolsService } from '../src/tools/tools.service.js';

export const QUOTE_SKILL = `---
name: draft-quote
description: Write a quote.
allowed_tools: [create_quote, read_skill_file]
---
Quote steps.`;

export const NOTE_SKILL = `---
name: note
description: No tools at all.
allowed_tools: []
---
Note steps.`;

export function makeLibrary() {
  const dir = mkdtempSync(join(tmpdir(), 'sidekick-'));
  const files: Record<string, string> = {
    'rules/00-safety.md': '---\ntitle: Safety\npriority: 0\n---\nNever invent prices.',
    'rules/20-tone.md': '---\ntitle: Tone\npriority: 20\n---\nBe brief.',
    'skills/draft-quote/SKILL.md': QUOTE_SKILL,
    'skills/draft-quote/templates/quote.md': 'Template body',
    'skills/note/SKILL.md': NOTE_SKILL,
    'secret.txt': 'do not read',
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

export const testConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  ...loadConfig({}),
  databasePath: ':memory:',
  libraryDir: makeLibrary(),
  ...overrides,
});

/** Plays back scripted replies, and records every prompt it was sent. */
export class FakeModel implements ModelProvider {
  readonly prompts: ModelMessage[][] = [];

  constructor(private readonly replies: (string | string[] | Error)[]) {}

  async *stream(messages: ModelMessage[], options: { signal?: AbortSignal }) {
    this.prompts.push(messages);
    const reply = this.replies.shift();
    if (reply === undefined) throw new Error('FakeModel ran out of replies');
    if (reply instanceof Error) throw reply;
    for (const chunk of Array.isArray(reply) ? reply : [reply]) {
      options.signal?.throwIfAborted();
      yield chunk;
    }
  }
}

export const toolBlock = (tool: string, args: unknown = {}) =>
  `\`\`\`tool\n${JSON.stringify({ tool, args })}\n\`\`\``;

export function makeServices(model: ModelProvider, config = testConfig()) {
  const db = new DatabaseService(config);
  const library = new LibraryService(config);
  const knowledge = new KnowledgeService(db);
  const tools = new ToolsService(db, library, knowledge);
  const agent = new AgentService(model, db, library, tools);
  return { db, library, knowledge, tools, agent, config };
}

export async function collect(run: (emit: (event: RunEvent) => void) => Promise<void>) {
  const events: RunEvent[] = [];
  await run((event) => events.push(event));
  return events;
}

export const textOf = (events: RunEvent[]) =>
  events.flatMap((e) => (e.type === 'text' ? [e.text] : [])).join('');
