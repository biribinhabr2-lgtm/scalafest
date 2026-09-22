'use strict';

const { loadContext, saveDecisions } = require('../lib/escala/roster-data');
const { sugerirEscala, DEFAULT_WEIGHTS } = require('../lib/escala/roster-engine');

/**
 * POST /api/roster/sugerir
 *
 * Body: { adminId: string, eventId: string, weights?: object }
 *
 * Retorna as vagas do evento com candidatos ranqueados e sugestões.
 */
async function sugerir(req, res) {
  const { adminId, eventId, weights } = req.body ?? {};

  if (!adminId || !eventId) {
    return res.status(400).json({ error: 'adminId e eventId são obrigatórios.' });
  }

  try {
    const ctx    = await loadContext(eventId, adminId);
    const w      = weights ? { ...DEFAULT_WEIGHTS, ...weights } : DEFAULT_WEIGHTS;
    const result = sugerirEscala(ctx, w);

    const serviceIds    = ctx.eventServiceIds   || [];
    const requiredRoles = ctx.requiredRoles      || [];

    res.json({
      eventId,
      event:          ctx.event,
      vagas:          result.vagas,
      aviso_rotacao:  result.aviso_rotacao || null,
      weights:        w,
      _diag: {
        totalFreelancers:  ctx.freelancers.length,
        requiredRoles,
        serviceIds,
        serviceNames:      ctx.eventServiceNames || [],
        // Flags de causa raiz para o frontend mostrar mensagem correta
        semEventServices:  serviceIds.length === 0,
        semServiceRoles:   serviceIds.length > 0 && requiredRoles.length === 0,
        // Funil por função (útil quando vagas existem mas sugeridos=0)
        funil: result.vagas.map(v => ({
          funcao:     v.funcao,
          candidatos: v.candidatos.length,
          elegiveis:  v.candidatos.filter(c => !c.eliminado).length,
          eliminados: v.candidatos.filter(c =>  c.eliminado).length,
          sugeridos:  v.sugeridos.length,
        })),
      },
    });
  } catch (err) {
    console.error('[roster.controller] Erro em sugerir:', err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/roster/confirmar
 *
 * Registra quem foi sugerido vs quem foi efetivamente escolhido.
 * Body: {
 *   adminId:   string,
 *   eventId:   string,
 *   decisions: [{ funcao, sugeridoFreelancerId, escolhidoFreelancerId }]
 * }
 */
async function confirmar(req, res) {
  const { adminId, eventId, decisions } = req.body ?? {};

  if (!adminId || !eventId || !Array.isArray(decisions)) {
    return res.status(400).json({ error: 'adminId, eventId e decisions[] são obrigatórios.' });
  }

  try {
    await saveDecisions(eventId, decisions);
    res.json({ ok: true, saved: decisions.length });
  } catch (err) {
    console.error('[roster.controller] Erro em confirmar:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { sugerir, confirmar };
