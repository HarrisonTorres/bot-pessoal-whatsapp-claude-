export function createFakeWa() {
  const sent = [];
  return {
    sent,
    async sendText(jid, text) { sent.push({ type: 'text', jid, text }); },
    async sendImage(jid, file, caption) { sent.push({ type: 'image', jid, file, caption }); },
    async sendTyping(jid) { sent.push({ type: 'typing', jid }); },
    async downloadMedia() { return Buffer.from('fake-media'); },
  };
}
