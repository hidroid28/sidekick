import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Citation, EmailStatus, ImageInput, Profile, RecordRow } from '@sidekick/shared';
import { CONFIG } from '../config.js';
import type { AppConfig } from '../config.js';

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'call' | 'tool';
  text: string;
  image: string | null;
  citations: string | null;
  created_at: string;
}
export interface ConversationRow { id: string; title: string; active_skill: string | null; updated_at: string; }
export interface PendingRow {
  id: string;
  conversation_id: string;
  tool: string;
  args: string;
  summary: string;
  status: 'pending' | 'approved' | 'rejected';
}
export interface ChunkRow { document: string; part: number; text: string; }
export interface PaymentLinkRow {
  token: string;
  deposit_id: string;
  recipient_email: string;
  description: string;
  amount: string;
  currency: string;
  network: string;
  to_address: string;
  fee: string | null;
  payee: string;
  email_status: EmailStatus;
  created_at: string;
}
export interface DocumentRow { id: string; name: string; parts: number; created_at: string; }

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, active_skill TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL, text TEXT NOT NULL, image TEXT, citations TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pending_actions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tool TEXT NOT NULL, args TEXT NOT NULL, summary TEXT NOT NULL, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payment_links (
  token TEXT PRIMARY KEY, deposit_id TEXT NOT NULL, recipient_email TEXT NOT NULL, description TEXT NOT NULL,
  amount TEXT NOT NULL, currency TEXT NOT NULL, network TEXT NOT NULL, to_address TEXT NOT NULL, fee TEXT,
  payee TEXT NOT NULL, email_status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, parts INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chunks (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  part INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (document_id, part));
`;

const now = () => new Date().toISOString();

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly db: DatabaseSync;

  constructor(@Inject(CONFIG) config: AppConfig) {
    if (config.databasePath !== ':memory:') mkdirSync(dirname(config.databasePath), { recursive: true });
    this.db = new DatabaseSync(config.databasePath);
    this.db.exec(SCHEMA);
  }

  onModuleDestroy() {
    this.db.close();
  }

  getProfile(): Profile {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = 'profile'`).get() as
      | { value: string }
      | undefined;
    return row ? (JSON.parse(row.value) as Profile) : { name: '', work: '', currency: '' };
  }

  saveProfile(profile: Profile) {
    this.db
      .prepare(`INSERT INTO settings (key, value) VALUES ('profile', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(JSON.stringify(profile));
  }

  createConversation(title: string): ConversationRow {
    const row = { id: randomUUID(), title, active_skill: null, updated_at: now() };
    this.db
      .prepare('INSERT INTO conversations (id, title, updated_at) VALUES (?, ?, ?)')
      .run(row.id, row.title, row.updated_at);
    return row;
  }

  getConversation(id: string) {
    return this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined;
  }

  listConversations() {
    return this.db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all() as unknown as ConversationRow[];
  }

  setActiveSkill(id: string, skill: string | null) {
    this.db.prepare('UPDATE conversations SET active_skill = ? WHERE id = ?').run(skill, id);
  }

  setTitle(id: string, title: string) {
    this.db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, id);
  }

  addMessage(
    conversationId: string,
    role: MessageRow['role'],
    text: string,
    extra: { image?: ImageInput; citations?: Citation[] } = {},
  ) {
    const id = randomUUID();
    const at = now();
    this.db
      .prepare(`INSERT INTO messages (id, conversation_id, role, text, image, citations, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(
        id,
        conversationId,
        role,
        text,
        extra.image ? JSON.stringify(extra.image) : null,
        extra.citations?.length ? JSON.stringify(extra.citations) : null,
        at,
      );
    this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(at, conversationId);
    return id;
  }

  /** The newest `limit` messages, oldest first. */
  recentMessages(conversationId: string, limit = 1000) {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq DESC LIMIT ?')
      .all(conversationId, limit) as unknown as MessageRow[];
    return rows.reverse();
  }

  createPending(conversationId: string, tool: string, args: unknown, summary: string) {
    const id = randomUUID();
    this.db
      .prepare(`INSERT INTO pending_actions (id, conversation_id, tool, args, summary, status)
                VALUES (?, ?, ?, ?, ?, 'pending')`)
      .run(id, conversationId, tool, JSON.stringify(args), summary);
    return id;
  }

  getPending(id: string) {
    return this.db.prepare('SELECT * FROM pending_actions WHERE id = ?').get(id) as PendingRow | undefined;
  }

  openPending(conversationId: string) {
    return this.db
      .prepare(`SELECT * FROM pending_actions WHERE conversation_id = ? AND status = 'pending'`)
      .all(conversationId) as unknown as PendingRow[];
  }

  /** Returns false if the action was already decided, so it can never run twice. */
  settlePending(id: string, status: 'approved' | 'rejected') {
    const result = this.db
      .prepare(`UPDATE pending_actions SET status = ? WHERE id = ? AND status = 'pending'`)
      .run(status, id);
    return Number(result.changes) === 1;
  }

  addRecord(kind: RecordRow['kind'], title: string, amountCents: number, currency: string, data: unknown) {
    const id = randomUUID();
    this.db
      .prepare(`INSERT INTO records (id, kind, title, amount_cents, currency, data, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, kind, title, amountCents, currency, JSON.stringify(data), now());
    return id;
  }

  listRecords(): RecordRow[] {
    const rows = this.db.prepare('SELECT * FROM records ORDER BY created_at DESC, rowid DESC').all() as unknown as {
      id: string;
      kind: RecordRow['kind'];
      title: string;
      amount_cents: number;
      currency: string;
      created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      amountCents: r.amount_cents,
      currency: r.currency,
      createdAt: r.created_at,
    }));
  }

  addPaymentLink(link: Omit<PaymentLinkRow, 'created_at'>) {
    const row: PaymentLinkRow = { ...link, created_at: now() };
    this.db
      .prepare(`INSERT INTO payment_links (token, deposit_id, recipient_email, description, amount, currency,
                network, to_address, fee, payee, email_status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(row.token, row.deposit_id, row.recipient_email, row.description, row.amount, row.currency,
        row.network, row.to_address, row.fee, row.payee, row.email_status, row.created_at);
    return row;
  }

  setPaymentEmailStatus(token: string, status: EmailStatus) {
    this.db.prepare('UPDATE payment_links SET email_status = ? WHERE token = ?').run(status, token);
  }

  getPaymentLink(token: string) {
    return this.db.prepare('SELECT * FROM payment_links WHERE token = ?').get(token) as PaymentLinkRow | undefined;
  }

  listPaymentLinks() {
    return this.db
      .prepare('SELECT * FROM payment_links ORDER BY created_at DESC, rowid DESC')
      .all() as unknown as PaymentLinkRow[];
  }

  addDocument(name: string, chunks: string[]) {
    const id = randomUUID();
    const insert = this.db.prepare('INSERT INTO chunks (document_id, part, text) VALUES (?, ?, ?)');
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare('INSERT INTO documents (id, name, parts, created_at) VALUES (?, ?, ?, ?)')
        .run(id, name, chunks.length, now());
      chunks.forEach((text, i) => insert.run(id, i + 1, text));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return id;
  }

  listDocuments() {
    return this.db.prepare('SELECT * FROM documents ORDER BY created_at DESC').all() as unknown as DocumentRow[];
  }

  deleteDocument(id: string) {
    return Number(this.db.prepare('DELETE FROM documents WHERE id = ?').run(id).changes) === 1;
  }

  allChunks() {
    return this.db
      .prepare(`SELECT d.name AS document, c.part, c.text FROM chunks c JOIN documents d ON d.id = c.document_id`)
      .all() as unknown as ChunkRow[];
  }
}
