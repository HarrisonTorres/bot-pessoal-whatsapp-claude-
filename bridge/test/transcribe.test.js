import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeAudio, TranscriptionError } from '../src/transcribe.js';
import { fakeSpawn } from './helpers/fake-spawn.js';

const base = { file: 'D:/m/a.ogg', pythonBin: 'py.exe', script: 't.py', model: 'small' };

test('devolve o texto do JSON do Python e monta os argumentos', async () => {
  const spawnFn = fakeSpawn({ stdout: JSON.stringify({ text: ' gastei 50 reais ', language: 'pt' }) });
  assert.equal(await transcribeAudio({ ...base, spawnFn }), 'gastei 50 reais');
  assert.equal(spawnFn.calls[0].bin, 'py.exe');
  assert.deepEqual(spawnFn.calls[0].args, ['t.py', 'D:/m/a.ogg', '--model', 'small', '--language', 'pt']);
});

test('texto vazio vira TranscriptionError', async () => {
  const spawnFn = fakeSpawn({ stdout: JSON.stringify({ text: '', language: 'pt' }) });
  await assert.rejects(transcribeAudio({ ...base, spawnFn }), TranscriptionError);
});

test('saída com erro usa a mensagem do stderr', async () => {
  const spawnFn = fakeSpawn({ stderr: JSON.stringify({ error: 'sem modelo' }), code: 1 });
  await assert.rejects(transcribeAudio({ ...base, spawnFn }), /sem modelo/);
});

test('estoura o tempo limite e mata o processo', async () => {
  const spawnFn = fakeSpawn({ hang: true });
  await assert.rejects(transcribeAudio({ ...base, spawnFn, timeoutMs: 20 }), /tempo limite/);
  assert.equal(spawnFn.calls[0].child.killed, true);
});
