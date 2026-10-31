'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { PaymentLinkArgsSchema } from '@sidekick/shared';
import type { PaymentLink, PaymentWalletStatus } from '@sidekick/shared';
import { api } from '../lib/api';
import { EMAIL_STATUS_LABELS, paymentMailto } from '../lib/format';

const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'Something went wrong');

export function PaymentsPanel() {
  const [wallet, setWallet] = useState<PaymentWalletStatus>();
  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const [created, setCreated] = useState<PaymentLink>();
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    api.paymentLinks().then(setLinks).catch((cause) => setError(message(cause)));
  }, []);

  useEffect(() => {
    api.paymentWallet().then(setWallet).catch((cause) => setError(message(cause)));
    refresh();
  }, [refresh]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    setError('');
    setCreated(undefined);
    const parsed = PaymentLinkArgsSchema.safeParse({ email, amount: Number(amount), description });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form');
      return;
    }
    // Each request creates a new pending deposit, so the button locks until this one ends.
    setSending(true);
    try {
      setCreated(await api.createPaymentLink(parsed.data));
      setEmail('');
      setAmount('');
      setDescription('');
      refresh();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="panel">
      <h1>Payments</h1>
      <p className="muted">Email a client a link to pay you in USDC.</p>

      {wallet?.simulated && <p className="banner-box">Demo mode: links are simulated, and no real payment can be made.</p>}
      {!wallet && !error && <p className="muted" role="status">Loading…</p>}
      {wallet && !wallet.available && <p className="banner-box">{wallet.message}</p>}
      {wallet?.available && (
        <form className="payment-form" onSubmit={submit}>
          <label className="field">
            <span>Client email</span>
            <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="field">
            <span>Amount (USDC on {wallet.network})</span>
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label className="field">
            <span>What it is for</span>
            <input required maxLength={200} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <button type="submit" className="primary" disabled={sending}>
            {sending ? 'Creating…' : wallet.emailConfigured ? 'Create and email link' : 'Create link'}
          </button>
          {!wallet.emailConfigured && (
            <p className="muted small">Email is not set up, so you will send this link yourself.</p>
          )}
        </form>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      {created && (
        <p className="notice" role="status">
          {created.emailStatus === 'sent'
            ? `Link emailed to ${created.recipientEmail}.`
            : `Link created, but not emailed to ${created.recipientEmail}. Send it from the list below.`}
        </p>
      )}

      <h2>Sent links</h2>
      {links.length === 0 && <p className="empty">No payment links yet.</p>}
      {links.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Client</th><th>For</th><th className="num">Amount</th><th>Email</th><th>Link</th></tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.token}>
                  <td>{link.createdAt.slice(0, 10)}</td>
                  <td>{link.recipientEmail}</td>
                  <td>{link.description}</td>
                  <td className="num">{link.amount} {link.currency}{link.simulated ? ' (demo)' : ''}</td>
                  <td>
                    {EMAIL_STATUS_LABELS[link.emailStatus]}
                    {link.emailStatus !== 'sent' && (
                      <> · <a href={paymentMailto(link)}>Send</a></>
                    )}
                  </td>
                  <td><a href={link.url} target="_blank" rel="noreferrer">Open</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">Sidekick can&apos;t confirm payments yet. Check your Devdraft Console for status.</p>
    </section>
  );
}
