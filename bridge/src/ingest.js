import fs from 'node:fs';
import path from 'node:path';
import { decide, extractContent } from './filters.js';

const EXT = {
  'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/wav': '.wav',
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf',
};

export function extFor({ mime, fileName }) {
  const base = String(mime ?? '').split(';')[0].trim().toLowerCase();
  return EXT[base] ?? (path.extname(fileName ?? '') || '.bin');
}

function toMs(timestamp, fallback) {
  const seconds = typeof timestamp === 'object' && timestamp?.toNumber ? timestamp.toNumber() : Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallback;
}

export function createIngest({ inbox, wa, worker, groups, ownerJids, dataDir, now = Date.now, log }) {
  async function onMessage(msg) {
    const d = decide(msg, { ownerJids, groups });
    if (!d.ok) {
      log.info({ reason: d.reason, groupJid: d.groupJid ?? msg.key?.remoteJid, candidates: d.candidates }, 'mensagem ignorada');
      return;
    }
    const content = extractContent(msg.message);
    if (content.kind === 'other') {
      log.info({ groupJid: d.groupJid }, 'tipo de mensagem não suportado');
      return;
    }
    const messageId = msg.key.id;
    if (inbox.statusOf(messageId)) return;

    const payload = { text: content.text, mime: content.mime ?? null, fileName: content.fileName ?? null, mediaPath: null };
    if (content.kind !== 'text') {
      try {
        const buffer = await wa.downloadMedia(msg);
        const dir = path.join(dataDir, 'media', d.groupJid.replace('@g.us', ''));
        fs.mkdirSync(dir, { recursive: true });
        payload.mediaPath = path.join(dir, `${messageId}${extFor(content)}`);
        fs.writeFileSync(payload.mediaPath, buffer);
      } catch (e) {
        log.warn({ err: String(e), messageId }, 'falha ao baixar o anexo');
        await wa.sendText(d.groupJid, 'Não consegui baixar o anexo. Pode reenviar?');
        return;
      }
    }
    const inserted = inbox.enqueue({
      messageId, groupJid: d.groupJid, senderJid: d.senderJid, kind: content.kind,
      receivedAt: toMs(msg.messageTimestamp, now()), payload,
    });
    if (inserted) worker.notify();
  }

  return { onMessage };
}
