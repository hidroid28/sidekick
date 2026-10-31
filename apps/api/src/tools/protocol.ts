import { z } from 'zod';

/**
 * Tools use a plain-text protocol, so they work on any model. Google's docs do not
 * confirm native function calling for Gemma 4 on the Gemini API.
 *
 * Models drift from the exact format, so the parser accepts common variations:
 * `tool_code` fences, JSON fences that hold only a call, and name/arguments keys.
 */
const FENCE = '```';
const TOOL_LANGUAGES = new Set(['tool', 'tool_code', 'tool_call']);
const CALL_KEYS = new Set(['tool', 'name', 'args', 'arguments', 'parameters']);

const CallSchema = z.object({ tool: z.string().min(1), args: z.record(z.string(), z.unknown()).default({}) });
export type ToolCall = z.infer<typeof CallSchema>;

/** A JSON fence is only a call if it holds nothing else, so ordinary JSON stays visible. */
function isCallJson(raw: string) {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const keys = Object.keys(value);
    const hasName = typeof value.tool === 'string' || (typeof value.name === 'string' && keys.length > 1);
    return hasName && keys.every((key) => CALL_KEYS.has(key));
  } catch {
    return false;
  }
}

/** Passes visible text through and hides a tool block, even when split across chunks. */
export class ToolBlockFilter {
  private buffer = '';
  private rawBlock?: string;

  push(chunk: string) {
    if (this.rawBlock !== undefined) {
      this.rawBlock += chunk;
      return '';
    }
    this.buffer += chunk;
    let visible = '';
    for (;;) {
      const start = this.buffer.indexOf(FENCE);
      if (start < 0) {
        const hold = /`{1,2}$/.exec(this.buffer)?.[0].length ?? 0;
        visible += this.buffer.slice(0, this.buffer.length - hold);
        this.buffer = this.buffer.slice(this.buffer.length - hold);
        return visible;
      }
      visible += this.buffer.slice(0, start);
      this.buffer = this.buffer.slice(start);

      const rest = this.buffer.slice(FENCE.length);
      const [, language = '', end = ''] = /^([A-Za-z_]*)([^A-Za-z_]?)/.exec(rest) ?? [];
      if (!end) return visible; // The language word may continue in the next chunk.

      if (TOOL_LANGUAGES.has(language)) {
        this.rawBlock = rest.slice(language.length);
        this.buffer = '';
        return visible;
      }
      if (language === 'json') {
        const close = rest.indexOf(FENCE, language.length);
        if (close < 0) return visible; // Wait for the whole block before deciding.
        const body = rest.slice(language.length, close);
        if (isCallJson(body)) {
          this.rawBlock = body;
          this.buffer = '';
          return visible;
        }
        const length = FENCE.length + close + FENCE.length;
        visible += this.buffer.slice(0, length);
        this.buffer = this.buffer.slice(length);
        continue;
      }
      const length = FENCE.length + language.length;
      visible += this.buffer.slice(0, length);
      this.buffer = this.buffer.slice(length);
    }
  }

  /** Returns any held-back text, and the raw tool block if there was one. */
  finish(): { text: string; rawCall?: string } {
    if (this.rawBlock !== undefined) {
      const end = this.rawBlock.indexOf(FENCE);
      return { text: '', rawCall: (end >= 0 ? this.rawBlock.slice(0, end) : this.rawBlock).trim() };
    }
    const unclosed = /^```json\s([\s\S]*)$/.exec(this.buffer);
    if (unclosed && isCallJson(unclosed[1]!)) return { text: '', rawCall: unclosed[1]!.trim() };
    return { text: this.buffer };
  }
}

export function parseToolCall(raw: string): ToolCall | undefined {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const parsed = CallSchema.safeParse({
      tool: value.tool ?? value.name,
      args: value.args ?? value.arguments ?? value.parameters,
    });
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
