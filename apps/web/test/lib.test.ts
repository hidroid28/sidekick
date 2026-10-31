import { describe, expect, it } from 'vitest';
import type { ChatMessage, RecordRow } from '@sidekick/shared';
import { formatAmount, recordTotals, slashQuery, uniqueCitations, visibleMessages } from '../lib/format';
import { SseParser } from '../lib/sse';

describe('SseParser', () => {
  it('reads complete events', () => {
    expect(new SseParser().push('data: {"type":"done"}\n\n')).toEqual([{ type: 'done' }]);
  });

  it('rebuilds an event split across chunks', () => {
    const parser = new SseParser();
    expect(parser.push('data: {"type":"te')).toEqual([]);
    expect(parser.push('xt","text":"a"}\n')).toEqual([]);
    expect(parser.push('\n')).toEqual([{ type: 'text', text: 'a' }]);
  });

  it('reads several events, CRLF, and id lines', () => {
    const events = new SseParser().push('id: 1\r\ndata: {"type":"done"}\r\n\r\ndata: {"type":"done"}\n\n');
    expect(events).toHaveLength(2);
  });

  it('survives a malformed event', () => {
    expect(new SseParser().push('data: nope\n\ndata: {"type":"done"}\n\n')).toEqual([{ type: 'done' }]);
  });
});

describe('format helpers', () => {
  it('formats amounts', () => {
    expect(formatAmount(123456, 'ZMW')).toBe('ZMW 1,234.56');
    expect(formatAmount(5, '')).toBe('0.05');
  });

  it('hides tool messages', () => {
    const message = (role: ChatMessage['role']): ChatMessage => ({
      id: role, role, text: '', hasImage: false, citations: [], createdAt: '',
    });
    expect(visibleMessages([message('user'), message('tool'), message('assistant')]).map((m) => m.role)).toEqual([
      'user',
      'assistant',
    ]);
  });

  it('removes duplicate citations', () => {
    const citation = { document: 'a', part: 1 };
    expect(uniqueCitations([citation, { ...citation }, { document: 'a', part: 2 }])).toHaveLength(2);
  });

  it('totals per kind and currency without mixing them', () => {
    const record = (kind: RecordRow['kind'], currency: string, amountCents: number): RecordRow => ({
      id: '', kind, title: '', amountCents, currency, createdAt: '',
    });
    expect(
      recordTotals([record('expense', 'ZMW', 100), record('expense', 'USD', 50), record('expense', 'ZMW', 25), record('quote', 'ZMW', 9)]),
    ).toEqual([
      { kind: 'expense', currency: 'ZMW', cents: 125 },
      { kind: 'expense', currency: 'USD', cents: 50 },
      { kind: 'quote', currency: 'ZMW', cents: 9 },
    ]);
  });

  it('detects a slash command being typed', () => {
    expect(slashQuery('/dra')).toBe('dra');
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/draft-quote 3 shirts')).toBeUndefined();
    expect(slashQuery('hello')).toBeUndefined();
  });
});
