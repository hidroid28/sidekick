import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Citation, RunEvent } from '@sidekick/shared';
import { DatabaseService } from '../db/database.service.js';
import type { MessageRow } from '../db/database.service.js';
import { LibraryService } from '../library/library.service.js';
import { MODEL_PROVIDER, ModelError } from '../llm/model-provider.js';
import type { ModelMessage, ModelProvider } from '../llm/model-provider.js';
import { parseToolCall, ToolBlockFilter } from '../tools/protocol.js';
import { ToolsService } from '../tools/tools.service.js';
import { buildSystemPrompt, wrapUntrusted } from './prompt.js';

export const MAX_STEPS = 6;
const HISTORY_LIMIT = 20;

export type Emit = (event: RunEvent) => void;

/** Trims history, and attaches a photo only to the newest user message to save tokens. */
export function toModelMessages(system: string, rows: MessageRow[]): ModelMessage[] {
  const recent = rows.slice(-HISTORY_LIMIT);
  while (recent[0]?.role === 'assistant' || recent[0]?.role === 'call') recent.shift();
  const lastUser = recent.findLastIndex((r) => r.role === 'user');
  const history = recent.map((row, i): ModelMessage => {
    if (row.role === 'tool') return { role: 'user', text: wrapUntrusted('tool result', row.text) };
    // The model must see its own calls, or it repeats them.
    if (row.role === 'assistant' || row.role === 'call') return { role: 'assistant', text: row.text };
    return {
      role: 'user',
      text: row.text || 'See the attached photo.',
      ...(row.image && i === lastUser ? { image: JSON.parse(row.image) as ModelMessage['image'] } : {}),
    };
  });
  return [{ role: 'system', text: system }, ...history];
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    @Inject(MODEL_PROVIDER) private readonly model: ModelProvider,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(LibraryService) private readonly library: LibraryService,
    @Inject(ToolsService) private readonly tools: ToolsService,
  ) {}

  async run(conversationId: string, emit: Emit, signal: AbortSignal) {
    const citations: Citation[] = [];
    const seenCalls = new Set<string>();
    let visible = '';
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        visible = '';
        const filter = new ToolBlockFilter();
        for await (const chunk of this.model.stream(await this.prompt(conversationId), { signal })) {
          const text = filter.push(chunk);
          if (text) {
            visible += text;
            emit({ type: 'text', text });
          }
        }
        const end = filter.finish();
        if (end.text) {
          visible += end.text;
          emit({ type: 'text', text: end.text });
        }

        if (end.rawCall === undefined) {
          if (!visible.trim()) throw new ModelError('The model sent an empty reply. Please try again.');
          this.db.addMessage(conversationId, 'assistant', visible, { citations });
          if (citations.length) emit({ type: 'citations', citations });
          emit({ type: 'done' });
          return;
        }

        if (visible.trim()) this.db.addMessage(conversationId, 'assistant', visible);
        this.db.addMessage(conversationId, 'call', `\`\`\`tool\n${end.rawCall}\n\`\`\``);
        const call = parseToolCall(end.rawCall);
        if (!call) {
          this.db.addMessage(conversationId, 'tool', 'Error: the tool block was not valid JSON.');
          continue;
        }
        const callKey = JSON.stringify(call);
        if (seenCalls.has(callKey)) {
          const repeat = 'You already have this result. Do not repeat the call. Do the next step, or reply to the user.';
          this.db.addMessage(conversationId, 'tool', repeat);
          continue;
        }
        seenCalls.add(callKey);

        emit({ type: 'status', text: `Using ${call.tool}` });
        const outcome = await this.tools.dispatch(call, {
          conversationId,
          skill: await this.activeSkill(conversationId),
        });
        if (outcome.kind === 'approval') {
          emit({ type: 'approval', approval: outcome.approval });
          emit({ type: 'done' });
          return;
        }
        citations.push(...(outcome.citations ?? []));
        this.db.addMessage(conversationId, 'tool', outcome.text);
      }
      emit({ type: 'error', message: 'That took too many steps. Please try a simpler request.' });
    } catch (error) {
      if (signal.aborted) {
        if (visible.trim()) this.db.addMessage(conversationId, 'assistant', visible);
        emit({ type: 'done' });
        return;
      }
      this.logger.error(error);
      emit({
        type: 'error',
        message: error instanceof ModelError ? error.message : 'Something went wrong. Please try again.',
      });
    }
  }

  private async activeSkill(conversationId: string) {
    const name = this.db.getConversation(conversationId)?.active_skill;
    return name ? this.library.skill(name) : undefined;
  }

  private async prompt(conversationId: string) {
    const activeSkill = await this.activeSkill(conversationId);
    const system = buildSystemPrompt({
      rules: await this.library.rules(),
      skills: await this.library.skills(),
      activeSkill,
      tools: this.tools.available(activeSkill),
      profile: this.db.getProfile(),
      today: new Date().toISOString().slice(0, 10),
      documents: this.db.listDocuments().map((d) => d.name),
    });
    return toModelMessages(system, this.db.recentMessages(conversationId, HISTORY_LIMIT));
  }
}
