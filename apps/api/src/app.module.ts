import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AgentService } from './agent/agent.service.js';
import { AppController } from './app.controller.js';
import { ChatService } from './chat/chat.service.js';
import { RunsService } from './chat/runs.service.js';
import { PasscodeGuard } from './common/http.js';
import { CONFIG, loadConfig } from './config.js';
import { DatabaseService } from './db/database.service.js';
import { KnowledgeService } from './knowledge/knowledge.service.js';
import { LibraryService } from './library/library.service.js';
import { GeminiProvider } from './llm/gemini.provider.js';
import { MODEL_PROVIDER } from './llm/model-provider.js';
import { ToolsService } from './tools/tools.service.js';

@Module({
  controllers: [AppController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    { provide: MODEL_PROVIDER, useClass: GeminiProvider },
    { provide: APP_GUARD, useClass: PasscodeGuard },
    AgentService,
    ChatService,
    DatabaseService,
    KnowledgeService,
    LibraryService,
    RunsService,
    ToolsService,
  ],
})
export class AppModule {}
