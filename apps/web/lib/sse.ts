import type { RunEvent } from '@sidekick/shared';

/** Parses a server-sent event stream that arrives in arbitrary chunks. */
export class SseParser {
  private buffer = '';

  push(chunk: string): RunEvent[] {
    this.buffer += chunk.replace(/\r\n/g, '\n');
    const blocks = this.buffer.split('\n\n');
    this.buffer = blocks.pop() ?? '';
    const events: RunEvent[] = [];
    for (const block of blocks) {
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      try {
        events.push(JSON.parse(data) as RunEvent);
      } catch {
        // Skip a malformed event and keep the stream alive.
      }
    }
    return events;
  }
}
