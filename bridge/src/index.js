import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, loadConfig } from './config.js';
import { loadGroups, loadAgent } from './router.js';
import { createLogger } from './log.js';
import { createWa } from './wa.js';
import { buildApp } from './app.js';
import { acquireLock, LockError } from './lock.js';

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch { /* sem .env: usa as variáveis já definidas no ambiente */ }

const config = loadConfig();

let lock;
try {
  lock = acquireLock(config.dataDir);
} catch (e) {
  if (e instanceof LockError) {
    console.error(`\n${e.message}\n`); // sem logger ainda: é rápido e evita ruído no log de outra instância
    process.exit(1);
  }
  throw e;
}

const log = createLogger(config.dataDir);
const groups = loadGroups(config.groupsFile);
for (const g of Object.values(groups)) loadAgent(config.agentsDir, g.agente);

function notify(title, message) {
  spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts', 'notify.ps1'),
    '-Title', title, '-Message', message,
  ], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
}

let app;
const wa = createWa({
  authDir: config.authDir,
  log,
  onMessage: (msg) => app.ingest.onMessage(msg),
  onLoggedOut: () => {
    notify('wa-claude', 'WhatsApp desvinculado. Rode "npm start" no terminal e escaneie o QR de novo.');
    setTimeout(() => process.exit(0), 1000); // código 0: o Agendador não deve reiniciar em loop
  },
});
app = buildApp({ config, groups, wa, log });
app.worker.start();
await wa.start();
log.info({ grupos: Object.keys(groups).length }, 'ponte iniciada');

async function shutdown() {
  log.info('encerrando');
  await app.worker.stop();
  wa.stop();
  app.inbox.close();
  lock.release();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (e) => log.error({ err: String(e) }, 'unhandledRejection'));
process.on('uncaughtException', (e) => {
  log.error({ err: String(e) }, 'uncaughtException');
  process.exit(1); // o Agendador reinicia
});
