import { describe, expect, it } from 'vitest';
import { parseToolCall, ToolBlockFilter } from '../src/tools/protocol.js';

function run(chunks: string[]) {
  const filter = new ToolBlockFilter();
  const shown = chunks.map((c) => filter.push(c)).join('');
  const end = filter.finish();
  return { text: shown + end.text, rawCall: end.rawCall };
}

describe('ToolBlockFilter', () => {
  it('passes ordinary text straight through', () => {
    expect(run(['Hello ', 'there'])).toEqual({ text: 'Hello there', rawCall: undefined });
  });

  it('hides a tool block and captures its JSON', () => {
    const result = run(['One moment.\n```tool\n{"tool":"x"}\n```']);
    expect(result.text).toBe('One moment.\n');
    expect(result.rawCall).toBe('{"tool":"x"}');
  });

  it('never leaks the marker when it is split across chunks', () => {
    const filter = new ToolBlockFilter();
    const shown = ['Hi ', '`', '``', 'to', 'ol\n{}\n```'].map((c) => filter.push(c));
    expect(shown.join('')).toBe('Hi ');
    expect(filter.finish().rawCall).toBe('{}');
  });

  it('releases held-back backticks that turn out to be ordinary code', () => {
    expect(run(['Use ', '``', '`js\ncode\n```']).text).toBe('Use ```js\ncode\n```');
  });

  it('releases a partial marker at the end of the reply', () => {
    expect(run(['done ``']).text).toBe('done ``');
  });

  it('handles a block with no closing fence', () => {
    expect(run(['```tool\n{"tool":"x"}']).rawCall).toBe('{"tool":"x"}');
  });

  it('ignores text after the first tool block', () => {
    const result = run(['```tool\n{"tool":"a"}\n```\nextra ```tool\n{"tool":"b"}\n```']);
    expect(result.text).toBe('');
    expect(result.rawCall).toBe('{"tool":"a"}');
  });
});

describe('parseToolCall', () => {
  it('reads a valid call and defaults args', () => {
    expect(parseToolCall('{"tool":"list_records"}')).toEqual({ tool: 'list_records', args: {} });
  });

  it.each(['not json', '{}', '{"tool":""}', '[]', '{"tool":"x","args":[1]}'])('rejects %s', (raw) => {
    expect(parseToolCall(raw)).toBeUndefined();
  });
});
