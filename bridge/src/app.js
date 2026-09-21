import path from 'node:path';
import { openBridgeDb } from './inbox.js';
import { createProcessor } from './processor.js';
import { createWorker } from './worker.js';
import { createIngest } from './ingest.js';
import { runClaude as runClaudeReal } from './runner.js';
import { transcribeAudio } from './transcribe.js';

const humanPause = () => new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 2000));

export function buildApp({ config, groups, wa, log, runClaude, transcribe, pause = humanPause, now = Date.now }) {
  const inbox = openBridgeDb(path.join(config.dataDir, 'db', 'bridge.db'));
  const run = runClaude ?? ((o) => runClaudeReal({ ...o, bin: config.claudeBin, claudeConfigDir: config.claudeConfigDir }));
  const stt = transcribe ?? ((file) => transcribeAudio({
    file, pythonBin: config.pythonBin, script: config.transcriberScript, model: config.whisperModel,
  }));
  const processor = createProcessor({
    inbox, wa, groups, agentsDir: config.agentsDir, dataDir: config.dataDir, tz: config.tz,
    runClaude: run, transcribe: stt, now, pause, log,
  });
  const worker = createWorker({ inbox, processor, now, log });
  const ingest = createIngest({ inbox, wa, worker, groups, ownerJids: config.ownerJids, dataDir: config.dataDir, now, log });
  return { inbox, processor, worker, ingest };
}
