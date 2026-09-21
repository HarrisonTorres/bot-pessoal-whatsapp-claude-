import fs from 'node:fs';
import makeWASocket, {
  useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';

export function createWa({ authDir, log, onMessage, onLoggedOut }) {
  const baileysLog = pino({ level: 'warn' });
  let sock = null;
  let stopping = false;
  let attempt = 0;
  let timer = null;

  function scheduleReconnect() {
    const delay = Math.min(1000 * 2 ** attempt, 60_000);
    attempt += 1;
    log.warn({ delay }, 'reconectando ao WhatsApp');
    timer = setTimeout(() => {
      connect().catch((e) => {
        log.error({ err: String(e) }, 'falha ao reconectar');
        scheduleReconnect();
      });
    }, delay);
  }

  async function connect() {
    fs.mkdirSync(authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch (e) {
      log.warn({ err: String(e) }, 'não consegui buscar a versão mais recente do protocolo; usando a embutida');
    }
    sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: state, logger: baileysLog, markOnlineOnConnect: false, syncFullHistory: false,
    });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        log.info('Escaneie o QR code: WhatsApp do número secundário > Aparelhos conectados > Conectar um aparelho');
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'open') {
        attempt = 0;
        log.info('WhatsApp conectado');
      }
      if (connection === 'close' && !stopping) {
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          log.error('Sessão desvinculada pelo WhatsApp');
          onLoggedOut();
          return;
        }
        log.warn({ code }, 'conexão com o WhatsApp caiu');
        scheduleReconnect();
      }
    });
    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const m of messages) onMessage(m).catch((e) => log.error({ err: String(e) }, 'falha na ingestão'));
    });
  }

  return {
    start: connect,
    stop() {
      stopping = true;
      clearTimeout(timer);
      sock?.end(undefined);
    },
    sendText: (jid, text) => sock.sendMessage(jid, { text }),
    sendImage: (jid, file, caption) => sock.sendMessage(jid, { image: { url: file }, caption: caption || undefined }),
    sendTyping: (jid) => sock.sendPresenceUpdate('composing', jid),
    downloadMedia: (msg) => downloadMediaMessage(msg, 'buffer', {}, {
      logger: baileysLog, reuploadRequest: sock.updateMediaMessage,
    }),
  };
}
