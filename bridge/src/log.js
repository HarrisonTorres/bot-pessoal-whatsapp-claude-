import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';

export function createLogger(dataDir) {
  const dir = path.join(dataDir, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return pino({ level: 'info' }, pino.multistream([
    { stream: process.stdout },
    { stream: pino.destination({ dest: path.join(dir, 'bridge.log'), sync: true }) },
  ]));
}
