import fs from 'node:fs';
import path from 'node:path';
import { resolveRoute } from './router.js';
import { listOutbox, archive } from './outbox.js';

const MAX_ERROR_ATTEMPTS = 3;
const QUOTA_MAX_AGE_MS = 24 * 3600_000;
const QUOTA_MAX_WAIT_MS = 6 * 3600_000;

export function monthKey(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(ms);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}`;
}

export function sessionExpired(session, nowMs, agent, tz) {
  return session.messages >= agent.sessionResetMessages
    || monthKey(session.startedAt, tz) !== monthKey(nowMs, tz);
}

export function backoffMs(attempts) {
  return Math.min(60_000 * 2 ** attempts, 30 * 60_000);
}

export function resetAtFromError(message, nowMs) {
  const m = /\|(\d{10})\b/.exec(String(message ?? ''));
  if (!m) return null;
  const at = Number(m[1]) * 1000;
  return at > nowMs ? Math.min(at, nowMs + QUOTA_MAX_WAIT_MS) : null;
}

export function buildPrompt({ kind, messageId, text = '', transcript, mediaPath, fileName, mime, receivedAt, tz }) {
  const quando = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(receivedAt);
  const linhas = [`[Mensagem ${messageId} recebida em ${quando}]`];
  if (kind === 'text') linhas.push(text);
  else if (kind === 'audio') linhas.push(`[Áudio transcrito automaticamente] ${transcript}`);
  else if (kind === 'image') {
    linhas.push(`[Imagem anexada: ${mediaPath}]`);
    if (text) linhas.push(text);
  } else if (kind === 'document') {
    linhas.push(`[Documento anexado (${fileName ?? mime}): ${mediaPath}]`);
    if (text) linhas.push(text);
  }
  return linhas.join('\n');
}

const slug = (groupJid) => groupJid.replace('@g.us', '');

export function createProcessor({
  inbox, wa, groups, agentsDir, dataDir, tz, runClaude, transcribe,
  now = Date.now, pause = async () => {}, log,
}) {
  const hhmm = (ms) => new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(ms);

  async function safeSend(groupJid, text) {
    try { await wa.sendText(groupJid, text); } catch (e) { log.warn({ err: String(e) }, 'não consegui avisar o grupo'); }
  }

  async function deliver(groupJid, text, outboxDir) {
    const images = listOutbox(outboxDir);
    if (images.length === 0) {
      if (text) await wa.sendText(groupJid, text);
      return;
    }
    for (const [i, file] of images.entries()) {
      await wa.sendImage(groupJid, file, i === 0 ? text : '');
      archive(file);
    }
  }

  async function onFailure(row, e) {
    const message = String(e?.message ?? e);
    const quota = e?.kind === 'quota';
    const giveUp = quota
      ? now() - row.receivedAt > QUOTA_MAX_AGE_MS
      : row.attempts + 1 >= MAX_ERROR_ATTEMPTS;
    log.warn({ messageId: row.messageId, kind: e?.kind, attempts: row.attempts, err: message }, 'falha ao processar');
    if (giveUp) {
      inbox.markFailed(row.messageId, message);
      await safeSend(row.groupJid, 'Não consegui processar essa mensagem. Pode reenviar mais tarde?');
      return;
    }
    const resetAt = quota ? resetAtFromError(message, now()) : null;
    inbox.retryLater(row.messageId, resetAt ?? now() + backoffMs(row.attempts), message);
    if (quota && row.attempts === 0) {
      await safeSend(row.groupJid, resetAt
        ? `Estou sem cota do Claude agora. Volto a responder por volta de ${hhmm(resetAt)}.`
        : 'Estou sem cota do Claude agora e vou tentar de novo automaticamente.');
    }
  }

  async function handle(row) {
    const route = resolveRoute(row.groupJid, groups, agentsDir);
    if (!route) {
      inbox.markFailed(row.messageId, 'grupo não cadastrado');
      return;
    }
    const key = slug(row.groupJid);
    const outboxDir = path.join(dataDir, 'outbox', key);
    const mediaDir = path.join(dataDir, 'media', key);
    try {
      let transcript = null;
      if (row.kind === 'audio') {
        try {
          transcript = await transcribe(row.payload.mediaPath);
        } catch (e) {
          log.warn({ err: String(e) }, 'transcrição falhou');
          await wa.sendText(row.groupJid, 'Não consegui entender o áudio. Pode repetir ou escrever?');
          inbox.markDone(row.messageId);
          return;
        }
      }
      let session = inbox.getSession(row.groupJid);
      if (session && sessionExpired(session, now(), route.agent, tz)) {
        inbox.resetSession(row.groupJid);
        session = null;
      }
      const prompt = buildPrompt({
        kind: row.kind, messageId: row.messageId, ...row.payload, transcript, receivedAt: row.receivedAt, tz,
      });
      fs.mkdirSync(outboxDir, { recursive: true });
      fs.mkdirSync(mediaDir, { recursive: true });
      await wa.sendTyping(row.groupJid);
      const result = await runClaude({
        prompt, agent: route.agent, sessionId: session?.sessionId ?? null, addDirs: [mediaDir],
        env: { BOT_GROUP_ID: row.groupJid, BOT_DATA_DIR: dataDir, BOT_OUTBOX_DIR: outboxDir },
      });
      if (result.sessionId) inbox.recordTurn(row.groupJid, result.sessionId, now());
      await pause();
      await deliver(row.groupJid, result.text, outboxDir);
      inbox.markDone(row.messageId);
    } catch (e) {
      await onFailure(row, e);
    }
  }

  return { handle };
}
