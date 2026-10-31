import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ReplaySubject } from 'rxjs';
import type { RunEvent } from '@sidekick/shared';

const KEEP_FINISHED_MS = 5 * 60 * 1000;

interface Run { events: ReplaySubject<RunEvent>; controller: AbortController; }

/** Replays events, so a client that connects late or reconnects misses nothing. */
@Injectable()
export class RunsService {
  private readonly runs = new Map<string, Run>();

  start(task: (emit: (event: RunEvent) => void, signal: AbortSignal) => Promise<void>) {
    const id = randomUUID();
    const run: Run = { events: new ReplaySubject<RunEvent>(), controller: new AbortController() };
    this.runs.set(id, run);
    void task((event) => run.events.next(event), run.controller.signal)
      .catch(() => run.events.next({ type: 'error', message: 'Something went wrong. Please try again.' }))
      .finally(() => {
        run.events.complete();
        setTimeout(() => this.runs.delete(id), KEEP_FINISHED_MS).unref();
      });
    return id;
  }

  events(id: string) {
    return this.runs.get(id)?.events.asObservable();
  }

  stop(id: string) {
    const run = this.runs.get(id);
    run?.controller.abort();
    return run !== undefined;
  }
}
