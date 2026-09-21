import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadGroups, loadAgent, resolveRoute } from '../src/router.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wa-'));

test('loadGroups valida ID de grupo e agente', () => {
  const f = path.join(tmp(), 'groups.json');
  fs.writeFileSync(f, JSON.stringify({ grupos: { '1203@g.us': { agente: 'eco' } } }));
  assert.deepEqual(loadGroups(f), { '1203@g.us': { agente: 'eco' } });
  fs.writeFileSync(f, JSON.stringify({ grupos: { '551@s.whatsapp.net': { agente: 'eco' } } }));
  assert.throws(() => loadGroups(f), /ID de grupo inválido/);
  fs.writeFileSync(f, JSON.stringify({ grupos: { '1203@g.us': {} } }));
  assert.throws(() => loadGroups(f), /sem "agente"/);
});

test('loadGroups explica quando o arquivo não existe', () => {
  assert.throws(() => loadGroups(path.join(tmp(), 'nao-existe.json')), /groups\.example\.json/);
});

test('loadAgent aplica padrões e exige CLAUDE.md', () => {
  const agents = tmp();
  fs.mkdirSync(path.join(agents, 'eco'));
  assert.throws(() => loadAgent(agents, 'eco'), /sem CLAUDE\.md/);
  fs.writeFileSync(path.join(agents, 'eco', 'CLAUDE.md'), 'oi');
  let a = loadAgent(agents, 'eco');
  assert.equal(a.model, 'sonnet');
  assert.equal(a.maxTurns, 8);
  assert.deepEqual(a.tools, ['Read']);
  assert.deepEqual(a.allowedTools, ['Read']);
  assert.equal(a.sessionResetMessages, 100);
  assert.equal(a.dir, path.join(agents, 'eco'));
  fs.writeFileSync(path.join(agents, 'eco', 'agent.json'), JSON.stringify({ model: 'haiku', maxTurns: 3 }));
  a = loadAgent(agents, 'eco');
  assert.equal(a.model, 'haiku');
  assert.equal(a.maxTurns, 3);
});

test('resolveRoute devolve null para grupo não cadastrado', () => {
  const agents = tmp();
  fs.mkdirSync(path.join(agents, 'eco'));
  fs.writeFileSync(path.join(agents, 'eco', 'CLAUDE.md'), 'oi');
  const groups = { '1203@g.us': { agente: 'eco' } };
  assert.equal(resolveRoute('999@g.us', groups, agents), null);
  const r = resolveRoute('1203@g.us', groups, agents);
  assert.equal(r.groupJid, '1203@g.us');
  assert.equal(r.agent.name, 'eco');
});
