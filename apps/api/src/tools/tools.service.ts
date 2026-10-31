import { HttpException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ExpenseArgsSchema, PaymentLinkArgsSchema, QuoteArgsSchema } from '@sidekick/shared';
import type { Citation, ExpenseArgs, PaymentLinkArgs, PendingApproval, QuoteArgs } from '@sidekick/shared';
import { DatabaseService } from '../db/database.service.js';
import type { PendingRow } from '../db/database.service.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import { LibraryService } from '../library/library.service.js';
import type { Skill } from '../library/library.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import type { ToolCall } from './protocol.js';

export interface ToolSpec { name: string; description: string; args: string; action: boolean; }

export const TOOLS: ToolSpec[] = [
  { name: 'use_skill', description: 'Load a skill’s instructions.', args: '{"name": string}', action: false },
  { name: 'end_skill', description: 'Leave the active skill when the user changes topic.', args: '{}', action: false },
  { name: 'search_documents', description: 'Search the uploaded documents.', args: '{"query": string}', action: false },
  { name: 'list_records', description: 'List saved quotes and expenses with totals.', args: '{}', action: false },
  { name: 'read_skill_file', description: 'Read a file from the active skill.', args: '{"path": string}', action: false },
  {
    name: 'create_quote',
    description: 'Save a quote. The user must approve it.',
    args: '{"client": string, "items": [{"description": string, "quantity": number, "unit_price": number}], "currency"?: string, "notes"?: string}',
    action: true,
  },
  {
    name: 'add_expense',
    description: 'Save an expense. The user must approve it.',
    args: '{"vendor": string, "amount": number, "currency"?: string, "category"?: "supplies"|"transport"|"food"|"rent"|"utilities"|"marketing"|"other", "date"?: string}',
    action: true,
  },
  {
    name: 'send_payment_link',
    description: 'Create a USDC payment link and email it. The user must approve it.',
    args: '{"email": string, "amount": number, "description": string}',
    action: true,
  },
];

/** With a skill active, only its `allowed_tools` apply. Actions always need a skill. */
export function isToolAllowed(tool: ToolSpec, skill: Skill | undefined) {
  if (tool.name === 'use_skill') return true;
  if (tool.name === 'end_skill') return skill !== undefined;
  if (!skill) return !tool.action && tool.name !== 'read_skill_file';
  return skill.allowedTools.includes(tool.name);
}

export const toCents = (amount: number) => Math.round(amount * 100);
export const formatMoney = (cents: number, currency: string) =>
  `${currency ? `${currency} ` : ''}${(cents / 100).toFixed(2)}`;

/** Totals are calculated here, never by the model. */
export function quoteTotalCents(args: QuoteArgs) {
  return args.items.reduce((sum, item) => sum + Math.round(item.quantity * toCents(item.unit_price)), 0);
}

export type ToolOutcome =
  | { kind: 'result'; text: string; citations?: Citation[] }
  | { kind: 'approval'; approval: PendingApproval };

export interface ToolContext { conversationId: string; skill?: Skill; }

const firstIssue = (error: z.ZodError) => {
  const issue = error.issues[0];
  return `${issue?.path.join('.') || 'args'}: ${issue?.message ?? 'invalid'}`;
};

