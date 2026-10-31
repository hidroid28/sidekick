'use client';

import { useCallback, useEffect, useState } from 'react';
import { MAX_UPLOAD_BYTES } from '@sidekick/shared';
import type { DocumentSummary, LibraryItem, RecordRow, Upload } from '@sidekick/shared';
import { api, fileToBase64 } from '../lib/api';
import { formatAmount, recordTotals } from '../lib/format';

const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'Something went wrong');

export function RecordsPanel() {
  const [records, setRecords] = useState<RecordRow[]>();
  const [error, setError] = useState('');

  useEffect(() => {
    api.records().then(setRecords).catch((cause) => setError(message(cause)));
  }, []);

  return (
    <section className="panel">
      <h1>Records</h1>
      <p className="muted">Quotes and expenses you approved.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {records && records.length === 0 && <p className="empty">Nothing saved yet. Try /draft-quote in chat.</p>}
      {records && records.length > 0 && (
        <>
          <div className="totals">
            {recordTotals(records).map((t) => (
              <div className="total" key={`${t.kind}${t.currency}`}>
                <span className="muted">{t.kind === 'quote' ? 'Quoted' : 'Spent'}</span>
                <strong>{formatAmount(t.cents, t.currency)}</strong>
              </div>
            ))}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Date</th><th>Type</th><th>Details</th><th className="num">Amount</th></tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id}>
                    <td>{r.createdAt.slice(0, 10)}</td>
                    <td>{r.kind === 'quote' ? 'Quote' : 'Expense'}</td>
                    <td>{r.title}</td>
                    <td className="num">{formatAmount(r.amountCents, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function uploadType(file: File): Upload['mimeType'] | undefined {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'txt') return 'text/plain';
  if (extension === 'md') return 'text/markdown';
  if (extension === 'csv') return 'text/csv';
  return undefined;
}

export function DocumentsPanel() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    api.documents().then(setDocuments).catch((cause) => setError(message(cause)));
  }, []);
  useEffect(refresh, [refresh]);

  async function upload(file: File) {
    setError('');
    const mimeType = uploadType(file);
    if (!mimeType) return setError('Use a PDF, TXT, MD, or CSV file');
    if (file.size > MAX_UPLOAD_BYTES) return setError('Files can be up to 5 MB');
    setUploading(true);
    try {
      await api.uploadDocument({ name: file.name, mimeType, data: await fileToBase64(file) });
      refresh();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="panel">
      <h1>Documents</h1>
      <p className="muted">Upload contracts, price lists, or notes, then ask about them in chat.</p>
      <label className="primary upload">
        {uploading ? 'Uploading…' : 'Upload a file'}
        <input
          type="file"
          accept=".pdf,.txt,.md,.csv"
          hidden
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void upload(file);
          }}
        />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      {documents.length === 0 && <p className="empty">No documents yet. Text PDFs work; scanned ones do not yet.</p>}
      <ul className="list">
        {documents.map((d) => (
          <li key={d.id}>
            <span>{d.name}</span>
            <button
              className="link"
              aria-label={`Delete ${d.name}`}
              onClick={() => api.deleteDocument(d.id).then(refresh).catch((cause) => setError(message(cause)))}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LibraryPanel() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [selected, setSelected] = useState<LibraryItem>();
  const [content, setContent] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    api.library().then(setItems).catch((cause) => setError(message(cause)));
  }, []);
  useEffect(refresh, [refresh]);

  async function open(item: LibraryItem) {
    setNotice('');
    setError('');
    try {
      setContent((await api.librarySource(item.kind, item.name)).content);
      setSelected(item);
    } catch (cause) {
      setError(message(cause));
    }
  }

  async function save() {
    if (!selected) return;
    setNotice('');
    setError('');
    try {
      await api.saveLibrarySource(selected.kind, selected.name, content);
      setNotice('Saved. It applies to the next message.');
      refresh();
    } catch (cause) {
      setError(message(cause));
    }
  }

  const group = (kind: LibraryItem['kind'], title: string) => (
    <>
      <h2>{title}</h2>
      <ul className="list">
        {items.filter((i) => i.kind === kind).map((item) => (
          <li key={item.name}>
            <button className="link" onClick={() => void open(item)}>{item.title}</button>
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <section className="panel">
      <h1>Skills & rules</h1>
      <p className="muted">Change how Sidekick behaves by editing Markdown. No redeploy needed.</p>
      <div className="library">
        <div>
          {group('rules', 'Rules')}
          {group('skills', 'Skills')}
        </div>
        <div className="editor">
          {selected ? (
            <>
              <h2>{selected.title}</h2>
              <textarea
                aria-label={`Edit ${selected.title}`}
                value={content}
                spellCheck={false}
                onChange={(event) => setContent(event.target.value)}
              />
              <button className="primary" onClick={() => void save()}>Save</button>
            </>
          ) : (
            <p className="empty">Choose a rule or skill to edit it.</p>
          )}
          {notice && <p className="notice" role="status">{notice}</p>}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </div>
    </section>
  );
}
