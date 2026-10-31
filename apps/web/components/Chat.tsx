'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import Markdown from 'react-markdown';
import type { ChatMessage, Citation, ImageInput, LibraryItem, PendingApproval } from '@sidekick/shared';
import { api, photoToInput, streamRun } from '../lib/api';
import { slashQuery, uniqueCitations, visibleMessages } from '../lib/format';

const STARTERS = [
  { label: 'Draft a quote', text: '/draft-quote ' },
  { label: 'Log a receipt', text: '/track-expense ' },
  { label: 'Chase a payment', text: '/chase-payment ' },
  { label: 'Price my work', text: '/price-my-work ' },
];

function Sources({ citations }: { citations: Citation[] }) {
  const unique = uniqueCitations(citations);
  if (!unique.length) return null;
  return (
    <p className="sources">
      Sources: {unique.map((c) => `${c.document}, part ${c.part}`).join(' · ')}
    </p>
  );
}

export function Chat({
  conversationId,
  onConversation,
  onChanged,
}: {
  conversationId?: string;
  onConversation: (id: string) => void;
  onChanged: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [activeSkill, setActiveSkill] = useState<string | null>(null);
  const [skills, setSkills] = useState<LibraryItem[]>([]);
  const [input, setInput] = useState('');
  const [photo, setPhoto] = useState<ImageInput>();
  const [streaming, setStreaming] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [runId, setRunId] = useState<string>();
  const skipReload = useRef<string | undefined>(undefined);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = runId !== undefined;

  const reload = useCallback(async (id: string) => {
    const detail = await api.conversation(id);
    setMessages(detail.messages);
    setPending(detail.pending);
    setActiveSkill(detail.activeSkill);
  }, []);

  useEffect(() => {
    api.library().then((items) => setSkills(items.filter((i) => i.kind === 'skills'))).catch(() => setSkills([]));
  }, []);

  useEffect(() => {
    setError('');
    if (conversationId && conversationId === skipReload.current) {
      // This chat was just created by send(), which fills in the messages itself.
      skipReload.current = undefined;
      return;
    }
    if (!conversationId) {
      setMessages([]);
      setPending([]);
      setActiveSkill(null);
      return;
    }
    reload(conversationId).catch(() => setError('That chat could not be loaded'));
  }, [conversationId, reload]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, streaming, pending, status]);

  async function follow(id: string, nextRunId: string) {
    setRunId(nextRunId);
    setStreaming('');
    try {
      await streamRun(nextRunId, (event) => {
        if (event.type === 'text') {
          setStatus('');
          setStreaming((text) => text + event.text);
        } else if (event.type === 'status') setStatus(event.text);
        else if (event.type === 'error') setError(event.message);
      });
      await reload(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The reply was interrupted');
    } finally {
      setRunId(undefined);
      setStreaming('');
      setStatus('');
      onChanged();
    }
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if ((!text && !photo) || busy) return;
    setError('');
    try {
      let id = conversationId;
      if (!id) {
        id = (await api.createConversation()).id;
        skipReload.current = id;
        onConversation(id);
      }
      const optimistic: ChatMessage = {
        id: `local-${Date.now()}`,
        role: 'user',
        text: text || 'Photo',
        hasImage: Boolean(photo),
        citations: [],
        createdAt: new Date().toISOString(),
      };
      const { runId: next } = await api.sendMessage(id, text, photo);
      setMessages((current) => [...current, optimistic]);
      setInput('');
      setPhoto(undefined);
      await follow(id, next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That message could not be sent');
    }
  }

  async function decide(approval: PendingApproval, approve: boolean) {
    if (!conversationId || busy) return;
    setPending((current) => current.filter((p) => p.id !== approval.id));
    try {
      const { runId: next } = await api.decide(approval.id, approve);
      await follow(conversationId, next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That action failed');
      await reload(conversationId).catch(() => undefined);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  const query = slashQuery(input);
  const suggestions = query === undefined ? [] : skills.filter((s) => s.name.startsWith(query));
  const shown = visibleMessages(messages);
  const blocked = pending.length > 0;

  return (
    <section className="chat" aria-label="Chat">
      <div className="thread" aria-live="polite">
        {shown.length === 0 && !busy && (
          <div className="welcome">
            <h1>What can I take off your plate?</h1>
            <p className="muted">Quotes, receipts, reminders, contracts, or everyday admin.</p>
            <div className="chips">
              {STARTERS.map((s) => (
                <button key={s.label} className="chip" onClick={() => setInput(s.text)}>{s.label}</button>
              ))}
            </div>
          </div>
        )}
        {shown.map((message) => (
          <article key={message.id} className={`bubble ${message.role}`}>
            {message.hasImage && <p className="muted small">Photo attached</p>}
            {message.role === 'assistant' ? <Markdown>{message.text}</Markdown> : <p>{message.text}</p>}
            <Sources citations={message.citations} />
          </article>
        ))}
        {streaming && (
          <article className="bubble assistant">
            <Markdown>{streaming}</Markdown>
          </article>
        )}
        {busy && !streaming && <p className="status">{status || 'Thinking…'}</p>}
        {pending.map((approval) => (
          <div className="approval" key={approval.id}>
            <p className="approval-label">Needs your approval</p>
            <p>{approval.summary}</p>
            <div className="row">
              <button className="primary" disabled={busy} onClick={() => void decide(approval, true)}>Approve</button>
              <button className="ghost" disabled={busy} onClick={() => void decide(approval, false)}>Decline</button>
            </div>
          </div>
        ))}
        {error && <p className="error" role="alert">{error}</p>}
        <div ref={endRef} />
      </div>

      <div className="composer-wrap">
        {suggestions.length > 0 && (
          <ul className="suggestions">
            {suggestions.map((skill) => (
              <li key={skill.name}>
                <button onClick={() => setInput(`/${skill.name} `)}>
                  <strong>/{skill.name}</strong> <span className="muted">{skill.description}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {activeSkill && <p className="skill-tag">Skill: {activeSkill}</p>}
        {photo && (
          <p className="attachment">
            Photo ready
            <button className="link" onClick={() => setPhoto(undefined)}>Remove</button>
          </p>
        )}
        <form className="composer" onSubmit={send}>
          <label className="attach">
            <span className="sr-only">Attach a photo</span>
            <span aria-hidden="true">+</span>
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) photoToInput(file).then(setPhoto).catch(() => setError('That photo could not be read'));
              }}
            />
          </label>
          <textarea
            aria-label="Message"
            rows={1}
            value={input}
            disabled={blocked}
            placeholder={blocked ? 'Approve or decline first' : 'Message, or / for skills'}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {busy ? (
            <button type="button" className="ghost" onClick={() => runId && void api.stopRun(runId)}>Stop</button>
          ) : (
            <button type="submit" className="primary" disabled={blocked || (!input.trim() && !photo)}>Send</button>
          )}
        </form>
      </div>
    </section>
  );
}
