import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openBridgeDb } from '../src/inbox.js';
import { createIngest, extFor } from '../src/ingest.js';
import { createFakeWa } from './helpers/fake-wa.js';

const groups = { '1203@g.us': { agente: 'eco' } };
const restrito = { '1203@g.us': { agente: 'eco', somenteDono: true } };
const ownerJids = ['5511999990000@s.whatsapp.net'];
const msg = (id, message, key = {}) => ({
  key: { remoteJid: '1203@g.us', id, fromMe: false, participant: '5511999990000:7@s.whatsapp.net', ...key },
  message,
  messageTimestamp: 1_700_000_000,
});

function setup(gruposCadastrados = groups) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-'));
  const inbox = openBridgeDb(':memory:');
  const wa = createFakeWa();
  let downloads = 0;
  const baseDownload = wa.downloadMedia;
  wa.downloadMedia = async (m) => { downloads += 1; return baseDownload(m); };
  const logs = [];
  const log = { info: (o, m) => logs.push({ o, m }), warn() {}, error() {} };
  let notificacoes = 0;
  const worker = { notify() { notificacoes += 1; } };
  const ingest = createIngest({ inbox, wa, worker, groups: gruposCadastrados, ownerJids, dataDir, now: () => 42, log });
  return { dataDir, inbox, wa, logs, ingest, get downloads() { return downloads; }, get notificacoes() { return notificacoes; } };
}

test('extFor escolhe a extensão pelo mime ou pelo nome do arquivo', () => {
  assert.equal(extFor({ mime: 'audio/ogg; codecs=opus' }), '.ogg');
  assert.equal(extFor({ mime: 'image/jpeg' }), '.jpg');
  assert.equal(extFor({ mime: 'application/pdf' }), '.pdf');
  assert.equal(extFor({ mime: 'application/octet-stream', fileName: 'nota.PDF' }), '.PDF');
  assert.equal(extFor({ mime: 'x/y' }), '.bin');
});

test('ignora mensagem própria, de outro remetente (grupo somenteDono) e tipo não suportado', async () => {
  const t = setup(restrito);
  await t.ingest.onMessage(msg('M1', { conversation: 'oi' }, { fromMe: true }));
  await t.ingest.onMessage(msg('M2', { conversation: 'oi' }, { participant: '5511888880000@s.whatsapp.net' }));
  await t.ingest.onMessage(msg('M3', { protocolMessage: {} }));
  assert.equal(t.inbox.countPending(), 0);
  assert.equal(t.notificacoes, 0);
  assert.deepEqual(t.logs.slice(0, 2).map((l) => l.o.reason), ['own-message', 'sender-not-owner']);
  assert.deepEqual(t.logs[1].o.candidates, ['5511888880000@s.whatsapp.net']);
});

test('texto do dono entra na fila e acorda o worker', async () => {
  const t = setup();
  await t.ingest.onMessage(msg('M1', { conversation: 'gastei 50' }));
  const row = t.inbox.nextDue(Number.MAX_SAFE_INTEGER);
  assert.equal(row.messageId, 'M1');
  assert.equal(row.kind, 'text');
  assert.equal(row.senderJid, '5511999990000@s.whatsapp.net');
  assert.equal(row.receivedAt, 1_700_000_000_000);
  assert.equal(row.payload.text, 'gastei 50');
  assert.equal(t.notificacoes, 1);
});

test('áudio: baixa, salva em data/media/<grupo> e enfileira com o caminho', async () => {
  const t = setup();
  await t.ingest.onMessage(msg('M2', { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true } }));
  const row = t.inbox.nextDue(Number.MAX_SAFE_INTEGER);
  const esperado = path.join(t.dataDir, 'media', '1203', 'M2.ogg');
  assert.equal(row.kind, 'audio');
  assert.equal(row.payload.mediaPath, esperado);
  assert.equal(fs.readFileSync(esperado, 'utf8'), 'fake-media');
});

test('mensagem repetida não é baixada nem enfileirada de novo', async () => {
  const t = setup();
  const m = msg('M2', { imageMessage: { mimetype: 'image/jpeg' } });
  await t.ingest.onMessage(m);
  await t.ingest.onMessage(m);
  assert.equal(t.downloads, 1);
  assert.equal(t.inbox.countPending(), 1);
  assert.equal(t.notificacoes, 1);
});

test('timestamp em formato Long é convertido', async () => {
  const t = setup();
  const m = msg('M4', { conversation: 'oi' });
  m.messageTimestamp = { toNumber: () => 1_700_000_005 };
  await t.ingest.onMessage(m);
  assert.equal(t.inbox.nextDue(Number.MAX_SAFE_INTEGER).receivedAt, 1_700_000_005_000);
});

test('falha ao baixar o anexo avisa o grupo e não enfileira', async () => {
  const t = setup();
  t.wa.downloadMedia = async () => { throw new Error('mídia expirada'); };
  await t.ingest.onMessage(msg('M5', { audioMessage: { mimetype: 'audio/ogg' } }));
  assert.equal(t.inbox.countPending(), 0);
  assert.match(t.wa.sent.at(-1).text, /Não consegui baixar o anexo/);
});
