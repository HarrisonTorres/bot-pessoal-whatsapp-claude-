import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildClaudeArgs, parseClaudeOutput, runClaude, ClaudeError } from '../src/runner.js';
import { fakeSpawn } from './helpers/fake-spawn.js';

const agent = {
  name: 'eco', dir: 'C:/agents/eco', model: 'haiku', maxTurns: 4,
  tools: ['Read', 'Bash'], allowedTools: ['Read', 'Bash(finance *)'],
};
const ok = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: ' pong ', session_id: 's-1', total_cost_usd: 0.01, duration_ms: 1200 });

test('buildClaudeArgs monta a chamada restrita e nunca usa --bare', () => {
  assert.deepEqual(buildClaudeArgs({ agent, sessionId: 'abc', addDirs: ['D:/m'] }), [
    '-p', '--output-format', 'json', '--model', 'haiku', '--max-turns', '4',
    '--tools', 'Read,Bash', '--allowedTools', 'Read,Bash(finance *)',
    '--permission-mode', 'dontAsk', '--disable-slash-commands',
    '--restricted', '--strict-mcp-config',
    '--append-system-prompt-file', path.join('C:/agents/eco', 'CLAUDE.md'),
    '--resume', 'abc', '--add-dir', 'D:/m',
  ]);
  const semSessao = buildClaudeArgs({ agent });
  assert.ok(!semSessao.includes('--resume'));
  assert.ok(!semSessao.includes('--add-dir'));
  assert.ok(!semSessao.includes('--bare'));
  assert.ok(semSessao.includes('--restricted'));
});

test('buildClaudeArgs usa caminho absoluto para o CLAUDE.md mesmo com agent.dir relativo', () => {
  const args = buildClaudeArgs({ agent: { ...agent, dir: path.join('agents', 'eco') } });
  const file = args[args.indexOf('--append-system-prompt-file') + 1];
  assert.equal(file, path.resolve('agents', 'eco', 'CLAUDE.md'));
});

test('parseClaudeOutput entende a saída real capturada no spike', () => {
  const raw = fs.readFileSync(new URL('./fixtures/claude-result.json', import.meta.url), 'utf8');
  const r = parseClaudeOutput(raw);
  assert.ok(r.text.length > 0);
  assert.equal(typeof r.sessionId, 'string');
});

test('parseClaudeOutput trata resultado sintético, array, erro e lixo', () => {
  assert.deepEqual({ ...parseClaudeOutput(ok) }, { text: 'pong', sessionId: 's-1', costUsd: 0.01, durationMs: 1200 });
  assert.equal(parseClaudeOutput(`[{"type":"system"},${ok}]`).text, 'pong');
  const limite = JSON.stringify({ type: 'result', is_error: true, result: 'Claude AI usage limit reached|1760000000' });
  assert.throws(() => parseClaudeOutput(limite), (e) => e instanceof ClaudeError && e.kind === 'quota');
  const maxTurns = JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: false });
  assert.throws(() => parseClaudeOutput(maxTurns), (e) => e.kind === 'error');
  assert.throws(() => parseClaudeOutput('nao é json'), (e) => e.kind === 'parse');
});

test('runClaude envia o prompt por stdin, roda na pasta do agente e repassa o ambiente', async () => {
  const spawnFn = fakeSpawn({ stdout: ok });
  const r = await runClaude({
    prompt: '-50 reais de gasolina', agent, sessionId: 's-0', addDirs: ['D:/m'],
    env: { BOT_GROUP_ID: 'g1@g.us' }, claudeConfigDir: 'D:/cfg', spawnFn,
  });
  assert.equal(r.text, 'pong');
  const c = spawnFn.calls[0];
  assert.equal(c.bin, 'claude');
  assert.equal(c.stdin, '-50 reais de gasolina');
  assert.equal(c.opts.cwd, 'C:/agents/eco');
  assert.equal(c.opts.env.BOT_GROUP_ID, 'g1@g.us');
  assert.equal(c.opts.env.CLAUDE_CONFIG_DIR, 'D:/cfg');
  assert.equal(c.opts.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
  assert.equal(c.opts.env.DISABLE_AUTOUPDATER, '1');
});

test('runClaude classifica falha de cota pelo stderr', async () => {
  const spawnFn = fakeSpawn({ stderr: 'Error: rate limit exceeded', code: 1 });
  await assert.rejects(runClaude({ prompt: 'x', agent, spawnFn }), (e) => e.kind === 'quota');
});

test('runClaude mata o processo no timeout', async () => {
  const spawnFn = fakeSpawn({ hang: true });
  await assert.rejects(runClaude({ prompt: 'x', agent, spawnFn, timeoutMs: 20 }), (e) => e.kind === 'timeout');
  assert.equal(spawnFn.calls[0].child.killed, true);
});
