'use strict';

const escalaSvc  = require('../services/escala.service');

const enviosRepo = require('../repositories/envios.repo');
const sessionMgr = require('../whatsapp/sessionManager');

/**
 * POST /api/escala/enviar-dia
 *
 * Body: { adminId: string, data: "YYYY-MM-DD", grupoJid: string }
 *
 * Envia a escala completa do dia para um grupo do WhatsApp.
 */
async function enviarEscalaDia(req, res) {
  const { adminId, data, grupoJid, reenviarIndividuais = false } = req.body ?? {};

  if (!adminId || !data || !grupoJid) {
    return res.status(400).json({
      error: 'adminId, data (YYYY-MM-DD) e grupoJid são obrigatórios.',
    });
  }

  const sess = sessionMgr.getSession(adminId);
  if (!sess?.connected) {
    return res.status(503).json({
      error: 'WhatsApp não conectado. Configure o WhatsApp no painel e escaneie o QR.',
    });
  }

  try {
    const resultado = await escalaSvc.enviarEscalaDia(adminId, data, grupoJid, { reenviarIndividuais: !!reenviarIndividuais });
    res.json(resultado);
  } catch (err) {
    console.error('[escala.controller] Erro ao enviar escala do dia:', err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/escala/envios?adminId=xxx&limite=50
 */
async function listarEnvios(req, res) {
  const { adminId, limite } = req.query;
  if (!adminId) return res.status(400).json({ error: 'adminId é obrigatório.' });
  try {
    const envios = await enviosRepo.listarEnvios(adminId, Number(limite) || 50);
    res.json(envios);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/escala/diagnostico?adminId=xxx&data=YYYY-MM-DD&grupoJid=xxx@g.us
 *
 * Diagnóstico sem envio: mostra participantes do grupo (JID bruto + formato),
 * telefones dos freelancers escalados e o resultado da normalização de cada um.
 */
async function diagnosticarEscalaDia(req, res) {
  const { adminId, data, grupoJid } = req.query;
  if (!adminId || !data || !grupoJid) {
    return res.status(400).json({ error: 'adminId, data (YYYY-MM-DD) e grupoJid são obrigatórios.' });
  }

  const sess = sessionMgr.getSession(adminId);
  if (!sess?.connected) {
    return res.status(503).json({ error: 'WhatsApp não conectado.' });
  }

  try {
    const resultado = await escalaSvc.diagnosticarEscalaDia(adminId, data, grupoJid);
    res.json(resultado);
  } catch (err) {
    console.error('[escala.controller] diagnostico:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { enviarEscalaDia, listarEnvios, diagnosticarEscalaDia };
