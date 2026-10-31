import { timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext, PipeTransform } from '@nestjs/common';
import type { Request } from 'express';
import type { ZodType } from 'zod';
import { CONFIG } from '../config.js';
import type { AppConfig } from '../config.js';

/** Validates a request body with a schema shared with the frontend. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid request');
  }
}

/** Optional gate for a public demo. Open when DEMO_PASSCODE is not set. */
@Injectable()
export class PasscodeGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext) {
    const expected = this.config.passcode;
    if (!expected) return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (request.path === '/health') return true;
    const given = Buffer.from(String(request.headers['x-demo-passcode'] ?? ''));
    const wanted = Buffer.from(expected);
    if (given.length === wanted.length && timingSafeEqual(given, wanted)) return true;
    throw new UnauthorizedException('Passcode required');
  }
}

/** Fixed-window limit per client, so a public demo cannot spend the whole API quota. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  check(key: string) {
    const now = this.clock();
    if (this.windows.size > 5000) this.windows.clear();
    const window = this.windows.get(key);
    if (!window || now - window.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return;
    }
    if (++window.count > this.limit) {
      throw new HttpException('Too many messages. Please wait a minute.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
