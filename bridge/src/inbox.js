import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS inbox (
    message_id TEXT PRIMARY KEY,
    group_jid TEXT NOT NULL,
    sender_jid TEXT NOT NULL,
    kind TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','feito','falhou')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    payload TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    group_jid TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    messages INTEGER NOT NULL DEFAULT 0
  );
`;

function hydrate(r) {
  return {
    messageId: r.message_id, groupJid: r.group_jid, senderJid: r.sender_jid, kind: r.kind,
    receivedAt: r.received_at, attempts: r.attempts, error: r.error, payload: JSON.parse(r.payload),
  };
}

export class Inbox {
  constructor(db) { this.db = db; }

  enqueue({ messageId, groupJid, senderJid, kind, receivedAt, payload }) {
    const r = this.db.prepare(
      `INSERT OR IGNORE INTO inbox (message_id, group_jid, sender_jid, kind, received_at, payload)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(messageId, groupJid, senderJid, kind, receivedAt, JSON.stringify(payload));
    return r.changes === 1;
  }

  nextDue(nowMs) {
    const r = this.db.prepare(
      `SELECT * FROM inbox WHERE status = 'pendente' AND next_attempt_at <= ?
       ORDER BY received_at, rowid LIMIT 1`,
    ).get(nowMs);
    return r ? hydrate(r) : null;
  }

  nextDueAt() {
    const r = this.db.prepare(`SELECT MIN(next_attempt_at) AS t FROM inbox WHERE status = 'pendente'`).get();
    return r?.t ?? null;
  }

  markDone(messageId) {
    this.db.prepare(`UPDATE inbox SET status = 'feito', error = NULL WHERE message_id = ?`).run(messageId);
  }

  markFailed(messageId, error) {
    this.db.prepare(`UPDATE inbox SET status = 'falhou', error = ? WHERE message_id = ?`).run(String(error), messageId);
  }

  retryLater(messageId, atMs, error) {
    this.db.prepare(
      `UPDATE inbox SET attempts = attempts + 1, next_attempt_at = ?, error = ? WHERE message_id = ?`,
    ).run(atMs, String(error), messageId);
  }

  countPending() {
    return this.db.prepare(`SELECT COUNT(*) AS n FROM inbox WHERE status = 'pendente'`).get().n;
  }

  statusOf(messageId) {
    return this.db.prepare(`SELECT status FROM inbox WHERE message_id = ?`).get(messageId)?.status ?? null;
  }

  getSession(groupJid) {
    const r = this.db.prepare(`SELECT * FROM sessions WHERE group_jid = ?`).get(groupJid);
    return r ? { sessionId: r.session_id, startedAt: r.started_at, messages: r.messages } : null;
  }

  recordTurn(groupJid, sessionId, nowMs) {
    this.db.prepare(
      `INSERT INTO sessions (group_jid, session_id, started_at, messages) VALUES (?, ?, ?, 1)
       ON CONFLICT(group_jid) DO UPDATE SET session_id = excluded.session_id, messages = messages + 1`,
    ).run(groupJid, sessionId, nowMs);
  }

  resetSession(groupJid) {
    this.db.prepare(`DELETE FROM sessions WHERE group_jid = ?`).run(groupJid);
  }

  close() { this.db.close(); }
}

export function openBridgeDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return new Inbox(db);
}
