import { describe, expect, it } from 'vitest';
import { formatMoney, isToolAllowed, quoteTotalCents, TOOLS } from '../src/tools/tools.service.js';
import type { Skill } from '../src/library/library.service.js';
import { FakeModel, makeServices } from './helpers.js';

const spec = (name: string) => TOOLS.find((t) => t.name === name)!;
const skill = (allowedTools: string[]): Skill => ({ name: 's', description: 'd', allowedTools, body: '' });

const quote = { client: 'Sunrise', items: [{ description: 'Uniform', quantity: 3, unit_price: 19.99 }] };

function setup() {
  const services = makeServices(new FakeModel([]));
  const { id } = services.db.createConversation('t');
  return { ...services, id };
}

describe('money', () => {
  it('avoids floating point drift', () => {
    expect(quoteTotalCents(quote)).toBe(5997);
    expect(quoteTotalCents({ client: 'a', items: [{ description: 'x', quantity: 3, unit_price: 0.1 }] })).toBe(30);
  });

  it('supports fractional quantities', () => {
    expect(quoteTotalCents({ client: 'a', items: [{ description: 'x', quantity: 1.5, unit_price: 10 }] })).toBe(1500);
  });

  it('formats with and without a currency', () => {
    expect(formatMoney(5997, 'ZMW')).toBe('ZMW 59.97');
    expect(formatMoney(5, '')).toBe('0.05');
  });
});

describe('isToolAllowed', () => {
  it('blocks action tools when no skill is active', () => {
    expect(isToolAllowed(spec('create_quote'), undefined)).toBe(false);
    expect(isToolAllowed(spec('add_expense'), undefined)).toBe(false);
  });

  it('allows read tools when no skill is active', () => {
    expect(isToolAllowed(spec('search_documents'), undefined)).toBe(true);
    expect(isToolAllowed(spec('read_skill_file'), undefined)).toBe(false);
  });

  it('limits a skill to its allowed_tools', () => {
    expect(isToolAllowed(spec('create_quote'), skill(['create_quote']))).toBe(true);
    expect(isToolAllowed(spec('add_expense'), skill(['create_quote']))).toBe(false);
    expect(isToolAllowed(spec('search_documents'), skill([]))).toBe(false);
  });

  it('always allows switching skills', () => {
    expect(isToolAllowed(spec('use_skill'), skill([]))).toBe(true);
  });

  it('offers end_skill only while a skill is active', () => {
    expect(isToolAllowed(spec('end_skill'), skill([]))).toBe(true);
    expect(isToolAllowed(spec('end_skill'), undefined)).toBe(false);
  });
});

describe('ToolsService.dispatch', () => {
  it('reports unknown tools', async () => {
    const { tools, id } = setup();
    const out = await tools.dispatch({ tool: 'rm_rf', args: {} }, { conversationId: id });
    expect(out).toMatchObject({ kind: 'result', text: expect.stringContaining('no tool') });
  });

  it('refuses a disallowed action and creates nothing', async () => {
    const { tools, db, id } = setup();
    const out = await tools.dispatch({ tool: 'create_quote', args: quote }, { conversationId: id });
    expect(out).toMatchObject({ kind: 'result', text: expect.stringContaining('not allowed') });
    expect(db.openPending(id)).toEqual([]);
  });

  it('proposes an allowed action without saving a record', async () => {
    const { tools, db, id } = setup();
    db.saveProfile({ name: '', work: '', currency: 'ZMW' });
    const out = await tools.dispatch({ tool: 'create_quote', args: quote }, { conversationId: id, skill: skill(['create_quote']) });
    expect(out).toMatchObject({ kind: 'approval', approval: { summary: 'Save quote for Sunrise: ZMW 59.97' } });
    expect(db.listRecords()).toEqual([]);
  });

  it('sends invalid action args back to the model', async () => {
    const { tools, db, id } = setup();
    const args = { client: 'x', items: [{ description: 'y', quantity: -1, unit_price: 1 }] };
    const out = await tools.dispatch({ tool: 'create_quote', args }, { conversationId: id, skill: skill(['create_quote']) });
    expect(out).toMatchObject({ kind: 'result', text: expect.stringContaining('quantity') });
    expect(db.openPending(id)).toEqual([]);
  });

  it('activates a skill that exists, and only that', async () => {
    const { tools, db, id } = setup();
    await tools.dispatch({ tool: 'use_skill', args: { name: 'note' } }, { conversationId: id });
    expect(db.getConversation(id)?.active_skill).toBe('note');
    const out = await tools.dispatch({ tool: 'use_skill', args: { name: 'nope' } }, { conversationId: id });
    expect(out).toMatchObject({ text: expect.stringContaining('does not exist') });
    expect(db.getConversation(id)?.active_skill).toBe('note');
  });

  it('restores the normal tools after end_skill', async () => {
    const { tools, db, id, library } = setup();
    db.setActiveSkill(id, 'note');
    const active = await library.skill('note');
    expect(tools.available(active).map((t) => t.name)).not.toContain('search_documents');
    await tools.dispatch({ tool: 'end_skill', args: {} }, { conversationId: id, skill: active });
    expect(db.getConversation(id)?.active_skill).toBeNull();
    expect(tools.available(undefined).map((t) => t.name)).toContain('search_documents');
  });

  it('turns skill file errors into a safe message', async () => {
    const { tools, id } = setup();
    const out = await tools.dispatch(
      { tool: 'read_skill_file', args: { path: '../../secret.txt' } },
      { conversationId: id, skill: { ...skill(['read_skill_file']), name: 'draft-quote' } },
    );
    expect(out).toEqual({ kind: 'result', text: 'Error: that file could not be read.' });
  });

  it('totals records per currency, never mixing them', async () => {
    const { tools, db, id } = setup();
    db.addRecord('expense', 'A', 1000, 'ZMW', {});
    db.addRecord('expense', 'B', 500, 'USD', {});
    db.addRecord('expense', 'C', 250, 'ZMW', {});
    const out = await tools.dispatch({ tool: 'list_records', args: {} }, { conversationId: id });
    expect(out).toMatchObject({ text: expect.stringContaining('expense ZMW: 12.50') });
    expect(out).toMatchObject({ text: expect.stringContaining('expense USD: 5.00') });
  });
});

describe('ToolsService.execute', () => {
  it('saves a quote with a server-calculated total', () => {
    const { tools, db, id } = setup();
    const pendingId = db.createPending(id, 'create_quote', { ...quote, total: 1 }, 's');
    expect(tools.execute(db.getPending(pendingId)!)).toContain('59.97');
    expect(db.listRecords()[0]).toMatchObject({ kind: 'quote', amountCents: 5997 });
  });

  it('saves an expense and defaults the category', () => {
    const { tools, db, id } = setup();
    const pendingId = db.createPending(id, 'add_expense', { vendor: 'Shoprite', amount: 12.5 }, 's');
    tools.execute(db.getPending(pendingId)!);
    expect(db.listRecords()[0]).toMatchObject({ title: 'Shoprite (other)', amountCents: 1250 });
  });
});
