import { describe, expect, it } from 'vitest';
import { firstValueFrom, toArray } from 'rxjs';
import type { ExecutionContext } from '@nestjs/common';
import { SendMessageSchema } from '@sidekick/shared';
import { RunsService } from '../src/chat/runs.service.js';
import { PasscodeGuard, RateLimiter, ZodPipe } from '../src/common/http.js';
import { loadConfig } from '../src/config.js';
import { testConfig } from './helpers.js';

const contextFor = (path: string, passcode?: string) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ path, headers: { 'x-demo-passcode': passcode } }) }),
  }) as unknown as ExecutionContext;

describe('loadConfig', () => {
  it('applies safe defaults', () => {
    expect(loadConfig({})).toMatchObject({ useSystemInstruction: false, port: 3001, apiKey: undefined });
  });

  it('only enables systemInstruction for the exact value true', () => {
    expect(loadConfig({ GEMMA_USE_SYSTEM_INSTRUCTION: 'yes' }).useSystemInstruction).toBe(false);
    expect(loadConfig({ GEMMA_USE_SYSTEM_INSTRUCTION: 'true' }).useSystemInstruction).toBe(true);
  });
});

describe('ZodPipe', () => {
  const pipe = new ZodPipe(SendMessageSchema);

  it('returns parsed data', () => {
    expect(pipe.transform({ text: '  hi ' })).toEqual({ text: 'hi' });
  });

  it('rejects an empty message with a readable error', () => {
    expect(() => pipe.transform({ text: '   ' })).toThrow('Add a message or a photo first');
  });

  it('rejects unsupported image types', () => {
    expect(() => pipe.transform({ image: { mimeType: 'image/svg+xml', data: 'x' } })).toThrow();
  });
});

describe('PasscodeGuard', () => {
  const guard = (passcode?: string) => new PasscodeGuard(testConfig({ passcode }));

  it('is open when no passcode is set', () => {
    expect(guard().canActivate(contextFor('/profile'))).toBe(true);
  });

  it('accepts the right passcode', () => {
    expect(guard('abc').canActivate(contextFor('/profile', 'abc'))).toBe(true);
  });

  it.each([undefined, 'abd', 'ab', 'abcd'])('rejects %s', (attempt) => {
    expect(() => guard('abc').canActivate(contextFor('/profile', attempt))).toThrow('Passcode required');
  });

  it('leaves the health check open', () => {
    expect(guard('abc').canActivate(contextFor('/health'))).toBe(true);
  });
});

describe('RateLimiter', () => {
  it('blocks over the limit and resets after the window', () => {
    let time = 0;
    const limiter = new RateLimiter(2, 1000, () => time);
    limiter.check('a');
    limiter.check('a');
    expect(() => limiter.check('a')).toThrow(/Too many/);
    limiter.check('b');
    time = 1000;
    expect(() => limiter.check('a')).not.toThrow();
  });
});

describe('RunsService', () => {
  it('replays events to a client that connects late', async () => {
    const runs = new RunsService();
    const id = runs.start(async (emit) => {
      emit({ type: 'text', text: 'a' });
      emit({ type: 'done' });
    });
    await new Promise((resolve) => setImmediate(resolve));
    const events = await firstValueFrom(runs.events(id)!.pipe(toArray()));
    expect(events.map((e) => e.type)).toEqual(['text', 'done']);
  });

  it('reports a crashed task as an error event', async () => {
    const runs = new RunsService();
    const id = runs.start(async () => {
      throw new Error('boom');
    });
    const events = await firstValueFrom(runs.events(id)!.pipe(toArray()));
    expect(events).toEqual([{ type: 'error', message: 'Something went wrong. Please try again.' }]);
  });

  it('aborts a run on stop', async () => {
    const runs = new RunsService();
    let aborted = false;
    const id = runs.start(
      (_emit, signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            resolve();
          });
        }),
    );
    expect(runs.stop(id)).toBe(true);
    expect(aborted).toBe(true);
  });

  it('handles unknown runs', () => {
    const runs = new RunsService();
    expect(runs.events('x')).toBeUndefined();
    expect(runs.stop('x')).toBe(false);
  });
});
