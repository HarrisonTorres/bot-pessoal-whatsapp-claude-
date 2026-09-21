import test from 'node:test';
import assert from 'node:assert/strict';
import { extractContent, decide } from '../src/filters.js';

const groups = { '1203@g.us': { agente: 'eco' } };
const ownerJids = ['5511999990000@s.whatsapp.net', '999@lid'];
const key = (extra = {}) => ({
  remoteJid: '1203@g.us', id: 'M1', fromMe: false, participant: '5511999990000:7@s.whatsapp.net', ...extra,
});

test('extractContent reconhece os tipos de mensagem', () => {
  assert.deepEqual(extractContent({ conversation: 'oi' }), { kind: 'text', text: 'oi' });
  assert.deepEqual(extractContent({ extendedTextMessage: { text: 'oi 2' } }), { kind: 'text', text: 'oi 2' });
  assert.deepEqual(
    extractContent({ audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true } }),
    { kind: 'audio', text: '', mime: 'audio/ogg; codecs=opus', ptt: true },
  );
  assert.deepEqual(
    extractContent({ imageMessage: { caption: 'nota', mimetype: 'image/jpeg' } }),
    { kind: 'image', text: 'nota', mime: 'image/jpeg' },
  );
  assert.deepEqual(
    extractContent({ documentWithCaptionMessage: { message: { documentMessage: { fileName: 'nf.pdf', mimetype: 'application/pdf', caption: 'mercado' } } } }),
    { kind: 'document', text: 'mercado', mime: 'application/pdf', fileName: 'nf.pdf' },
  );
  assert.deepEqual(extractContent({ ephemeralMessage: { message: { conversation: 'x' } } }), { kind: 'text', text: 'x' });
  assert.equal(extractContent({ protocolMessage: {} }).kind, 'other');
  assert.equal(extractContent(undefined).kind, 'other');
});

test('decide ignora mensagens próprias, fora de grupo e de grupo não cadastrado', () => {
  const ctx = { ownerJids, groups };
  assert.deepEqual(decide({ key: key({ fromMe: true }) }, ctx), { ok: false, reason: 'own-message' });
  assert.equal(decide({ key: key({ remoteJid: '5511@s.whatsapp.net' }) }, ctx).reason, 'not-group');
  const r = decide({ key: key({ remoteJid: '777@g.us' }) }, ctx);
  assert.equal(r.reason, 'group-not-registered');
  assert.equal(r.groupJid, '777@g.us');
});

test('decide só aceita o dono, por telefone, LID ou par LID/telefone', () => {
  const ctx = { ownerJids, groups };
  const ok = decide({ key: key() }, ctx);
  assert.deepEqual(ok, { ok: true, groupJid: '1203@g.us', senderJid: '5511999990000@s.whatsapp.net' });
  assert.equal(decide({ key: key({ participant: '999:3@lid' }) }, ctx).ok, true);
  assert.equal(
    decide({ key: key({ participant: '111@lid', participantAlt: '5511999990000@s.whatsapp.net' }) }, ctx).ok,
    true,
  );
  const no = decide({ key: key({ participant: '5511888880000@s.whatsapp.net' }) }, ctx);
  assert.equal(no.reason, 'sender-not-owner');
  assert.deepEqual(no.candidates, ['5511888880000@s.whatsapp.net']);
});
