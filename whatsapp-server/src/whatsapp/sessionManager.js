'use strict';

/**
 * sessionManager.js
 *
 * Gerencia múltiplas sessões Baileys, uma por adminId.
 * Credenciais são persistidas no Supabase (tabela wa_sessions)
 * para sobreviver a reinicializações do servidor no Railway.
 */

const {
  default: makeWASocket,
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino   = require('pino');

const {
  useSupabaseAuthState,
  clearAuthState,
  listSavedAdminIds,
} = require('./supabaseAuthState');

const logger = pino({ level: 'silent' });

/**
 * Map<adminId, SessionState>
 *
 * SessionState: {
 *   sock:        WASocket | null
 *   qrDataUrl:   string | null
 *   connected:   boolean
 *   connecting:  boolean
 *   phone:       string | null   — número conectado
 *   retryCount:  number          — contador de tentativas de reconexão
 * }
 */
const sessions = new Map();

// ─── API ──────────────────────────────────────────────────────────────────────

/** Retorna o estado atual da sessão ou null se não existir. */
function getSession(adminId) {
  return sessions.get(adminId) ?? null;
}

/**
 * Cria (ou reconecta) a sessão Baileys de um admin.
 * Idempotente: se já estiver conectada, retorna a sessão existente.
 */
async function createSession(adminId) {
  const existing = sessions.get(adminId);

  // Só pula se já estiver CONECTADO. Se estiver apenas "connecting" pode estar
  // travado — encerra o socket antigo e recomeça.
  if (existing?.connected) return existing;
  if (existing?.sock) {
    try { existing.sock.end(undefined); } catch { /* ignora */ }
  }

  // Inicializa (ou reinicializa) o estado da sessão
  const retryCount = (existing?.retryCount ?? 0);
  const sess = {
    sock:       null,
    qrDataUrl:  null,
    connected:  false,
    connecting: true,
    phone:      null,
    retryCount,
  };
  sessions.set(adminId, sess);

  // Carrega credenciais do Supabase (ou inicializa novas)
  const { state, saveCreds } = await useSupabaseAuthState(adminId);

  // fetchLatestBaileysVersion() faz uma request à rede.
  // Limita a 8 s para não bloquear indefinidamente; usa versão de fallback.
  let version;
  try {
    const result = await Promise.race([
      fetchLatestBaileysVersion(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8_000)),
    ]);
    version = result.version;
  } catch {
    version = [2, 3000, 1015901307]; // versão de fallback conhecida
    console.warn(`[WA][${adminId}] fetchLatestBaileysVersion falhou — usando fallback.`);
  }

  const sock = makeWASocket({
    version,
    auth:   state,
    logger,
    // Identifica como Chrome no Ubuntu — reduz chance de bloqueio pelo WA
    browser:                        Browsers.ubuntu('Chrome'),
    syncFullHistory:                false,
    markOnlineOnConnect:            false,
    generateHighQualityLinkPreview: false,
    // Timeouts mais longos para redes instáveis (Railway)
    connectTimeoutMs:               60_000,
    defaultQueryTimeoutMs:          60_000,
    keepAliveIntervalMs:            15_000,
    retryRequestDelayMs:            2_000,
  });

  sess.sock = sock;

  // Timeout de segurança: se em 60 s nenhum QR nem conexão aparecer, destrói a sessão
  const initTimeout = setTimeout(() => {
    if (!sess.connected && !sess.qrDataUrl) {
      console.warn(`[WA][${adminId}] Timeout: QR não gerado em 60s. Destruindo sessão.`);
      try { sock.end(undefined); } catch { /* ignora */ }
      sessions.delete(adminId);
    }
  }, 60_000);

  // Persiste credenciais sempre que atualizarem
  sock.ev.on('creds.update', saveCreds);

  // Monitora eventos de conexão
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      clearTimeout(initTimeout);
      sess.qrDataUrl  = await QRCode.toDataURL(qr);
      sess.connecting = false;
      sess.retryCount = 0; // reset ao mostrar novo QR
      console.log(`[WA][${adminId}] QR gerado — aguardando escaneio.`);
    }

    if (connection === 'open') {
      clearTimeout(initTimeout);
      sess.qrDataUrl  = null;
      sess.connected  = true;
      sess.connecting = false;
      sess.retryCount = 0;
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
        // Usuário desconectou no celular — limpa auth do Supabase
        console.log(`[WA][${adminId}] Sessão revogada. Admin deve reconectar via QR.`);
        await clearAuthState(adminId);
        sessions.delete(adminId);
      } else {
        // Falha de rede — reconecta com backoff exponencial (máx 60 s)
        sess.retryCount += 1;
        const delay = Math.min(5_000 * Math.pow(1.5, sess.retryCount - 1), 60_000);
        console.log(`[WA][${adminId}] Reconectando em ${Math.round(delay / 1000)}s (tentativa ${sess.retryCount})...`);
        sess.connecting = true;
        setTimeout(() => createSession(adminId), delay);
      }
    }
  });

  return sess;
}

/**
 * Encerra e remove a sessão de um admin (logout + limpeza de auth no Supabase).
 */
async function destroySession(adminId) {
  const sess = sessions.get(adminId);
  if (!sess) return;

  try {
    if (sess.sock) await sess.sock.logout();
  } catch { /* ignora erros de logout */ }

  await clearAuthState(adminId);
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

// ─── Reconectar sessões existentes ao iniciar o servidor ──────────────────────

/**
 * Consulta o Supabase e reconecta todos os admins que já tinham sessão salva.
 * Chamado automaticamente por server.js na inicialização.
 */
async function restoreExistingSessions() {
  let adminIds;
  try {
    adminIds = await listSavedAdminIds();
  } catch (err) {
    console.error('[WA] Erro ao listar sessões salvas no Supabase:', err.message);
    return;
  }

  if (adminIds.length === 0) return;

  console.log(`[WA] Restaurando ${adminIds.length} sessão(ões) do Supabase...`);
  await Promise.allSettled(adminIds.map(adminId => createSession(adminId)));
}

module.exports = { getSession, createSession, destroySession, sendMessage, restoreExistingSessions };
