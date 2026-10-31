'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import QRCode from 'qrcode';
import type { PublicPaymentLink } from '@sidekick/shared';
import { api } from '../../../lib/api';

const label = (network: string) => network.charAt(0).toUpperCase() + network.slice(1);

export default function PayPage() {
  const { token } = useParams<{ token: string }>();
  const [payment, setPayment] = useState<PublicPaymentLink>();
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .publicPayment(token)
      .then((loaded) => {
        setPayment(loaded);
        return QRCode.toDataURL(loaded.toAddress, { width: 220, margin: 1 });
      })
      .then(setQr)
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'This payment could not be loaded'));
  }, [token]);

  async function copy(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy. Please select the address by hand.');
    }
  }

  return (
    <main className="pay">
      <div className="pay-card">
        {!payment && !error && <p className="muted" role="status">Loading…</p>}
        {!payment && error && <p className="error" role="alert">{error}</p>}
        {payment && (
          <>
            {payment.simulated && (
              <p className="pay-demo" role="alert">Demo only. This is a simulated payment. Do not send any money.</p>
            )}
            <p className="muted">Payment request from {payment.payee}</p>
            <h1 className="pay-amount">{payment.amount} {payment.currency}</h1>
            <p>{payment.description}</p>

            {!payment.simulated && <p className="pay-warning">
              Send only {payment.currency} on {label(payment.network)}, and send the exact amount. Any other token or
              network may not be credited.
            </p>}

            {qr && !payment.simulated && <img className="pay-qr" src={qr} alt="QR code for the payment address" width={220} height={220} />}

            <dl className="pay-details">
              <dt>Address</dt>
              <dd className="pay-address">{payment.toAddress}</dd>
              <dt>Network</dt>
              <dd>{label(payment.network)}</dd>
              {payment.fee && (
                <>
                  <dt>Fee</dt>
                  <dd>{payment.fee} {payment.currency}</dd>
                </>
              )}
              <dt>Reference</dt>
              <dd className="pay-address">{payment.reference}</dd>
            </dl>

            {!payment.simulated && (
              <button className="primary" onClick={() => void copy(payment.toAddress)}>
                {copied ? 'Copied' : 'Copy address'}
              </button>
            )}
            {error && <p className="error" role="alert">{error}</p>}
            <p className="muted small">
              {payment.simulated
                ? 'No real payment was requested.'
                : 'Waiting for funds. This page does not update after you pay, so keep your transaction receipt.'}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
