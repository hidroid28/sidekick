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

describe('ToolBlockFilter with format drift', () => {
  const call = '{"tool":"list_records"}';

  it.each(['tool_code', 'tool_call'])('accepts a %s fence', (language) => {
    expect(run([`\`\`\`${language}\n${call}\n\`\`\``])).toEqual({ text: '', rawCall: call });
  });

  it('accepts a block on one line', () => {
    expect(run([`\`\`\`tool ${call}\`\`\``]).rawCall).toBe(call);
  });

  it('accepts a JSON fence that holds only a call', () => {
    expect(run([`Checking.\n\`\`\`json\n${call}\n\`\`\``])).toEqual({ text: 'Checking.\n', rawCall: call });
  });

  it('accepts an unclosed JSON call', () => {
    expect(run([`\`\`\`json\n${call}`])).toEqual({ text: '', rawCall: call });
  });

  it('accepts a split JSON fence', () => {
    expect(run(['``', '`js', 'on\n{"to', 'ol":"x"}\n``', '`']).rawCall).toBe('{"tool":"x"}');
  });

  it('keeps ordinary JSON visible for the user', () => {
    const block = '```json\n{"name":"Mwila"}\n```';
    expect(run([`Here: ${block} done`])).toEqual({ text: `Here: ${block} done`, rawCall: undefined });
  });

  it('keeps JSON with other fields visible', () => {
    const block = '```json\n{"tool":"hammer","price":5}\n```';
    expect(run([block]).rawCall).toBeUndefined();
    expect(run([block]).text).toBe(block);
  });

  it('keeps invalid and unclosed JSON visible', () => {
    expect(run(['```json\nnot json\n```']).text).toBe('```json\nnot json\n```');
    expect(run(['```json\n{"a":']).text).toBe('```json\n{"a":');
  });

  it('finds a call after an ordinary code block', () => {
    const result = run(['```js\nx\n```\nNow:\n```tool\n{"tool":"a"}\n```']);
    expect(result.text).toBe('```js\nx\n```\nNow:\n');
    expect(result.rawCall).toBe('{"tool":"a"}');
  });

  it('does not mistake a longer language for a tool fence', () => {
    expect(run(['```toolbox\nx\n```'])).toEqual({ text: '```toolbox\nx\n```', rawCall: undefined });
  });

  it('never leaks a marker, whatever the chunk size', () => {
    const reply = 'Sure.\n```tool_code\n{"tool":"a"}\n```';
    for (let size = 1; size < reply.length; size++) {
      const chunks = reply.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g'))!;
      expect(run(chunks)).toEqual({ text: 'Sure.\n', rawCall: '{"tool":"a"}' });
    }
  });
});

describe('parseToolCall', () => {
  it('reads a valid call and defaults args', () => {
    expect(parseToolCall('{"tool":"list_records"}')).toEqual({ tool: 'list_records', args: {} });
  });

  it.each(['arguments', 'parameters'])('accepts name with %s', (key) => {
    expect(parseToolCall(`{"name":"a","${key}":{"b":1}}`)).toEqual({ tool: 'a', args: { b: 1 } });
  });

  it.each(['not json', '{}', '{"tool":""}', '[]', '{"tool":"x","args":[1]}'])('rejects %s', (raw) => {
    expect(parseToolCall(raw)).toBeUndefined();
  });
});
