import fs from 'node:fs';
import path from 'node:path';

const AGENT_DEFAULTS = {
  model: 'sonnet',
  maxTurns: 8,
  tools: ['Read'],
  allowedTools: ['Read'],
  sessionResetMessages: 100,
};

function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, ''); // editores do Windows costumam gravar BOM
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${file} não é um JSON válido (${e.message})`);
  }
}

export function loadGroups(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`${file} não encontrado: copie config/groups.example.json para config/groups.json e preencha os IDs`);
  }
  const groups = readJson(file).grupos ?? {};
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
  const cfg = fs.existsSync(file) ? readJson(file) : {};
  return { name, dir, ...AGENT_DEFAULTS, ...cfg };
}

export function resolveRoute(groupJid, groups, agentsDir) {
  const entry = groups[groupJid];
  if (!entry) return null;
  return { groupJid, agent: loadAgent(agentsDir, entry.agente) };
}
