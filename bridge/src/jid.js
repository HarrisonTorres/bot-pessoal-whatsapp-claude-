export function normalizeJid(jid) {
  if (!jid) return '';
  const [user, server] = String(jid).split('@');
  return `${user.split(':')[0]}@${server ?? 's.whatsapp.net'}`;
}
