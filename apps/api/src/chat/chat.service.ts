import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ChatMessage, SendMessage } from '@sidekick/shared';
import { AgentService } from '../agent/agent.service.js';
import { parseSlashCommand } from '../agent/prompt.js';
import { DatabaseService } from '../db/database.service.js';
import type { MessageRow } from '../db/database.service.js';
import { LibraryService } from '../library/library.service.js';
import { ToolsService } from '../tools/tools.service.js';
import { RunsService } from './runs.service.js';

export function toChatMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    text: row.text,
    hasImage: row.image !== null,
    citations: row.citations ? JSON.parse(row.citations) : [],
    createdAt: row.created_at,
  };
}

@Injectable()
export class ChatService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(LibraryService) private readonly library: LibraryService,
    @Inject(AgentService) private readonly agent: AgentService,
    @Inject(RunsService) private readonly runs: RunsService,
    @Inject(ToolsService) private readonly tools: ToolsService,
  ) {}

  async send(conversationId: string, message: SendMessage) {
    const conversation = this.db.getConversation(conversationId);
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (this.db.openPending(conversationId).length) {
      throw new ConflictException('Approve or decline the pending action first');
    }

    let text = message.text;
    const slash = parseSlashCommand(text);
    if (slash && (await this.library.skill(slash.skill))) {
      this.db.setActiveSkill(conversationId, slash.skill);
      text = slash.rest;
    }
    if (!this.db.recentMessages(conversationId, 1).length) {
      this.db.setTitle(conversationId, (text || 'Photo').slice(0, 60));
    }
    this.db.addMessage(conversationId, 'user', text || `Run the ${slash?.skill ?? ''} skill.`, { image: message.image });
    return this.startRun(conversationId);
  }

  async decide(id: string, approve: boolean) {
    const pending = this.db.getPending(id);
    if (!pending) throw new NotFoundException('Action not found');
    if (!this.db.settlePending(id, approve ? 'approved' : 'rejected')) {
      throw new ConflictException('This action was already decided');
    }
    const result = approve ? await this.tools.execute(pending) : 'The user declined. Nothing was saved.';
    this.db.addMessage(pending.conversation_id, 'tool', result);
    return this.startRun(pending.conversation_id);
  }

  private startRun(conversationId: string) {
    return { runId: this.runs.start((emit, signal) => this.agent.run(conversationId, emit, signal)) };
  }
}
