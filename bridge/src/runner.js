import path from 'node:path';
import { spawn } from 'node:child_process';

export class ClaudeError extends Error {
  constructor(message, { kind = 'error', detail } = {}) {
    super(message);
    this.name = 'ClaudeError';
    this.kind = kind;
    this.detail = detail;
  }
}

const QUOTA_RE = /(usage limit|rate limit|limit reached|quota|too many requests|overloaded|\b429\b)/i;
const classify = (text) => (QUOTA_RE.test(text) ? 'quota' : 'error');

export function buildClaudeArgs({ agent, sessionId, addDirs = [] }) {
  const args = [
    '-p', '--output-format', 'json',
    '--model', agent.model,
    '--max-turns', String(agent.maxTurns),
    '--tools', agent.tools.join(','),
    '--allowedTools', agent.allowedTools.join(','),
    '--permission-mode', 'dontAsk',
    '--disable-slash-commands',
    '--restricted', '--strict-mcp-config',
    '--append-system-prompt-file', path.join(agent.dir, 'CLAUDE.md'),
  ];
  if (sessionId) args.push('--resume', sessionId);
  if (addDirs.length) args.push('--add-dir', ...addDirs);
  return args;
}

export function parseClaudeOutput(stdout) {
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new ClaudeError('Saída do claude não é JSON', { kind: 'parse', detail: String(stdout).slice(0, 500) });
  }
  if (Array.isArray(data)) data = data.findLast((x) => x?.type === 'result') ?? data.at(-1);
  const text = String(data?.result ?? '');
  if (data?.is_error || String(data?.subtype ?? '').startsWith('error')) {
    throw new ClaudeError(text || `erro do claude (${data?.subtype ?? 'desconhecido'})`, { kind: classify(text), detail: data });
  }
  return {
    text: text.trim(),
    sessionId: data?.session_id ?? null,
    costUsd: data?.total_cost_usd ?? null,
    durationMs: data?.duration_ms ?? null,
  };
}

export function runClaude({
  prompt, agent, sessionId, addDirs, env = {}, bin = 'claude',
  claudeConfigDir = null, timeoutMs = 180_000, spawnFn = spawn,
}) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, ...env };
    if (claudeConfigDir) childEnv.CLAUDE_CONFIG_DIR = claudeConfigDir;
    const child = spawnFn(bin, buildClaudeArgs({ agent, sessionId, addDirs }), {
      cwd: agent.dir, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new ClaudeError('claude excedeu o tempo limite', { kind: 'timeout' }));
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.stdin.on('error', () => {});
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new ClaudeError(`Falha ao iniciar o claude: ${e.message}`, { kind: 'spawn' }));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        if (!out.trim() && code !== 0) {
          throw new ClaudeError(err.trim() || `claude saiu com código ${code}`, { kind: classify(err) });
        }
        resolve(parseClaudeOutput(out));
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.end(prompt);
  });
}
