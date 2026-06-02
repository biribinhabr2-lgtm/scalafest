'use strict';

const dadosRepo  = require('../repositories/dados.repo');
const enviosRepo = require('../repositories/envios.repo');
const waSvc      = require('./whatsapp.service');
const { buildEscalaDiariaGrupo } = require('../templates/escala.template');

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

  // ── 4. Montar funcionários sem telefone (para aviso) ─────────────────────────
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

  // ── 7. Registrar auditoria ───────────────────────────────────────────────────
  await enviosRepo.salvarEnvios([{
    admin_id:        adminId,
    evento_id:       0,
    evento_nome:     `Escala do dia ${data} (${eventosDoDia.length} eventos)`,
    freelancer_id:   null,
    freelancer_nome: null,
    telefone:        grupoJid,
    mensagem:        texto,
    status:          resultado.ok ? 'enviado' : 'erro',
    erro:            resultado.erro ?? null,
  }]);

  // ── 8. Contar funcionários únicos ────────────────────────────────────────────
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

module.exports = { enviarEscalaDia };
