import fs from 'node:fs';
import path from 'node:path';

const AGENT_DEFAULTS = {
  model: 'sonnet',
  maxTurns: 8,
  tools: ['Read'],
  allowedTools: ['Read'],
  sessionResetMessages: 100,
};

export function loadGroups(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`${file} não encontrado: copie config/groups.example.json para config/groups.json e preencha os IDs`);
  }
  const groups = JSON.parse(fs.readFileSync(file, 'utf8')).grupos ?? {};
  for (const [jid, cfg] of Object.entries(groups)) {
    if (!jid.endsWith('@g.us')) throw new Error(`ID de grupo inválido: ${jid}`);
    if (!cfg?.agente) throw new Error(`Grupo ${jid} sem "agente"`);
  }
  return groups;
}

export function loadAgent(agentsDir, name) {
  const dir = path.join(agentsDir, name);
  if (!fs.existsSync(path.join(dir, 'CLAUDE.md'))) throw new Error(`Agente "${name}" sem CLAUDE.md em ${dir}`);
  const file = path.join(dir, 'agent.json');
  const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  return { name, dir, ...AGENT_DEFAULTS, ...cfg };
}

export function resolveRoute(groupJid, groups, agentsDir) {
  const entry = groups[groupJid];
  if (!entry) return null;
  return { groupJid, agent: loadAgent(agentsDir, entry.agente) };
}
