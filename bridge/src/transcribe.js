import { spawn } from 'node:child_process';

export class TranscriptionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

function readError(stderr) {
  try { return JSON.parse(stderr).error; } catch { return stderr.trim() || null; }
}

export function transcribeAudio({
  file, pythonBin, script, model = 'small', language = 'pt', timeoutMs = 300_000, spawnFn = spawn,
}) {
  return new Promise((resolve, reject) => {
    const child = spawnFn(pythonBin, [script, file, '--model', model, '--language', language], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new TranscriptionError('transcrição excedeu o tempo limite'));
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.stdin.on('error', () => {});
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new TranscriptionError(`falha ao iniciar o Python: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new TranscriptionError(readError(err) ?? `transcritor saiu com código ${code}`));
        return;
      }
      try {
        const text = String(JSON.parse(out).text ?? '').trim();
        if (!text) throw new TranscriptionError('áudio sem fala reconhecida');
        resolve(text);
      } catch (e) {
        reject(e instanceof TranscriptionError ? e : new TranscriptionError('saída inválida do transcritor'));
      }
    });
    child.stdin.end();
  });
}
