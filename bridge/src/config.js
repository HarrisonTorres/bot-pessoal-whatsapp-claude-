import path from 'node:path';
import { normalizeJid } from './jid.js';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');

export function loadConfig({ env = process.env, root = ROOT } = {}) {
  const ownerJids = [env.OWNER_JID, env.OWNER_LID].filter(Boolean).map(normalizeJid); // só vale em grupos somenteDono
  const dataDir = path.resolve(root, env.BOT_DATA_DIR || './data');
  return {
    root,
    dataDir,
    authDir: env.WA_AUTH_DIR ? path.resolve(env.WA_AUTH_DIR) : path.join(dataDir, 'auth'),
    ownerJids,
    tz: env.TZ || 'America/Sao_Paulo',
    whisperModel: env.WHISPER_MODEL || 'small',
    claudeBin: env.CLAUDE_BIN || 'claude',
    claudeConfigDir: env.CLAUDE_CONFIG_DIR || null,
    pythonBin: env.TRANSCRIBER_PYTHON || path.join(root, 'transcriber', '.venv', 'Scripts', 'python.exe'),
    transcriberScript: path.join(root, 'transcriber', 'transcribe.py'),
    groupsFile: path.join(root, 'config', 'groups.json'),
    agentsDir: path.join(root, 'agents'),
  };
}
