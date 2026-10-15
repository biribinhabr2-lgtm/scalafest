'use strict';

const dadosRepo   = require('../repositories/dados.repo');
const enviosRepo  = require('../repositories/envios.repo');
const waSvc       = require('./whatsapp.service');
const templateSvc = require('./template.service');
const sessionMgr  = require('../whatsapp/sessionManager');
const supabase    = require('../config/supabase');
const {
  buildEscalaDiariaGrupo,
  buildEscalaIndividual,
  normalizarTelefone,
  telParaJid,
  limparTel,
} = require('../templates/escala.template');

/**
 * Envia a escala completa de um dia para um grupo do WhatsApp.
 *
 * Fluxo:
 *  1. Busca participantes do grupo → distingue quem está/não está.
 *  2. Monta a mensagem: participantes do grupo recebem @menção; os demais,
 *     só nome. Se a busca falhar, menciona todos (fallback seguro).
 *  3. Envia a mensagem ao grupo.
 *  4. Freelancers fora do grupo com telefone recebem mensagem individual.
 *  5. Freelancers sem telefone e os que falharam ficam no aviso de retorno.
 *
 * @param {string} adminId  - UUID do admin no Supabase Auth
 * @param {string} data     - Data no formato "YYYY-MM-DD"
 * @param {string} grupoJid - JID do grupo: "XXXXXXXX@g.us"
 * @returns {Promise<{
 *   enviado: boolean,
 *   totalEventos: number,
 *   totalFuncionarios: number,
 *   semTelefone: string[],
 *   foraDaGrupo: string[],
 *   individuaisEnviados: string[],
 *   individuaisFalharam: Array<{nome: string, erro: string}>,
 *   erroParticipantes: string|null,
 *   erro?: string
 * }>}
 */
