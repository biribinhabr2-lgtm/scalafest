'use strict';

const sessionMgr = require('../whatsapp/sessionManager');

// ─── Helper ───────────────────────────────────────────────────────────────────

function adminIdFrom(req) {
  return req.headers['x-admin-id'] || null;
}

// ─── Controllers ─────────────────────────────────────────────────────────────

/**
 * POST /api/whatsapp/conectar
 * Inicia (ou retoma) a sessão WhatsApp do admin.
 */
async function conectar(req, res) {
  try {
    const adminId = adminIdFrom(req);
    if (!adminId) return res.status(400).json({ error: 'Header x-admin-id obrigatório.' });

    // Fire-and-forget: retorna imediatamente ao frontend.
    // O socket Baileys inicializa em background; o polling detecta quando o QR fica pronto.
    sessionMgr.createSession(adminId).catch(err =>
      console.error(`[WA][${adminId}] Erro ao criar sessão:`, err.message)
    );

    res.json({ ok: true, mensagem: 'Iniciando conexão — aguarde o QR code.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/whatsapp/status
 * Retorna o estado da sessão do admin: conectado, aguardandoQr, numero.
 */
async function getStatus(req, res) {
  try {
    const adminId = adminIdFrom(req);
    if (!adminId) return res.status(400).json({ error: 'Header x-admin-id obrigatório.' });

    const sess = sessionMgr.getSession(adminId);

    res.json({
      conectado:    sess?.connected   ?? false,
      aguardandoQr: !sess?.connected  && Boolean(sess?.qrDataUrl),
      conectando:   sess?.connecting  ?? false,
      numero:       sess?.phone       ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/whatsapp/qr
 * Retorna o QR code atual como data URL (PNG base64).
 * 404 quando não há QR pendente.
 */
async function getQR(req, res) {
  try {
    const adminId = adminIdFrom(req);
    if (!adminId) return res.status(400).json({ error: 'Header x-admin-id obrigatório.' });

    const sess = sessionMgr.getSession(adminId);
    const qr   = sess?.qrDataUrl;

    if (!qr) {
      return res.status(404).json({
        error: sess?.connected
          ? 'Já conectado — não há QR disponível.'
          : 'QR ainda não gerado — inicie a conexão primeiro ou aguarde alguns segundos.',
      });
    }

    res.json({ qr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/whatsapp/grupos
 * Lista os grupos do WhatsApp do admin.
 */
async function getGrupos(req, res) {
  try {
    const adminId = adminIdFrom(req);
    if (!adminId) return res.status(400).json({ error: 'Header x-admin-id obrigatório.' });

    const sess = sessionMgr.getSession(adminId);
    if (!sess?.connected || !sess.sock) {
      return res.status(503).json({ error: 'WhatsApp não conectado.' });
    }

    const grupos = await sess.sock.groupFetchAllParticipating();
    const lista  = Object.entries(grupos)
      .map(([jid, g]) => ({ jid, nome: g.subject || jid }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    res.json(lista);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/whatsapp/desconectar
 * Encerra a sessão WhatsApp do admin (logout + limpeza de auth).
 */
async function desconectar(req, res) {
  try {
    const adminId = adminIdFrom(req);
    if (!adminId) return res.status(400).json({ error: 'Header x-admin-id obrigatório.' });

    await sessionMgr.destroySession(adminId);
    res.json({ ok: true, mensagem: 'Sessão encerrada.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { conectar, getStatus, getQR, getGrupos, desconectar };