@Injectable()
export class ToolsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(LibraryService) private readonly library: LibraryService,
    @Inject(KnowledgeService) private readonly knowledge: KnowledgeService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
  ) {}

  available(skill: Skill | undefined) {
    return TOOLS.filter((tool) => isToolAllowed(tool, skill));
  }

  /** Every call is checked here, whatever the prompt told the model. */
  async dispatch(call: ToolCall, context: ToolContext): Promise<ToolOutcome> {
    const tool = TOOLS.find((t) => t.name === call.tool);
    if (!tool) return { kind: 'result', text: `Error: there is no tool called ${call.tool}.` };
    if (!isToolAllowed(tool, context.skill)) {
      return { kind: 'result', text: `Error: ${call.tool} is not allowed here. Tell the user what you need instead.` };
    }
    return tool.action ? this.propose(tool, call, context) : this.read(tool, call, context);
  }

  private async read(tool: ToolSpec, call: ToolCall, context: ToolContext): Promise<ToolOutcome> {
    switch (tool.name) {
      case 'use_skill': {
        const skill = await this.library.skill(String(call.args.name ?? ''));
        if (!skill) return { kind: 'result', text: 'Error: that skill does not exist.' };
        this.db.setActiveSkill(context.conversationId, skill.name);
        return { kind: 'result', text: `Skill ${skill.name} is active. Follow its instructions now.` };
      }
      case 'end_skill':
        this.db.setActiveSkill(context.conversationId, null);
        return { kind: 'result', text: 'The skill has ended. Continue helping the user.' };
      case 'search_documents': {
        const query = call.args.query;
        if (typeof query !== 'string' || !query.trim()) return { kind: 'result', text: 'Error: query is required.' };
        return { kind: 'result', ...this.knowledge.search(query) };
      }
      case 'list_records':
        return { kind: 'result', text: this.describeRecords() };
      default: {
        try {
          const text = await this.library.readSkillFile(context.skill!.name, String(call.args.path ?? ''));
          return { kind: 'result', text };
        } catch {
          return { kind: 'result', text: 'Error: that file could not be read.' };
        }
      }
    }
  }

  private propose(tool: ToolSpec, call: ToolCall, context: ToolContext): ToolOutcome {
    const currency = this.db.getProfile().currency;
    let args: QuoteArgs | ExpenseArgs | PaymentLinkArgs;
    let summary: string;
    if (tool.name === 'send_payment_link') {
      const parsed = PaymentLinkArgsSchema.safeParse(call.args);
      if (!parsed.success) return { kind: 'result', text: `Error: ${firstIssue(parsed.error)}` };
      args = parsed.data;
      const { email, amount, description } = parsed.data;
      summary = `Email a payment link for ${amount.toFixed(2)} USDC to ${email}: ${description}`;
    } else if (tool.name === 'create_quote') {
      const parsed = QuoteArgsSchema.safeParse(call.args);
      if (!parsed.success) return { kind: 'result', text: `Error: ${firstIssue(parsed.error)}` };
      args = parsed.data;
      const total = formatMoney(quoteTotalCents(parsed.data), parsed.data.currency || currency);
      summary = `Save quote for ${parsed.data.client}: ${total}`;
    } else {
      const parsed = ExpenseArgsSchema.safeParse(call.args);
      if (!parsed.success) return { kind: 'result', text: `Error: ${firstIssue(parsed.error)}` };
      args = parsed.data;
      const total = formatMoney(toCents(parsed.data.amount), parsed.data.currency || currency);
      summary = `Log ${parsed.data.category} expense at ${parsed.data.vendor}: ${total}`;
    }
    const id = this.db.createPending(context.conversationId, tool.name, args, summary);
    return { kind: 'approval', approval: { id, tool: tool.name, summary } };
  }

  /** Runs an approved action. Validated again, because stored args are still model output. */
  async execute(pending: PendingRow) {
    const fallback = this.db.getProfile().currency;
    const raw: unknown = JSON.parse(pending.args);
    if (pending.tool === 'send_payment_link') return this.sendPaymentLink(PaymentLinkArgsSchema.parse(raw));
    if (pending.tool === 'create_quote') {
      const args = QuoteArgsSchema.parse(raw);
      const currency = args.currency || fallback;
      const cents = quoteTotalCents(args);
      this.db.addRecord('quote', `Quote for ${args.client}`, cents, currency, args);
      return `Saved. Confirmed total: ${formatMoney(cents, currency)}.`;
    }
    const args = ExpenseArgsSchema.parse(raw);
    const currency = args.currency || fallback;
    const cents = toCents(args.amount);
    this.db.addRecord('expense', `${args.vendor} (${args.category})`, cents, currency, args);
    return `Saved. Logged ${formatMoney(cents, currency)} at ${args.vendor}.`;
  }

  /** Never says an email went out unless it did, so the model cannot claim that either. */
  private async sendPaymentLink(args: PaymentLinkArgs) {
    try {
      const link = await this.payments.create(args);
      const total = `${link.amount} ${link.currency}${link.simulated ? ' (simulated demo, no real payment)' : ''}`;
      if (link.emailStatus === 'sent') return `Saved. Payment link for ${total} emailed to ${link.recipientEmail}.`;
      const reason = link.emailStatus === 'failed' ? 'The email failed to send' : 'Email is not set up';
      return `Saved. Payment link for ${total} created, but it was NOT emailed. ${reason}. The user can send it from the Payments page. Link: ${link.url}`;
    } catch (error) {
      const message = error instanceof HttpException ? error.message : 'Something went wrong.';
      return `Error: no payment link was created. ${message}`;
    }
  }

  private describeRecords() {
    const records = this.db.listRecords();
    if (!records.length) return 'There are no saved records yet.';
    const totals = new Map<string, number>();
    for (const r of records) {
      const key = `${r.kind} ${r.currency}`.trim();
      totals.set(key, (totals.get(key) ?? 0) + r.amountCents);
    }
    const lines = records.slice(0, 50).map((r) => `- ${r.createdAt.slice(0, 10)} ${r.title}: ${formatMoney(r.amountCents, r.currency)}`);
    const summary = [...totals].map(([key, cents]) => `${key}: ${(cents / 100).toFixed(2)}`);
    return `${lines.join('\n')}\nTotals by type and currency:\n${summary.join('\n')}`;
  }
}
