import { normalizeJid } from './jid.js';

export function unwrapMessage(message) {
  let m = message ?? {};
  for (let i = 0; i < 5; i++) {
    const inner = m.ephemeralMessage?.message
      ?? m.viewOnceMessage?.message
      ?? m.viewOnceMessageV2?.message
      ?? m.documentWithCaptionMessage?.message
      ?? m.editedMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m;
}

export function extractContent(message) {
  const m = unwrapMessage(message);
  if (m.conversation) return { kind: 'text', text: m.conversation };
  if (m.extendedTextMessage?.text) return { kind: 'text', text: m.extendedTextMessage.text };
  if (m.audioMessage) {
    return { kind: 'audio', text: '', mime: m.audioMessage.mimetype ?? 'audio/ogg', ptt: Boolean(m.audioMessage.ptt) };
  }
  if (m.imageMessage) {
    return { kind: 'image', text: m.imageMessage.caption ?? '', mime: m.imageMessage.mimetype ?? 'image/jpeg' };
  }
  if (m.documentMessage) {
    return {
      kind: 'document',
      text: m.documentMessage.caption ?? '',
      mime: m.documentMessage.mimetype ?? 'application/octet-stream',
      fileName: m.documentMessage.fileName ?? null,
    };
  }
  return { kind: 'other', text: '' };
}

// Regra de acesso: só grupos cadastrados são lidos. Por padrão qualquer membro é atendido (quem controla
// o acesso é quem controla a entrada no grupo). Com `somenteDono: true` no cadastro do grupo, só o dono.
export function decide(msg, { ownerJids = [], groups }) {
  const key = msg.key ?? {};
  if (key.fromMe) return { ok: false, reason: 'own-message' };
  const groupJid = key.remoteJid;
  if (!groupJid?.endsWith('@g.us')) return { ok: false, reason: 'not-group' };
  const entry = groups[groupJid];
  if (!entry) return { ok: false, reason: 'group-not-registered', groupJid };
  const candidates = [key.participant, key.participantAlt].filter(Boolean).map(normalizeJid);
  if (entry.somenteDono) {
    const senderJid = candidates.find((c) => ownerJids.includes(c));
    if (!senderJid) return { ok: false, reason: 'sender-not-owner', groupJid, candidates };
    return { ok: true, groupJid, senderJid };
  }
  const senderJid = candidates.find((c) => c.endsWith('@s.whatsapp.net')) ?? candidates[0] ?? '';
  return { ok: true, groupJid, senderJid };
}
