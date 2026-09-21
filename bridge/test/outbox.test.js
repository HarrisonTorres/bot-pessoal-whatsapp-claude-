import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listOutbox, archive } from '../src/outbox.js';

test('listOutbox devolve só imagens, do mais antigo ao mais novo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-'));
  fs.writeFileSync(path.join(dir, 'b.png'), 'x');
  fs.writeFileSync(path.join(dir, 'a.jpg'), 'x');
  fs.writeFileSync(path.join(dir, 'nota.txt'), 'x');
  fs.mkdirSync(path.join(dir, 'sent'));
  fs.utimesSync(path.join(dir, 'a.jpg'), new Date(2026, 0, 1), new Date(2026, 0, 1));
  fs.utimesSync(path.join(dir, 'b.png'), new Date(2026, 0, 2), new Date(2026, 0, 2));
  assert.deepEqual(listOutbox(dir), [path.join(dir, 'a.jpg'), path.join(dir, 'b.png')]);
});

test('listOutbox devolve [] quando a pasta não existe', () => {
  assert.deepEqual(listOutbox(path.join(os.tmpdir(), 'wa-nao-existe-xyz')), []);
});

test('archive move o arquivo para sent/', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-'));
  const file = path.join(dir, 'a.png');
  fs.writeFileSync(file, 'x');
  const dest = archive(file);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(dest), true);
  assert.equal(path.dirname(dest), path.join(dir, 'sent'));
  assert.deepEqual(listOutbox(dir), []);
});
