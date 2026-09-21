import test from 'node:test';
import assert from 'node:assert/strict';

test('node:sqlite está disponível', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (a INTEGER)');
  db.close();
});

test('Baileys expõe a API usada pela ponte', async () => {
  const b = await import('@whiskeysockets/baileys');
  assert.equal(typeof b.default, 'function');
  for (const nome of ['useMultiFileAuthState', 'DisconnectReason', 'fetchLatestBaileysVersion', 'downloadMediaMessage']) {
    assert.ok(b[nome], `Baileys sem ${nome}`);
  }
  assert.equal(typeof b.DisconnectReason.loggedOut, 'number');
});
