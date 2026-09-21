import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openBridgeDb } from '../src/inbox.js';
import { listOutbox } from '../src/outbox.js';
import {
  monthKey, sessionExpired, backoffMs, resetAtFromError, buildPrompt, createProcessor,
} from '../src/processor.js';
import { createFakeWa } from './helpers/fake-wa.js';

const NOW = 1_800_000_000_000;
const TZ = 'America/Sao_Paulo';
const silent = { info() {}, warn() {}, error() {} };
const ANY = Number.MAX_SAFE_INTEGER;

function setup({ agentJson, runClaude, transcribe } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-'));
  const agentsDir = path.join(dataDir, 'agents');
  fs.mkdirSync(path.join(agentsDir, 'eco'), { recursive: true });
  fs.writeFileSync(path.join(agentsDir, 'eco', 'CLAUDE.md'), 'x');
  if (agentJson) fs.writeFileSync(path.join(agentsDir, 'eco', 'agent.json'), JSON.stringify(agentJson));
  const inbox = openBridgeDb(':memory:');
  const wa = createFakeWa();
  const calls = [];
  const processor = createProcessor({
    inbox, wa, groups: { 'g1@g.us': { agente: 'eco' } }, agentsDir, dataDir, tz: TZ,
    runClaude: runClaude ?? (async (o) => { calls.push(o); return { text: 'ok!', sessionId: 's-1' }; }),
    transcribe: transcribe ?? (async () => 'gastei 50 reais'),
    now: () => NOW, pause: async () => {}, log: silent,
  });
  const add = (id, kind = 'text', payload = { text: 'oi' }, groupJid = 'g1@g.us') => {
    inbox.enqueue({ messageId: id, groupJid, senderJid: '5511@s.whatsapp.net', kind, receivedAt: NOW, payload });
    return inbox.nextDue(ANY);
  };
  return { dataDir, inbox, wa, calls, processor, add };
}

test('funções puras: monthKey, sessionExpired, backoffMs, resetAtFromError', () => {
  assert.equal(monthKey(Date.UTC(2026, 8, 30, 12), TZ), '2026-09');
  assert.equal(monthKey(Date.UTC(2026, 9, 1, 2), TZ), '2026-09'); // 23h de 30/09 em São Paulo
  const agent = { sessionResetMessages: 100 };
  const s = { sessionId: 'x', startedAt: Date.UTC(2026, 8, 10), messages: 5 };
  assert.equal(sessionExpired(s, Date.UTC(2026, 8, 20), agent, TZ), false);
  assert.equal(sessionExpired({ ...s, messages: 100 }, Date.UTC(2026, 8, 20), agent, TZ), true);
  assert.equal(sessionExpired(s, Date.UTC(2026, 9, 5), agent, TZ), true);
  assert.deepEqual([0, 1, 2, 10].map(backoffMs), [60_000, 120_000, 240_000, 1_800_000]);
  assert.equal(resetAtFromError('Claude AI usage limit reached|1800003600', NOW), 1_800_003_600_000);
  assert.equal(resetAtFromError('usage limit reached|1799999999', NOW), null);
  assert.equal(resetAtFromError('sem horário', NOW), null);
});

test('buildPrompt inclui o id da mensagem e os anexos', () => {
  const base = { messageId: 'M1', receivedAt: NOW, tz: TZ };
  assert.match(buildPrompt({ ...base, kind: 'text', text: 'oi' }), /^\[Mensagem M1 recebida em .+\]\noi$/);
  assert.match(buildPrompt({ ...base, kind: 'audio', transcript: 'gastei 50' }), /\[Áudio transcrito automaticamente\] gastei 50$/);
  assert.match(buildPrompt({ ...base, kind: 'image', mediaPath: 'D:/a.jpg', text: 'nota' }), /\[Imagem anexada: D:\/a\.jpg\]\nnota$/);
  assert.match(buildPrompt({ ...base, kind: 'document', mediaPath: 'D:/a.pdf', fileName: 'nf.pdf', mime: 'application/pdf' }), /\[Documento anexado \(nf\.pdf\): D:\/a\.pdf\]$/);
});

