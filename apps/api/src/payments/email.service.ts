import { Inject, Injectable } from '@nestjs/common';
import { CONFIG } from '../config.js';
import type { AppConfig } from '../config.js';

const REQUEST_TIMEOUT_MS = 15_000;

export interface PaymentEmail {
  to: string;
  payee: string;
  description: string;
  amount: string;
  currency: string;
  url: string;
  simulated?: boolean;
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Description and payee can come from the model, so everything is escaped. */
export function buildPaymentEmail(email: PaymentEmail) {
  const total = `${email.amount} ${email.currency}`;
  const demo = email.simulated ? 'This is a demo. Do not send any money.' : '';
  const subject = `${email.simulated ? '[Demo] ' : ''}Payment request from ${email.payee}: ${total}`.replace(/[\r\n]+/g, ' ');
  const text = `${demo ? `${demo}\n\n` : ''}${email.payee} has requested a payment of ${total}.\n\nFor: ${email.description}\n\nView the payment details: ${email.url}\n\nOnly pay if you recognise this request.`;
  const html = `${demo ? `<p><strong>${demo}</strong></p>\n` : ''}<p>${escapeHtml(email.payee)} has requested a payment of <strong>${escapeHtml(total)}</strong>.</p>
<p>For: ${escapeHtml(email.description)}</p>
<p><a href="${escapeHtml(email.url)}">View the payment details</a></p>
<p>Only pay if you recognise this request.</p>`;
  return { subject, text, html };
}

@Injectable()
export class EmailService {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  get configured() {
    return Boolean(this.config.resendApiKey);
  }

  async sendPaymentLink(email: PaymentEmail) {
    const { resendApiKey, resendBase, emailFrom } = this.config;
    const response = await fetch(`${resendBase}/emails`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${resendApiKey}` },
      body: JSON.stringify({ from: emailFrom, to: [email.to], ...buildPaymentEmail(email) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Resend ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
}
