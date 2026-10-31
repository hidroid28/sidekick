import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { CONFIG } from './config.js';
import type { AppConfig } from './config.js';
import { configureApp } from './configure.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
const config = app.get<AppConfig>(CONFIG);
configureApp(app, config);
app.enableShutdownHooks();
await app.listen(config.port);
new Logger('Sidekick').log(`API on http://localhost:${config.port}`);
if (!config.apiKey || !config.model) new Logger('Sidekick').warn('GOOGLE_API_KEY or GEMMA_MODEL is missing');