test('texto: chama o Claude com env e pastas do grupo, responde e marca como feito', async () => {
  const t = setup();
  await t.processor.handle(t.add('M1'));
  assert.equal(t.calls.length, 1);
  assert.match(t.calls[0].prompt, /Mensagem M1/);
  assert.equal(t.calls[0].sessionId, null);
  assert.equal(t.calls[0].env.BOT_GROUP_ID, 'g1@g.us');
  assert.equal(t.calls[0].env.BOT_DATA_DIR, t.dataDir);
  assert.equal(t.calls[0].env.BOT_OUTBOX_DIR, path.join(t.dataDir, 'outbox', 'g1'));
  assert.deepEqual(t.calls[0].addDirs, [path.join(t.dataDir, 'media', 'g1')]);
  assert.deepEqual(t.wa.sent.map((s) => s.type), ['typing', 'text']);
  assert.equal(t.wa.sent[1].text, 'ok!');
  assert.equal(t.inbox.statusOf('M1'), 'feito');
  assert.equal(t.inbox.getSession('g1@g.us').messages, 1);
});

test('a segunda mensagem retoma a sessão; sessionResetMessages a reinicia', async () => {
  const t = setup();
  await t.processor.handle(t.add('M1'));
  await t.processor.handle(t.add('M2'));
  assert.equal(t.calls[1].sessionId, 's-1');
  const u = setup({ agentJson: { sessionResetMessages: 1 } });
  await u.processor.handle(u.add('M1'));
  await u.processor.handle(u.add('M2'));
  assert.equal(u.calls[1].sessionId, null);
});

test('áudio: transcreve antes de chamar o Claude; falha pede para repetir sem chamar o Claude', async () => {
  const t = setup();
  await t.processor.handle(t.add('A1', 'audio', { mediaPath: 'D:/a.ogg', mime: 'audio/ogg' }));
  assert.match(t.calls[0].prompt, /gastei 50 reais/);
  const f = setup({ transcribe: async () => { throw new Error('sem fala'); } });
  await f.processor.handle(f.add('A1', 'audio', { mediaPath: 'D:/a.ogg' }));
  assert.equal(f.calls.length, 0);
  assert.match(f.wa.sent.at(-1).text, /Não consegui entender o áudio/);
  assert.equal(f.inbox.statusOf('A1'), 'feito');
});

test('imagens na outbox saem com a resposta como legenda e são arquivadas', async () => {
  const t = setup({
    runClaude: async (o) => {
      fs.writeFileSync(path.join(o.env.BOT_OUTBOX_DIR, 'r.png'), 'x');
      return { text: 'Relatório do mês', sessionId: 's-1' };
    },
  });
  await t.processor.handle(t.add('M1'));
  const imgs = t.wa.sent.filter((s) => s.type === 'image');
  assert.equal(imgs.length, 1);
  assert.equal(imgs[0].caption, 'Relatório do mês');
  assert.equal(t.wa.sent.some((s) => s.type === 'text'), false);
  assert.deepEqual(listOutbox(path.join(t.dataDir, 'outbox', 'g1')), []);
});

test('cota esgotada: reagenda, avisa uma vez e usa o horário de reset quando existe', async () => {
  const quota = (msg) => Object.assign(new Error(msg), { kind: 'quota' });
  const t = setup({ runClaude: async () => { throw quota('usage limit reached|1800003600'); } });
  await t.processor.handle(t.add('M1'));
  assert.equal(t.inbox.statusOf('M1'), 'pendente');
  assert.equal(t.inbox.nextDue(1_800_003_599_999), null);
  const row = t.inbox.nextDue(1_800_003_600_000);
  assert.equal(row.attempts, 1);
  assert.match(t.wa.sent.at(-1).text, /Estou sem cota do Claude agora\. Volto a responder por volta de \d{2}:\d{2}\./);
  const avisos = t.wa.sent.filter((s) => s.type === 'text').length;
  await t.processor.handle(row);
  assert.equal(t.wa.sent.filter((s) => s.type === 'text').length, avisos);
});

test('erro genérico: 3 tentativas e depois falha com aviso', async () => {
  const t = setup({ runClaude: async () => { throw new Error('boom'); } });
  await t.processor.handle(t.add('M1'));
  assert.equal(t.inbox.statusOf('M1'), 'pendente');
  await t.processor.handle(t.inbox.nextDue(ANY));
  assert.equal(t.inbox.statusOf('M1'), 'pendente');
  await t.processor.handle(t.inbox.nextDue(ANY));
  assert.equal(t.inbox.statusOf('M1'), 'falhou');
  assert.match(t.wa.sent.at(-1).text, /Não consegui processar essa mensagem/);
});

test('grupo não cadastrado vira falha sem chamar o Claude', async () => {
  const t = setup();
  await t.processor.handle(t.add('M1', 'text', { text: 'oi' }, 'outro@g.us'));
  assert.equal(t.inbox.statusOf('M1'), 'falhou');
  assert.equal(t.calls.length, 0);
});
