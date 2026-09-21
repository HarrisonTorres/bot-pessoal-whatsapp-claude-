import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { createFakeWa } from './helpers/fake-wa.js';
import { waitUntil } from './helpers/wait.js';

const OWNER = '5511999990000@s.whatsapp.net';
const groups = { 'g1@g.us': { agente: 'eco' }, 'g2@g.us': { agente: 'outro' } };
const silent = { info() {}, warn() {}, error() {} };

function newDataDir() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-'));
  for (const name of ['eco', 'outro']) {
    fs.mkdirSync(path.join(dataDir, 'agents', name), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'agents', name, 'CLAUDE.md'), 'x');
  }
  return dataDir;
}

function makeApp(dataDir) {
  const wa = createFakeWa();
  const calls = [];
  const config = {
    dataDir, ownerJids: [OWNER], tz: 'America/Sao_Paulo', agentsDir: path.join(dataDir, 'agents'),
    claudeBin: 'claude', claudeConfigDir: null, pythonBin: 'py', transcriberScript: 't.py', whisperModel: 'small',
  };
  const app = buildApp({
    config, groups, wa, log: silent, pause: async () => {},
    runClaude: async (o) => {
      calls.push({ agent: o.agent.name, prompt: o.prompt });
      return { text: `resp ${o.agent.name}`, sessionId: `s-${o.agent.name}` };
    },
    transcribe: async () => 'texto do áudio',
  });
  return { app, wa, calls };
}

const msg = (id, groupJid, text, key = {}) => ({
  key: { remoteJid: groupJid, id, fromMe: false, participant: `${OWNER.split('@')[0]}:3@s.whatsapp.net`, ...key },
  message: { conversation: text },
  messageTimestamp: 1_700_000_000,
});
const textos = (wa) => wa.sent.filter((s) => s.type === 'text');

test('cada grupo é roteado para o seu agente e a resposta volta ao mesmo grupo', async () => {
  const { app, wa, calls } = makeApp(newDataDir());
  app.worker.start();
  await app.ingest.onMessage(msg('M1', 'g1@g.us', 'oi um'));
  await app.ingest.onMessage(msg('M2', 'g2@g.us', 'oi dois'));
  await waitUntil(() => textos(wa).length === 2);
  await app.worker.stop();
  assert.deepEqual(calls.map((c) => c.agent), ['eco', 'outro']);
  assert.deepEqual(textos(wa).map((s) => [s.jid, s.text]), [['g1@g.us', 'resp eco'], ['g2@g.us', 'resp outro']]);
});

test('ignora outro remetente, mensagem própria (sem loop) e grupo não cadastrado', async () => {
  const { app, wa, calls } = makeApp(newDataDir());
  app.worker.start();
  await app.ingest.onMessage(msg('M1', 'g1@g.us', 'x', { participant: '5511888880000@s.whatsapp.net' }));
  await app.ingest.onMessage(msg('M2', 'g1@g.us', 'x', { fromMe: true }));
  await app.ingest.onMessage(msg('M3', 'g9@g.us', 'x'));
  await new Promise((r) => setTimeout(r, 100));
  await app.worker.stop();
  assert.equal(calls.length, 0);
  assert.equal(wa.sent.length, 0);
});

test('áudio é transcrito e a imagem chega ao agente com o caminho do arquivo', async () => {
  const dataDir = newDataDir();
  const { app, wa, calls } = makeApp(dataDir);
  app.worker.start();
  const audio = msg('A1', 'g1@g.us', '');
  audio.message = { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true } };
  const imagem = msg('I1', 'g1@g.us', '');
  imagem.message = { imageMessage: { mimetype: 'image/jpeg', caption: 'nota do mercado' } };
  await app.ingest.onMessage(audio);
  await app.ingest.onMessage(imagem);
  await waitUntil(() => textos(wa).length === 2);
  await app.worker.stop();
  assert.match(calls[0].prompt, /Áudio transcrito automaticamente\] texto do áudio/);
  assert.ok(calls[1].prompt.includes(path.join(dataDir, 'media', 'g1', 'I1.jpg')));
  assert.match(calls[1].prompt, /nota do mercado/);
});

test('mensagens pendentes são reprocessadas depois de um reinício', async () => {
  const dataDir = newDataDir();
  const antes = makeApp(dataDir);
  await antes.app.ingest.onMessage(msg('M1', 'g1@g.us', 'chegou antes de cair'));
  antes.app.inbox.close();
  const depois = makeApp(dataDir);
  depois.app.worker.start();
  await waitUntil(() => textos(depois.wa).length === 1);
  await depois.app.worker.stop();
  assert.equal(depois.calls.length, 1);
  assert.match(depois.calls[0].prompt, /chegou antes de cair/);
  assert.equal(depois.app.inbox.statusOf('M1'), 'feito');
});
