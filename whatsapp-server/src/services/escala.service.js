'use strict';

const dadosRepo  = require('../repositories/dados.repo');
const enviosRepo = require('../repositories/envios.repo');
const waSvc      = require('./whatsapp.service');
const { buildEscalaDiariaGrupo } = require('../templates/escala.template');
const supabase = require('../config/supabase');

/**
 * Envia a escala completa de um dia para um grupo do WhatsApp.
 *
 * @param {string} adminId  - UUID do admin no Supabase Auth
 * @param {string} data     - Data no formato "YYYY-MM-DD"
 * @param {string} grupoJid - JID do grupo: "XXXXXXXX@g.us"
 * @returns {Promise<{
 *   enviado: boolean,
 *   totalEventos: number,
 *   totalFuncionarios: number,
 *   semTelefone: string[],
 *   erro?: string
 * }>}
 */
async function enviarEscalaDia(adminId, data, grupoJid) {
  // ── 1. Carregar dados ───────────────────────────────────────────────────────
  const [eventos, freelancers] = await Promise.all([
    dadosRepo.loadEventos(adminId),
    dadosRepo.loadFreelancers(adminId),
  ]);

  // ── 2. Filtrar eventos do dia e ordenar por horário ─────────────────────────
  const eventosDoDia = eventos.filter(e => e.data === data);

  if (eventosDoDia.length === 0) {
    return {
      enviado: false,
      totalEventos: 0,
      totalFuncionarios: 0,
      semTelefone: [],
      erro: `Nenhum evento encontrado para ${data}.`,
    };
  }

  // ── 3. Índice de freelancers ─────────────────────────────────────────────────
  const flById = Object.fromEntries(freelancers.map(f => [String(f.id), f]));

  // ── 4. Coletar freelancers sem telefone ──────────────────────────────────────
  const semTelefone = [];
  for (const ev of eventosDoDia) {
    for (const m of (ev.equipe ?? [])) {
      const fl = flById[String(m.freelancerId)];
      if (fl && !fl.telefone?.replace(/\D/g, '')) {
        if (!semTelefone.includes(fl.nome)) semTelefone.push(fl.nome);
      }
    }
  }

  // ── 5. Construir mensagem ────────────────────────────────────────────────────
  const { texto, mentions } = buildEscalaDiariaGrupo(data, eventosDoDia, flById);

  // ── 6. Enviar para o grupo ───────────────────────────────────────────────────
  const resultado = await waSvc.enviarMensagem(adminId, grupoJid, texto, mentions);

  // ── 7. Marcar funcionários como notificados ──────────────────────────────────
  if (resultado.ok) {
    await _marcarFuncionariosNotificados(adminId, eventosDoDia, data);
  }

  // ── 8. Registrar auditoria — 1 registro por funcionário único ─────────────────
  const registrosAuditoria = [];

  // Registro geral do grupo
  registrosAuditoria.push({
    admin_id:        adminId,
    evento_id:       null,
    evento_nome:     `Escala do dia ${data} (${eventosDoDia.length} eventos)`,
    freelancer_id:   null,
    freelancer_nome: null,
    telefone:        grupoJid,
    mensagem:        texto,
    status:          resultado.ok ? 'enviado' : 'erro',
    erro:            resultado.erro ?? null,
  });

  // Registros individuais por freelancer escalado
  if (resultado.ok) {
    const vistos = new Set();
    for (const ev of eventosDoDia) {
      for (const m of (ev.equipe ?? [])) {
        const key = `${ev.id}:${m.freelancerId}`;
        if (vistos.has(key)) continue;
        vistos.add(key);

        const fl = flById[String(m.freelancerId)];
        registrosAuditoria.push({
          admin_id:        adminId,
          evento_id:       ev.id ?? null,
          evento_nome:     ev.nome,
          freelancer_id:   String(m.freelancerId),
          freelancer_nome: fl?.nome ?? `ID ${m.freelancerId}`,
          telefone:        fl?.telefone?.replace(/\D/g, '') || null,
          mensagem:        `@mencionado na escala de grupo (${grupoJid})`,
          status:          'enviado',
          erro:            null,
        });
      }
    }
  }

  await enviosRepo.salvarEnvios(registrosAuditoria);

  // ── 9. Contar funcionários únicos ────────────────────────────────────────────
  const idsUnicos = new Set(
    eventosDoDia.flatMap(e => (e.equipe ?? []).map(m => m.freelancerId))
  );

  return {
    enviado:           resultado.ok,
    totalEventos:      eventosDoDia.length,
    totalFuncionarios: idsUnicos.size,
    semTelefone,
    erro:              resultado.ok ? undefined : resultado.erro,
  };
}

/**
 * Atualiza `wa_notificado_em` nos registros de `event_team` para todos os
 * membros dos eventos do dia. Falha silenciosa se a coluna não existir ainda
 * (a migration pode não ter sido rodada).
 */
async function _marcarFuncionariosNotificados(adminId, eventosDoDia, data) {
  try {
    const eventIds = eventosDoDia
      .map(e => e.id)
      .filter(id => id && typeof id === 'string');

    if (!eventIds.length) return;

    const { error } = await supabase
      .from('event_team')
      .update({ wa_notificado_em: new Date().toISOString() })
      .in('event_id', eventIds)
      .eq('tenant_id', adminId);

    if (error) {
      // Coluna pode não existir ainda; log e continua
      console.warn('[escala.service] wa_notificado_em não atualizado:', error.message);
    }
  } catch (err) {
    console.warn('[escala.service] _marcarFuncionariosNotificados falhou silenciosamente:', err.message);
  }
}

module.exports = { enviarEscalaDia };
