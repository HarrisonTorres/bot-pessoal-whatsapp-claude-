import fs from 'node:fs';
import path from 'node:path';

const IMAGES = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export function listOutbox(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && IMAGES.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(dir, e.name))
    .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs || a.localeCompare(b));
}

export function archive(file) {
  const sent = path.join(path.dirname(file), 'sent');
  fs.mkdirSync(sent, { recursive: true });
  const dest = path.join(sent, `${Date.now()}-${path.basename(file)}`);
  fs.renameSync(file, dest);
  return dest;
}