async function enviarEscalaDia(adminId, data, grupoJid, { reenviarIndividuais = false } = {}) {
  // ── 1. Dados ────────────────────────────────────────────────────────────────
  const [eventos, freelancers] = await Promise.all([
    dadosRepo.loadEventos(adminId),
    dadosRepo.loadFreelancers(adminId),
  ]);

  const eventosDoDia = eventos.filter(e => e.data === data);
  if (eventosDoDia.length === 0) {
    return {
      enviado: false, totalEventos: 0, totalFuncionarios: 0,
      semTelefone: [], foraDaGrupo: [], individuaisEnviados: [], individuaisFalharam: [],
      erroParticipantes: null,
      erro: `Nenhum evento encontrado para ${data}.`,
    };
  }

  const flById = Object.fromEntries(freelancers.map(f => [String(f.id), f]));

  // ── 2. Participantes do grupo ───────────────────────────────────────────────
  const { mapa: participantesMap, erro: erroParticipantes } =
    await _getParticipantesGrupo(adminId, grupoJid);
  // participantesMap === null → falha → buildEscalaDiariaGrupo faz fallback (menciona todos)

  // ── 3. Templates ────────────────────────────────────────────────────────────
  const [tplGrupo, tplIndividual] = await Promise.allSettled([
    templateSvc.loadTemplate(adminId, 'escala_diaria_grupo'),
    templateSvc.loadTemplate(adminId, 'escala_individual'),
  ]).then(rs => rs.map(r => r.status === 'fulfilled' ? r.value : null));

  if (tplGrupo?.ativo === false) {
    return {
      enviado: false, totalEventos: eventosDoDia.length, totalFuncionarios: 0,
      semTelefone: [], foraDaGrupo: [], individuaisEnviados: [], individuaisFalharam: [],
      erroParticipantes,
      erro: 'Template de mensagem inativo.',
    };
  }

  // ── 4. Construir mensagem do grupo ──────────────────────────────────────────
  const { texto, mentions, foraDaGrupo, semTelefone } = buildEscalaDiariaGrupo(
    data, eventosDoDia, flById, tplGrupo?.corpo, participantesMap
  );

  // ── 5. Enviar para o grupo ──────────────────────────────────────────────────
  const resultadoGrupo = await waSvc.enviarMensagem(adminId, grupoJid, texto, mentions);

  // ── 6. Mensagens individuais (fora do grupo, com telefone) ──────────────────
  const resultadosIndividuais = [];
  if (resultadoGrupo.ok && foraDaGrupo.length > 0) {
    const eventIds = eventosDoDia.map(e => e.id).filter(Boolean);

    // Anti-duplicação: quem já recebeu individual para estes eventos?
    const jaNotificados = reenviarIndividuais
      ? new Set()
      : await enviosRepo.listarIndividuaisEnviados(adminId, eventIds);

    const individuais = foraDaGrupo
      .map(({ fl, eventosInfo }) => {
        const jid = telParaJid(fl.telefone);
        if (!jid) return null;
        return { jid, texto: buildEscalaIndividual(data, fl, eventosInfo, tplIndividual?.corpo), fl };
      })
      .filter(Boolean);

    for (const { jid, texto: t, fl } of individuais) {
      if (jaNotificados.has(String(fl.id))) {
        console.log(`[escala] Pulando individual para ${fl.nome} (${fl.id}) — já notificado. Passe reenviarIndividuais=true para forçar.`);
        resultadosIndividuais.push({ nome: fl.nome, jid, ok: true, erro: null, pulado: true });
        continue;
      }
      const r = await waSvc.enviarMensagem(adminId, jid, t, []);
      resultadosIndividuais.push({ nome: fl.nome, jid, ok: r.ok, erro: r.erro ?? null });
      if (r.ok) await new Promise(res => setTimeout(res, 1_500));
    }
  }

  // ── 7. Marcar funcionários como notificados ─────────────────────────────────
  if (resultadoGrupo.ok) {
    await _marcarFuncionariosNotificados(adminId, eventosDoDia, data);
  }

  // ── 8. Auditoria ────────────────────────────────────────────────────────────
  const registros = [];

  registros.push({
    admin_id: adminId, evento_id: null,
    evento_nome: `Escala do dia ${data} (${eventosDoDia.length} eventos)`,
    freelancer_id: null, freelancer_nome: null,
    telefone: grupoJid, mensagem: texto,
    status: resultadoGrupo.ok ? 'enviado' : 'erro',
    erro: resultadoGrupo.erro ?? null,
  });

  if (resultadoGrupo.ok) {
    const vistos = new Set();
    for (const ev of eventosDoDia) {
      for (const m of (ev.equipe ?? [])) {
        const key = `${ev.id}:${m.freelancerId}`;
        if (vistos.has(key)) continue;
        vistos.add(key);

        const fl       = flById[String(m.freelancerId)];
        const telRaw   = fl?.telefone?.replace(/\D/g, '') || null;
        const estaFora = foraDaGrupo.some(f => String(f.fl.id ?? m.freelancerId) === String(m.freelancerId));
        const indResult = estaFora
          ? resultadosIndividuais.find(r => r.jid === telParaJid(fl?.telefone))
          : null;

        let msgStatus;
        if (!telRaw)       msgStatus = 'sem telefone';
        else if (estaFora) msgStatus = indResult?.ok
          ? 'mensagem individual enviada'
          : `individual falhou: ${indResult?.erro ?? 'motivo desconhecido'}`;
        else               msgStatus = '@mencionado no grupo';

        registros.push({
          admin_id: adminId, evento_id: ev.id ?? null, evento_nome: ev.nome,
          freelancer_id: String(m.freelancerId),
          freelancer_nome: fl?.nome ?? `ID ${m.freelancerId}`,
          telefone: telRaw,
          mensagem: msgStatus,
          status:  estaFora && !indResult?.ok ? 'erro' : 'enviado',
          erro:    estaFora && !indResult?.ok ? (indResult?.erro ?? null) : null,
        });
      }
    }
  }

  await enviosRepo.salvarEnvios(registros);

  // ── 9. Retorno ──────────────────────────────────────────────────────────────
  const idsUnicos = new Set(
    eventosDoDia.flatMap(e => (e.equipe ?? []).map(m => m.freelancerId))
  );

  return {
    enviado:             resultadoGrupo.ok,
    totalEventos:        eventosDoDia.length,
    totalFuncionarios:   idsUnicos.size,
    semTelefone,
    foraDaGrupo:         foraDaGrupo.map(({ fl }) => fl.nome),
    individuaisEnviados: resultadosIndividuais.filter(r => r.ok && !r.pulado).map(r => r.nome),
    individuaisPulados:  resultadosIndividuais.filter(r => r.pulado).map(r => r.nome),
    individuaisFalharam: resultadosIndividuais.filter(r => !r.ok).map(r => ({ nome: r.nome, erro: r.erro })),
    erroParticipantes:   erroParticipantes ?? null,
    erro:                resultadoGrupo.ok ? undefined : resultadoGrupo.erro,
  };
}

