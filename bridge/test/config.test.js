import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { normalizeJid } from '../src/jid.js';
import { loadConfig } from '../src/config.js';

test('normalizeJid remove o sufixo de dispositivo e completa o servidor', () => {
  assert.equal(normalizeJid('5511999990000:12@s.whatsapp.net'), '5511999990000@s.whatsapp.net');
  assert.equal(normalizeJid('123456@lid'), '123456@lid');
  assert.equal(normalizeJid('5511999990000'), '5511999990000@s.whatsapp.net');
  assert.equal(normalizeJid(undefined), '');
});

test('loadConfig lê dono, LID opcional e caminhos padrão', () => {
  const root = path.resolve('C:/tmp/proj');
  const cfg = loadConfig({ env: { OWNER_JID: '5511999990000@s.whatsapp.net', OWNER_LID: '999@lid' }, root });
  assert.deepEqual(cfg.ownerJids, ['5511999990000@s.whatsapp.net', '999@lid']);
  assert.equal(cfg.dataDir, path.join(root, 'data'));
  assert.equal(cfg.authDir, path.join(root, 'data', 'auth'));
  assert.equal(cfg.groupsFile, path.join(root, 'config', 'groups.json'));
  assert.equal(cfg.agentsDir, path.join(root, 'agents'));
  assert.equal(cfg.tz, 'America/Sao_Paulo');
  assert.equal(cfg.claudeBin, 'claude');
  assert.equal(cfg.claudeConfigDir, null);
  assert.equal(cfg.whisperModel, 'small');
});

test('loadConfig respeita WA_AUTH_DIR e aceita OWNER_JID ausente (o dono só vale em grupos somenteDono)', () => {
  const root = path.resolve('C:/tmp/proj');
  const cfg = loadConfig({ env: { OWNER_JID: '55@s.whatsapp.net', WA_AUTH_DIR: 'C:/auth-fora' }, root });
  assert.equal(cfg.authDir, path.resolve('C:/auth-fora'));
  assert.deepEqual(loadConfig({ env: {}, root }).ownerJids, []);
});
