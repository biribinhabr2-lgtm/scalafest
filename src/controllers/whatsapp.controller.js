'use strict';

const waClient = require('../whatsapp/client');

/**
 * GET /api/whatsapp/status
 * Retorna se o WhatsApp está conectado e qual número está logado.
 */
async function getStatus(req, res) {
  try {
    const sock = waClient.getSocket();
    const conn = waClient.connected();

    let numero = null;
    if (conn && sock?.user) {
      // sock.user.id = "5511999990000:XX@s.whatsapp.net" — pega só os dígitos antes do ":"
      numero = sock.user.id.split(':')[0].split('@')[0];
    }

    const temQr = Boolean(waClient.getQR());

    res.json({
      conectado: conn,
      aguardandoQr: !conn && temQr,
      numero,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/whatsapp/qr
 * Retorna o QR code atual como data URL (PNG base64).
 * Retorna 404 se não houver QR pendente (já conectado ou ainda carregando).
 */
async function getQR(req, res) {
  try {
    const qr = waClient.getQR();
    if (!qr) {
      return res.status(404).json({
        error: waClient.connected()
          ? 'Já conectado — não há QR disponível.'
          : 'QR ainda não gerado — aguarde alguns segundos e tente novamente.',
      });
    }
    res.json({ qr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/whatsapp/grupos
 * Retorna a lista de grupos do WhatsApp em que o número está presente.
 */
async function getGrupos(req, res) {
  try {
    const sock = waClient.getSocket();
    if (!waClient.connected() || !sock) {
      return res.status(503).json({ error: 'WhatsApp não conectado.' });
    }
    const grupos = await sock.groupFetchAllParticipating();
    const lista = Object.entries(grupos)
      .map(([jid, g]) => ({ jid, nome: g.subject || jid }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    res.json(lista);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/whatsapp/desconectar
 * Encerra a sessão do WhatsApp (logout).
 */
async function desconectar(req, res) {
  try {
    const sock = waClient.getSocket();
    if (sock) {
      await sock.logout();
    }
    res.json({ ok: true, mensagem: 'Sessão encerrada.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getStatus, getQR, getGrupos, desconectar };