/**
 * Busca os participantes do grupo via Baileys e constrói um Map
 * canonical → JID real (@s.whatsapp.net).
 *
 * @lid (formato novo do WA): quando todos ou a maioria dos participantes
 * retornam como @lid (sem número de telefone legível), o mapa ficaria vazio
 * e o caller classificaria todos os freelancers como "fora do grupo" — causando
 * menções ausentes e individuais para todos. Para evitar isso, retornamos
 * { mapa: null } quando nenhum participante pôde ser resolvido, forçando o
 * fallback que menciona todos com telefone no grupo.
 *
 * Retorna { mapa: null } em qualquer falha ou quando resolução é zero;
 * o caller usa o fallback (mencionar todos com telefone no grupo, sem individuais).
 */
async function _getParticipantesGrupo(adminId, grupoJid) {
  try {
    const result = await sessionMgr.getGroupParticipants(adminId, grupoJid);
    if (!result.ok) {
      console.warn(`[escala.service] Participantes indisponíveis (${result.erro}) — fallback sem discriminação`);
      return { mapa: null, erro: result.erro };
    }

    const total = result.participants.length;
    const mapa  = new Map();
    let semResolucao = 0;

    for (const { id } of result.participants) {
      if (id.endsWith('@s.whatsapp.net')) {
        const canonical = normalizarTelefone(id.split('@')[0]);
        if (canonical) mapa.set(canonical, id);
        else console.warn(`[escala.service] JID não normalizável ignorado: ${id}`);
      } else if (id.endsWith('@lid')) {
        // Formato @lid não expõe número de telefone — não pode ser mapeado
        semResolucao++;
        console.log(`[escala.service] Participante @lid (sem resolução): ${id}`);
      } else {
        console.warn(`[escala.service] Formato de JID desconhecido: ${id}`);
      }
    }

    console.log(
      `[escala.service] Grupo ${grupoJid}: total=${total}, ` +
      `resolvidos=${mapa.size} (@s.whatsapp.net), @lid=${semResolucao}`
    );

    // Trava de segurança: se NENHUM participante foi resolvido para telefone
    // (todos @lid ou grupo vazio), usar fallback em vez de tratar todos como
    // "fora do grupo" — o que geraria individuais para todo mundo.
    if (mapa.size === 0) {
      const motivo = semResolucao > 0
        ? `${semResolucao}/${total} participantes usam @lid — impossível comparar com telefones`
        : total === 0
          ? 'grupo sem participantes visíveis'
          : 'nenhum JID pôde ser normalizado';
      console.warn(`[escala.service] Mapa vazio (${motivo}) — usando fallback (mencionar todos no grupo)`);
      return { mapa: null, erro: motivo };
    }

    if (semResolucao > 0) {
      console.warn(
        `[escala.service] ${semResolucao}/${total} participante(s) @lid não resolvidos — ` +
        `${mapa.size} resolvidos serão comparados; freelancers cujo telefone não casar serão tratados como fora do grupo.`
      );
    }

    return { mapa, erro: null };
  } catch (err) {
    console.warn(`[escala.service] _getParticipantesGrupo falhou: ${err.message}`);
    return { mapa: null, erro: err.message };
  }
}

