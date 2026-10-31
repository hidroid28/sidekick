import { Body, Controller, Delete, Get, Inject, Ip, NotFoundException, Param, Post, Put, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { map } from 'rxjs';
import {
  DecisionSchema,
  ProfileSchema,
  SaveFileSchema,
  SendMessageSchema,
  UploadSchema,
} from '@sidekick/shared';
import type { Profile, SendMessage, Upload } from '@sidekick/shared';
import { ChatService, toChatMessage } from './chat/chat.service.js';
import { RunsService } from './chat/runs.service.js';
import { RateLimiter, ZodPipe } from './common/http.js';
import { CONFIG } from './config.js';
import type { AppConfig } from './config.js';
import { DatabaseService } from './db/database.service.js';
import { KnowledgeService } from './knowledge/knowledge.service.js';
import { LibraryService } from './library/library.service.js';

const limiter = () => new RateLimiter(30, 60_000);

@Controller()
export class AppController {
  private readonly messageLimit = limiter();

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(RunsService) private readonly runs: RunsService,
    @Inject(LibraryService) private readonly library: LibraryService,
    @Inject(KnowledgeService) private readonly knowledge: KnowledgeService,
  ) {}

  @Get('health')
  health() {
    return { ok: true, modelConfigured: Boolean(this.config.apiKey && this.config.model) };
  }

  @Get('profile')
  profile() {
    return this.db.getProfile();
  }

  @Put('profile')
  saveProfile(@Body(new ZodPipe(ProfileSchema)) profile: Profile) {
    this.db.saveProfile(profile);
    return profile;
  }

  @Get('conversations')
  conversations() {
    return this.db.listConversations().map((c) => ({ id: c.id, title: c.title, updatedAt: c.updated_at }));
  }

  @Post('conversations')
  createConversation() {
    const c = this.db.createConversation('New chat');
    return { id: c.id, title: c.title, updatedAt: c.updated_at };
  }

  @Get('conversations/:id')
  conversation(@Param('id') id: string) {
    const c = this.db.getConversation(id);
    if (!c) throw new NotFoundException('Conversation not found');
    return {
      id: c.id,
      title: c.title,
      activeSkill: c.active_skill,
      messages: this.db.recentMessages(id).map(toChatMessage),
      pending: this.db.openPending(id).map((p) => ({ id: p.id, tool: p.tool, summary: p.summary })),
    };
  }

  @Delete('conversations/:id/skill')
  endSkill(@Param('id') id: string) {
    if (!this.db.getConversation(id)) throw new NotFoundException('Conversation not found');
    this.db.setActiveSkill(id, null);
    return { activeSkill: null };
  }

  @Post('conversations/:id/messages')
  send(@Ip() ip: string, @Param('id') id: string, @Body(new ZodPipe(SendMessageSchema)) message: SendMessage) {
    this.messageLimit.check(ip);
    return this.chat.send(id, message);
  }

  @Sse('runs/:id/events')
  events(@Param('id') id: string) {
    const events = this.runs.events(id);
    if (!events) throw new NotFoundException('Run not found');
    return events.pipe(map((event): MessageEvent => ({ data: event })));
  }

  @Post('runs/:id/stop')
  stop(@Param('id') id: string) {
    return { stopped: this.runs.stop(id) };
  }

  @Post('approvals/:id/decision')
  decide(@Param('id') id: string, @Body(new ZodPipe(DecisionSchema)) body: { approve: boolean }) {
    return this.chat.decide(id, body.approve);
  }

  @Get('records')
  records() {
    return this.db.listRecords();
  }

  @Get('documents')
  documents() {
    return this.db.listDocuments().map((d) => ({ id: d.id, name: d.name, parts: d.parts, createdAt: d.created_at }));
  }

  @Post('documents')
  upload(@Body(new ZodPipe(UploadSchema)) file: Upload) {
    return this.knowledge.upload(file);
  }

  @Delete('documents/:id')
  deleteDocument(@Param('id') id: string) {
    if (!this.db.deleteDocument(id)) throw new NotFoundException('Document not found');
    return { deleted: true };
  }

  @Get('library')
  items() {
    return this.library.items();
  }

  @Get('library/:kind/:name')
  async source(@Param('kind') kind: string, @Param('name') name: string) {
    return { content: await this.library.readSource(kind, name) };
  }

  @Put('library/:kind/:name')
  async saveSource(
    @Param('kind') kind: string,
    @Param('name') name: string,
    @Body(new ZodPipe(SaveFileSchema)) body: { content: string },
  ) {
    await this.library.saveSource(kind, name, body.content);
    return { saved: true };
  }
}
