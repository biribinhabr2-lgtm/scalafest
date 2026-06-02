'use strict';

/**
 * sessionManager.js
 *
 * Gerencia múltiplas sessões Baileys, uma por adminId.
 * Cada sessão tem seu próprio socket, QR, estado de conexão e pasta de auth.
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino   = require('pino');
const path   = require('path');
const fs     = require('fs');

const logger = pino({ level: 'silent' });

/**
 * Map<adminId, SessionState>
 *
 * SessionState: {
 *   sock:        WASocket | null
 *   qrDataUrl:   string | null
 *   connected:   boolean
 *   connecting:  boolean
 *   phone:       string | null   — número conectado (sem país nem @)
 * }
 */
const sessions = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function authDir(adminId) {
  return path.resolve(__dirname, '../../auth_state', adminId);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// ─── API ──────────────────────────────────────────────────────────────────────

/** Retorna o estado atual da sessão ou null se não existir. */
function getSession(adminId) {
  return sessions.get(adminId) ?? null;
}

/**
 * Cria (ou reconecta) a sessão Baileys de um admin.
 * Idempotente: se já estiver conectada ou conectando, retorna a sessão existente.
 */
async function createSession(adminId) {
  const existing = sessions.get(adminId);
  if (existing?.connected || existing?.connecting) return existing;

  // Inicializa (ou reinicializa) o estado da sessão
  const sess = {
    sock:       null,
    qrDataUrl:  null,
    connected:  false,
    connecting: true,
    phone:      null,
  };
  sessions.set(adminId, sess);

  const dir = authDir(adminId);
  ensureDir(dir);

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const { version }          = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth:  state,
    logger,
    syncFullHistory:             false,
    markOnlineOnConnect:         false,
    generateHighQualityLinkPreview: false,
  });

  sess.sock = sock;

  // Persiste credenciais sempre que atualizarem
  sock.ev.on('creds.update', saveCreds);

  // Monitora eventos de conexão
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      sess.qrDataUrl  = await QRCode.toDataURL(qr);
      sess.connecting = false;
      console.log(`[WA][${adminId}] QR gerado — aguardando escaneio.`);
    }

    if (connection === 'open') {
      sess.qrDataUrl  = null;
      sess.connected  = true;
      sess.connecting = false;
      sess.phone      = sock.user?.id?.split(':')[0]?.split('@')[0] ?? null;
      console.log(`[WA][${adminId}] Conectado — número: ${sess.phone}`);
    }

    if (connection === 'close') {
      sess.connected = false;
      sess.phone     = null;
      const code      = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;

      console.log(`[WA][${adminId}] Conexão encerrada — código: ${code}`);

      if (loggedOut) {
        // Usuário desconectou no celular — limpa auth e remove da memória
        console.log(`[WA][${adminId}] Sessão revogada. Admin deve reconectar via QR.`);
        _clearAuth(adminId);
        sessions.delete(adminId);
      } else {
        // Falha de rede — reconecta automaticamente
        console.log(`[WA][${adminId}] Reconectando em 5 segundos...`);
        sess.connecting = true;
        setTimeout(() => createSession(adminId), 5_000);
      }
    }
  });

  return sess;
}

/**
 * Encerra e remove a sessão de um admin (logout + limpeza de auth).
 */
async function destroySession(adminId) {
  const sess = sessions.get(adminId);
  if (!sess) return;

  try {
    if (sess.sock) await sess.sock.logout();
  } catch { /* ignora erros de logout */ }

  _clearAuth(adminId);
  sessions.delete(adminId);
  console.log(`[WA][${adminId}] Sessão destruída.`);
}

/**
 * Envia uma mensagem de texto para um JID usando a sessão do admin.
 *
 * @param {string}   adminId  - UUID do admin
 * @param {string}   jid      - JID destino (@s.whatsapp.net ou @g.us)
 * @param {string}   texto    - Texto da mensagem
 * @param {string[]} mentions - JIDs mencionados
 */
async function sendMessage(adminId, jid, texto, mentions = []) {
  const sess = sessions.get(adminId);
  if (!sess?.connected || !sess.sock) {
    throw new Error(`WhatsApp não conectado para o admin ${adminId}.`);
  }
  await sess.sock.sendMessage(jid, {
    text: texto,
    ...(mentions.length > 0 && { mentions }),
  });
}

// ─── Privado ──────────────────────────────────────────────────────────────────

function _clearAuth(adminId) {
  try {
    fs.rmSync(authDir(adminId), { recursive: true, force: true });
  } catch { /* ignora se já não existir */ }
}

// ─── Reconectar sessões existentes ao iniciar o servidor ──────────────────────

/**
 * Lê a pasta auth_state/ e reconecta todos os admins que já tinham sessão salva.
 * Chamado automaticamente por server.js na inicialização.
 */
async function restoreExistingSessions() {
  const base = path.resolve(__dirname, '../../auth_state');
  ensureDir(base);

  let entries;
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return;
  }

  const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
  if (dirs.length === 0) return;

  console.log(`[WA] Restaurando ${dirs.length} sessão(ões) existente(s)...`);
  await Promise.allSettled(dirs.map(adminId => createSession(adminId)));
}

module.exports = { getSession, createSession, destroySession, sendMessage, restoreExistingSessions };
