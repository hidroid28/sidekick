import type { ChatMessage, Citation, PaymentLink, RecordRow } from '@sidekick/shared';

export const formatAmount = (cents: number, currency: string) =>
  `${currency ? `${currency} ` : ''}${(cents / 100).toLocaleString('en', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** Tool calls and results are internal, so they never appear in the chat. */
export const visibleMessages = (messages: ChatMessage[]) =>
  messages.filter((m) => m.role === 'user' || m.role === 'assistant');

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

/** Builds an email the user can send by hand when no email service is set up. */
export function paymentMailto(link: PaymentLink) {
  const subject = `Payment request: ${link.amount} ${link.currency}`;
  const body = `Please pay ${link.amount} ${link.currency} for: ${link.description}\n\nPayment details: ${link.url}`;
  return `mailto:${encodeURIComponent(link.recipientEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export const EMAIL_STATUS_LABELS: Record<PaymentLink['emailStatus'], string> = {
  sent: 'Emailed',
  not_configured: 'Not emailed',
  failed: 'Email failed',
};

/** The slash-command prefix being typed, or undefined if the input is not a command. */
export function slashQuery(input: string) {
  return /^\/([a-z0-9-]*)$/.exec(input)?.[1];
}
