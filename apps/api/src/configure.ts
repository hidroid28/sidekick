import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AppConfig } from './config.js';

/** Shared by the server and the HTTP tests, so tests exercise the real setup. */
export function configureApp(app: NestExpressApplication, config: AppConfig) {
  app.useBodyParser('json', { limit: '12mb' });
  app.enableCors({
    origin: config.webOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['content-type', 'x-demo-passcode'],
  });
}