/**
 * Atualiza wa_notificado_em em event_team para todos os membros do dia.
 * Falha silenciosa se a coluna não existir ainda.
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
    if (error) console.warn('[escala.service] wa_notificado_em não atualizado:', error.message);
  } catch (err) {
    console.warn('[escala.service] _marcarFuncionariosNotificados falhou:', err.message);
  }
}

/**
 * Diagnóstico: mostra lado a lado os participantes do grupo (JID bruto),
 * os telefones dos freelancers escalados no dia e o resultado da normalização.
 * Não envia nenhuma mensagem.
 *
 * Retorna JSON para debug — útil para inspecionar via GET /api/escala/diagnostico.
 */
async function diagnosticarEscalaDia(adminId, data, grupoJid) {
  const [eventos, freelancers] = await Promise.all([
    dadosRepo.loadEventos(adminId),
    dadosRepo.loadFreelancers(adminId),
  ]);

  const eventosDoDia = eventos.filter(e => e.data === data);
  const flById = Object.fromEntries(freelancers.map(f => [String(f.id), f]));

  // Freelancers únicos escalados no dia
  const flIdsNoDia = new Set(
    eventosDoDia.flatMap(e => (e.equipe ?? []).map(m => String(m.freelancerId)))
  );
  const flNoDia = [...flIdsNoDia].map(id => flById[id]).filter(Boolean);

  // Participantes do grupo (raw)
  const groupResult = await sessionMgr.getGroupParticipants(adminId, grupoJid);

  const participantesRaw = groupResult.ok
    ? groupResult.participants.map(({ id }) => ({
        jid:       id,
        formato:   id.endsWith('@s.whatsapp.net') ? '@s.whatsapp.net' : id.endsWith('@lid') ? '@lid' : 'outro',
        canonical: id.endsWith('@s.whatsapp.net') ? normalizarTelefone(id.split('@')[0]) : null,
      }))
    : [];

  const participantesCanonicals = new Map(
    participantesRaw
      .filter(p => p.canonical)
      .map(p => [p.canonical, p.jid])
  );

  // Comparação por freelancer
  const comparacao = flNoDia.map(fl => {
    const telRaw   = fl.telefone || '';
    const telLimpo = limparTel(telRaw);
    const canonical = normalizarTelefone(telRaw);
    const jidNoGrupo = canonical ? participantesCanonicals.get(canonical) : null;
    return {
      nome:        fl.nome,
      id:          fl.id,
      tel_raw:     telRaw,
      tel_limpo:   telLimpo,
      canonical,
      no_grupo:    !!jidNoGrupo,
      jid_grupo:   jidNoGrupo ?? null,
    };
  });

  const lidCount = participantesRaw.filter(p => p.formato === '@lid').length;
  const netCount = participantesRaw.filter(p => p.formato === '@s.whatsapp.net').length;

  return {
    data,
    grupoJid,
    grupo: {
      ok:          groupResult.ok,
      erro:        groupResult.erro ?? null,
      total:       participantesRaw.length,
      s_whatsapp:  netCount,
      lid:         lidCount,
      participantes: participantesRaw,
    },
    freelancers_no_dia: comparacao,
    resumo: {
      total_fl:   comparacao.length,
      no_grupo:   comparacao.filter(f => f.no_grupo).length,
      fora_grupo: comparacao.filter(f => !f.no_grupo && f.canonical).length,
      sem_tel:    comparacao.filter(f => !f.canonical).length,
      aviso:      lidCount > 0 && netCount === 0
        ? `TODOS os ${lidCount} participantes usam @lid — comparação impossível, fallback será usado`
        : lidCount > 0
          ? `${lidCount} participante(s) @lid não resolvidos — podem gerar falsos "fora do grupo"`
          : null,
    },
  };
}

module.exports = { enviarEscalaDia, diagnosticarEscalaDia };
