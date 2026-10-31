import { z } from 'zod';

/**
 * Tools use a plain-text protocol, so they work on any model. Google's docs do not
 * confirm native function calling for Gemma 4 on the Gemini API.
 */
const OPEN = '```tool';
const CLOSE = '```';

const CallSchema = z.object({ tool: z.string().min(1), args: z.record(z.string(), z.unknown()).default({}) });
export type ToolCall = z.infer<typeof CallSchema>;

/** Passes visible text through and hides the tool block, even when split across chunks. */
export class ToolBlockFilter {
  private buffer = '';
  private inBlock = false;

  push(chunk: string) {
    this.buffer += chunk;
    if (this.inBlock) return '';
    const start = this.buffer.indexOf(OPEN);
    if (start >= 0) {
      const visible = this.buffer.slice(0, start);
      this.buffer = this.buffer.slice(start + OPEN.length);
      this.inBlock = true;
      return visible;
    }
    let hold = 0;
    for (let size = Math.min(OPEN.length - 1, this.buffer.length); size > 0; size--) {
      if (OPEN.startsWith(this.buffer.slice(-size))) {
        hold = size;
        break;
      }
    }
    const visible = this.buffer.slice(0, this.buffer.length - hold);
    this.buffer = this.buffer.slice(this.buffer.length - hold);
    return visible;
  }

  /** Returns any held-back text, and the raw tool block if there was one. */
  finish(): { text: string; rawCall?: string } {
    if (!this.inBlock) return { text: this.buffer };
    const end = this.buffer.indexOf(CLOSE);
    return { text: '', rawCall: (end >= 0 ? this.buffer.slice(0, end) : this.buffer).trim() };
  }
}

export function parseToolCall(raw: string): ToolCall | undefined {
  try {
    const parsed = CallSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
