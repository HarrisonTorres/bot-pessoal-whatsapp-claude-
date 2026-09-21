export async function waitUntil(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timeout esperando a condição no teste');
}
