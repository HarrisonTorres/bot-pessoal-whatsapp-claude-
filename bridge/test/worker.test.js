import test from 'node:test';
import assert from 'node:assert/strict';
import { openBridgeDb } from '../src/inbox.js';
import { createWorker } from '../src/worker.js';

const silent = { info() {}, warn() {}, error() {} };
const add = (inbox, id, receivedAt) => inbox.enqueue({
  messageId: id, groupJid: 'g1@g.us', senderJid: 's', kind: 'text', receivedAt, payload: { text: id },
});
async function waitUntil(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timeout esperando a condição no teste');
}

test('processa em ordem e nunca em paralelo', async () => {
  const inbox = openBridgeDb(':memory:');
  ['a', 'b', 'c'].forEach((id, i) => add(inbox, id, 1000 + i));
  const ordem = [];
  let ativos = 0;
  let maxAtivos = 0;
  const processor = {
    async handle(row) {
      ativos += 1;
      maxAtivos = Math.max(maxAtivos, ativos);
      await new Promise((r) => setTimeout(r, 15));
      ordem.push(row.messageId);
      inbox.markDone(row.messageId);
      ativos -= 1;
    },
  };
  const worker = createWorker({ inbox, processor, log: silent, idleMs: 5000 });
  worker.start();
  await waitUntil(() => inbox.countPending() === 0);
  await worker.stop();
  assert.deepEqual(ordem, ['a', 'b', 'c']);
  assert.equal(maxAtivos, 1);
});

test('acorda com notify() quando a fila estava vazia', async () => {
  const inbox = openBridgeDb(':memory:');
  const vistas = [];
  const processor = { async handle(row) { vistas.push(row.messageId); inbox.markDone(row.messageId); } };
  const worker = createWorker({ inbox, processor, log: silent, idleMs: 5000 });
  worker.start();
  await new Promise((r) => setTimeout(r, 30));
  add(inbox, 'a', 1000);
  worker.notify();
  await waitUntil(() => vistas.length === 1);
  await worker.stop();
});

test('erro inesperado reagenda a mensagem e segue para a próxima', async () => {
  const inbox = openBridgeDb(':memory:');
  add(inbox, 'a', 1000);
  add(inbox, 'b', 2000);
  const feitas = [];
  const processor = {
    async handle(row) {
      if (row.messageId === 'a') throw new Error('bug');
      feitas.push(row.messageId);
      inbox.markDone(row.messageId);
    },
  };
  const worker = createWorker({ inbox, processor, log: silent, idleMs: 5000 });
  worker.start();
  await waitUntil(() => feitas.includes('b'));
  await worker.stop();
  assert.equal(inbox.statusOf('a'), 'pendente');
  assert.equal(inbox.nextDue(Number.MAX_SAFE_INTEGER).attempts, 1);
});

test('na 5ª falha inesperada a mensagem vira falhou', async () => {
  const inbox = openBridgeDb(':memory:');
  add(inbox, 'a', 1000);
  for (let i = 0; i < 4; i += 1) inbox.retryLater('a', 0, 'x');
  const processor = { async handle() { throw new Error('bug'); } };
  const worker = createWorker({ inbox, processor, log: silent, idleMs: 5000 });
  worker.start();
  await waitUntil(() => inbox.statusOf('a') === 'falhou');
  await worker.stop();
});
