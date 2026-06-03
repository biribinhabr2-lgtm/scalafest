'use strict';

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino  = require('pino');
const path  = require('path');

// ─── Estado interno ───────────────────────────────────────────────────────────
let sock         = null;       // instância do socket Baileys
let qrDataUrl    = null;       // último QR gerado como data:image/png;base64,...
let isConnected  = false;
let isConnecting = false;

const AUTH_DIR = path.resolve(__dirname, '../../auth_state');

// Logger silencioso para o Baileys (evita flood de logs no terminal)
const logger = pino({ level: 'silent' });

// ─── Inicialização ────────────────────────────────────────────────────────────
async function connect() {
  if (isConnecting || isConnected) return;
  isConnecting = true;

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    // Não baixar histórico de mensagens
    syncFullHistory: false,
    // Não marcar mensagens como lidas automaticamente
    markOnlineOnConnect: false,
    // Gerar mensagens de alta qualidade
    generateHighQualityLinkPreview: false,
  });

  // Persiste credenciais sempre que atualizarem
  sock.ev.on('creds.update', saveCreds);

  // Monitora estado da conexão
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      // Converte a string do QR para uma imagem base64 exibível no frontend
      qrDataUrl = await QRCode.toDataURL(qr);
      isConnecting = false;
      console.log('[WhatsApp] QR gerado — escaneie no painel.');
    }

    if (connection === 'open') {
      qrDataUrl   = null;
      isConnected = true;
      isConnecting = false;
      console.log('[WhatsApp] Conectado com sucesso!');
    }

    if (connection === 'close') {
      isConnected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;

      console.log(`[WhatsApp] Conexão encerrada — código: ${code}`);

      if (loggedOut) {
        // Usuário desconectou explicitamente no celular — limpar sessão
        console.log('[WhatsApp] Sessão encerrada. Reconecte via QR.');
        sock = null;
      } else {
        // Reconecta automaticamente após falha de rede
        console.log('[WhatsApp] Tentando reconectar em 5 segundos...');
        setTimeout(connect, 5_000);
      }
    }
  });
}

// ─── API pública do módulo ────────────────────────────────────────────────────

/** Retorna o socket ativo (ou null se desconectado). */
function getSocket() {
  return sock;
}

/** Retorna true se a sessão está conectada ao WhatsApp. */
function connected() {
  return isConnected;
}

/** Retorna o QR code atual como data URL (null se não houver QR pendente). */
function getQR() {
  return qrDataUrl;
}

/**
 * Envia uma mensagem de texto simples para um número ou grupo.
 *
 * @param {string} jid   - JID destino: "55DDD9XXXXXXXX@s.whatsapp.net" (individual)
 *                          ou "XXXXXXXXXXXXXXXX@g.us" (grupo)
 * @param {string} texto - Texto da mensagem (suporta negrito *assim*, etc.)
 * @param {string[]} mentions - Array de JIDs mencionados (ex: ["5511999990000@s.whatsapp.net"])
 */
async function sendTextMessage(jid, texto, mentions = []) {
  if (!isConnected || !sock) {
    throw new Error('WhatsApp não está conectado.');
  }

  await sock.sendMessage(jid, {
    text: texto,
    ...(mentions.length > 0 && { mentions }),
  });
}

module.exports = { connect, getSocket, connected, getQR, sendTextMessage };
