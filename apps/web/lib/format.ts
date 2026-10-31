import type { ChatMessage, Citation, RecordRow } from '@sidekick/shared';

export const formatAmount = (cents: number, currency: string) =>
  `${currency ? `${currency} ` : ''}${(cents / 100).toLocaleString('en', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** Tool results are internal, so they never appear in the chat. */
export const visibleMessages = (messages: ChatMessage[]) => messages.filter((m) => m.role !== 'tool');

export function uniqueCitations(citations: Citation[]) {
  const seen = new Set<string>();
  return citations.filter((c) => {
    const key = `${c.document}#${c.part}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Adds up records per kind and currency, because different currencies cannot be summed. */
export function recordTotals(records: RecordRow[]) {
  const totals = new Map<string, { kind: RecordRow['kind']; currency: string; cents: number }>();
  for (const record of records) {
    const key = `${record.kind}|${record.currency}`;
    const entry = totals.get(key) ?? { kind: record.kind, currency: record.currency, cents: 0 };
    entry.cents += record.amountCents;
    totals.set(key, entry);
  }
  return [...totals.values()];
}

/** The slash-command prefix being typed, or undefined if the input is not a command. */
export function slashQuery(input: string) {
  return /^\/([a-z0-9-]*)$/.exec(input)?.[1];
}
