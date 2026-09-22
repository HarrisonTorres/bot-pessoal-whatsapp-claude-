import fs from 'node:fs';
import path from 'node:path';

export class LockError extends Error {}

function defaultIsRunning(pid) {
  try {
    process.kill(pid, 0); // não mata; só verifica se o processo existe (funciona no Windows também)
    return true;
  } catch {
    return false;
  }
}

// Garante uma única instância da ponte por dataDir. Duas instâncias competindo pela mesma
// sessão do WhatsApp fazem o WhatsApp derrubar uma a cada conexão da outra (code 440, "conflict/replaced"),
// num loop infinito de reconexão. Achado ao vivo em 2026-09-21 (dois `npm start` esquecidos abertos).
export function acquireLock(dataDir, { pid = process.pid, isRunning = defaultIsRunning } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'bridge.lock');
  if (fs.existsSync(file)) {
    const held = Number.parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
    if (!Number.isInteger(held) || isRunning(held)) {
      throw new LockError(
        `Já existe uma ponte rodando (pid ${Number.isInteger(held) ? held : 'desconhecido'}). `
        + 'Feche o outro terminal ou processo antes de iniciar de novo — duas instâncias ao mesmo tempo '
        + 'derrubam a conexão do WhatsApp uma da outra.',
      );
    }
    // trava de um processo que não existe mais (encerrou sem limpar): assume
  }
  fs.writeFileSync(file, String(pid));
  return {
    release() {
      if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim() === String(pid)) {
        fs.rmSync(file, { force: true });
      }
    },
  };
}
