import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openBridgeDb } from '../src/inbox.js';

const msg = (id, extra = {}) => ({
  messageId: id, groupJid: 'g1@g.us', senderJid: '55@s.whatsapp.net',
  kind: 'text', receivedAt: 1000, payload: { text: id }, ...extra,
});

test('enqueue é idempotente por message_id', () => {
  const inbox = openBridgeDb(':memory:');
  assert.equal(inbox.enqueue(msg('a')), true);
  assert.equal(inbox.enqueue(msg('a')), false);
  assert.equal(inbox.countPending(), 1);
});

test('nextDue segue a ordem de chegada e respeita next_attempt_at', () => {
  const inbox = openBridgeDb(':memory:');
  inbox.enqueue(msg('b', { receivedAt: 2000 }));
  inbox.enqueue(msg('a', { receivedAt: 1000 }));
  assert.equal(inbox.nextDue(0).messageId, 'a');
  inbox.retryLater('a', 5000, 'quota');
  assert.equal(inbox.nextDue(1000).messageId, 'b');
  assert.equal(inbox.nextDue(6000).messageId, 'a');
  assert.equal(inbox.nextDueAt(), 0);
  const row = inbox.nextDue(6000);
  assert.equal(row.attempts, 1);
  assert.equal(row.error, 'quota');
  assert.deepEqual(row.payload, { text: 'a' });
});

test('markDone e markFailed tiram a mensagem da fila', () => {
  const inbox = openBridgeDb(':memory:');
  inbox.enqueue(msg('a'));
  inbox.enqueue(msg('b'));
  inbox.markDone('a');
  inbox.markFailed('b', 'boom');
  assert.equal(inbox.countPending(), 0);
  assert.equal(inbox.statusOf('a'), 'feito');
  assert.equal(inbox.statusOf('b'), 'falhou');
  assert.equal(inbox.nextDue(Date.now()), null);
  assert.equal(inbox.nextDueAt(), null);
});

test('pendentes sobrevivem a reabrir o banco', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wa-')), 'db', 'bridge.db');
  const a = openBridgeDb(file);
  a.enqueue(msg('a'));
  a.close();
  const b = openBridgeDb(file);
  assert.equal(b.countPending(), 1);
  b.close();
});

test('sessões: recordTurn cria, soma e guarda o id devolvido; resetSession apaga', () => {
  const inbox = openBridgeDb(':memory:');
  assert.equal(inbox.getSession('g1@g.us'), null);
  inbox.recordTurn('g1@g.us', 's1', 1000);
  inbox.recordTurn('g1@g.us', 's2', 2000);
  assert.deepEqual({ ...inbox.getSession('g1@g.us') }, { sessionId: 's2', startedAt: 1000, messages: 2 });
  inbox.resetSession('g1@g.us');
  assert.equal(inbox.getSession('g1@g.us'), null);
});
