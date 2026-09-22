import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireLock, LockError } from '../src/lock.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wa-'));

test('primeira instância adquire a trava e grava o próprio pid', () => {
  const dataDir = tmp();
  const lock = acquireLock(dataDir, { pid: 111, isRunning: () => true });
  assert.equal(fs.readFileSync(path.join(dataDir, 'bridge.lock'), 'utf8').trim(), '111');
  lock.release();
});

test('segunda instância é recusada enquanto o dono da trava está vivo', () => {
  const dataDir = tmp();
  const a = acquireLock(dataDir, { pid: 111, isRunning: () => true });
  assert.throws(
    () => acquireLock(dataDir, { pid: 222, isRunning: (pid) => pid === 111 }),
    (e) => e instanceof LockError && e.message.includes('111'),
  );
  a.release();
});

test('trava travada (processo morto) é destravada sozinha', () => {
  const dataDir = tmp();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'bridge.lock'), '999');
  const lock = acquireLock(dataDir, { pid: 222, isRunning: () => false });
  assert.equal(fs.readFileSync(path.join(dataDir, 'bridge.lock'), 'utf8').trim(), '222');
  lock.release();
});

test('release() só apaga a trava se ainda for a nossa (não derruba uma instância mais nova)', () => {
  const dataDir = tmp();
  const a = acquireLock(dataDir, { pid: 111, isRunning: () => true });
  fs.writeFileSync(path.join(dataDir, 'bridge.lock'), '333'); // outra instância assumiu depois de um destrave indevido
  a.release();
  assert.equal(fs.readFileSync(path.join(dataDir, 'bridge.lock'), 'utf8').trim(), '333');
});

test('trava com conteúdo ilegível é tratada como travada por um processo vivo', () => {
  const dataDir = tmp();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'bridge.lock'), 'lixo-não-numérico');
  assert.throws(() => acquireLock(dataDir, { pid: 222, isRunning: () => true }), LockError);
});
