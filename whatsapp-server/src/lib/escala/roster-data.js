'use strict';

/**
 * roster-data.js — Coleta de dados para o motor de sugestão de escala.
 *
 * Carrega e normaliza dados de várias fontes do Supabase (usando service key)
 * e monta o contexto esperado por roster-engine.sugerirEscala().
 */

const supabase = require('../../config/supabase');

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Carrega contexto completo para sugestão de escala.
 *
 * @param {string} eventId   - UUID do evento alvo
 * @param {string} tenantId  - UUID do admin (tenant)
 * @returns {Promise<object>} contexto para roster-engine.sugerirEscala()
 */
async function loadContext(eventId, tenantId) {
  // Fase 1 — dados independentes em paralelo
  const [eventRow, freelancers, adminDispBlob] = await Promise.all([
    _loadEvent(eventId, tenantId),
    _loadFreelancers(tenantId),
    _loadAdminDisp(tenantId),
  ]);

  if (!eventRow) throw new Error(`Evento ${eventId} não encontrado no tenant.`);

  // Freelancers ativos (ativo !== false; se undefined, considera ativo)
  const flAtivos = freelancers.filter(f => f.ativo !== false);
  const flsComUserId = flAtivos.filter(f => f.userId);
  const userIds = flsComUserId.map(f => f.userId);

  // userId → freelancerId (string) para cruzar dados cloud
  const userIdToFlId = {};
  flsComUserId.forEach(f => { userIdToFlId[f.userId] = String(f.id); });

  // Fase 2 — dados dependentes do evento e dos freelancers em paralelo
  const [dispCloud, feedbackRows, histResult, conflitosResult, semanaResult, equipeAtual] = await Promise.all([
    _loadDispCloud(userIds),
    _loadFeedbacks(userIds, tenantId),
    _loadHistorico(tenantId),
    _loadConflitos(tenantId, eventRow.data, eventId, eventRow.horaInicio, eventRow.horaFim),
    _loadSemana(tenantId, eventRow.data, eventId),
    _loadEquipeAtual(eventId),
  ]);

  // ── Disponibilidade ────────────────────────────────────────────────────────
  const disponibilidade = {};

  // Freelancers COM userId: usa blob salvo na conta deles
  for (const { userId, dados } of dispCloud) {
    const flId = userIdToFlId[userId];
    if (flId) disponibilidade[flId] = dados || {};
  }

  // Freelancers SEM userId: usa blob do admin (keyed by freelancerId)
  const noUserFlIds = flAtivos.filter(f => !f.userId).map(f => String(f.id));
  for (const flId of noUserFlIds) {
    if (adminDispBlob && adminDispBlob[flId]) {
      disponibilidade[flId] = adminDispBlob[flId];
    }
  }

  // ── Feedbacks ──────────────────────────────────────────────────────────────
  const feedbacks = {};
  for (const { userId, dados } of feedbackRows) {
    const flId = userIdToFlId[userId];
    if (!flId || !Array.isArray(dados)) continue;
    const notas = dados
      .map(fb => fb?.respostas?.nota)
      .filter(n => typeof n === 'number' && n >= 0 && n <= 10);
    if (notas.length > 0) {
      feedbacks[flId] = { avgNote: notas.reduce((s, n) => s + n, 0) / notas.length };
    }
  }

  // ── Histórico ──────────────────────────────────────────────────────────────
  const historico = {};

  for (const { freelancer_id, service_id, count } of (histResult.serviceCounts || [])) {
    const flId = String(freelancer_id);
    if (!historico[flId]) historico[flId] = { serviceCounts: {}, funcaoCounts: {}, lastEventDate: null };
    historico[flId].serviceCounts[service_id] = Number(count);
  }
  for (const { freelancer_id, funcao, count } of (histResult.funcaoCounts || [])) {
    const flId = String(freelancer_id);
    if (!historico[flId]) historico[flId] = { serviceCounts: {}, funcaoCounts: {}, lastEventDate: null };
    historico[flId].funcaoCounts[funcao] = Number(count);
  }
  for (const { freelancer_id, last_event_date } of (histResult.lastEvent || [])) {
    const flId = String(freelancer_id);
    if (!historico[flId]) historico[flId] = { serviceCounts: {}, funcaoCounts: {}, lastEventDate: null };
    historico[flId].lastEventDate = last_event_date;
  }

  // ── Sets de conflito / semana / já escalados ───────────────────────────────
  const conflitos  = new Set((conflitosResult  || []).map(r => String(r.freelancer_id)));
  const semana     = new Set((semanaResult     || []).map(r => String(r.freelancer_id)));
  const jaEscalados = new Set((equipeAtual     || []).map(r => String(r.freelancer_id)));

  return {
    event: {
      id:         eventRow.id,
      data:       eventRow.data,
      horaInicio: eventRow.horaInicio,
      horaFim:    eventRow.horaFim,
    },
    requiredRoles:    eventRow.requiredRoles,
    freelancers:      flAtivos,
    disponibilidade,
    historico,
    feedbacks,
    conflitos,
    semana,
    jaEscalados,
    eventServiceIds:   eventRow.serviceIds,
    eventServiceNames: eventRow.serviceNames,
  };
}

// ─── Helpers privados ─────────────────────────────────────────────────────────

async function _loadEvent(eventId, tenantId) {
  const { data: ev, error: evErr } = await supabase
    .from('events')
    .select('id, nome, data, hora_inicio, hora_fim')
    .eq('id', eventId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (evErr) throw evErr;
  if (!ev) return null;

  // Serviços reconhecidos do evento (falha silenciosa se tabela não existe)
  let serviceIds = [];
  let serviceNames = [];
  let requiredRoles = [];

  try {
    const { data: esRows } = await supabase
      .from('event_services')
      .select('service_id, services(nome)')
      .eq('event_id', eventId)
      .not('service_id', 'is', null);

    serviceIds  = (esRows || []).map(es => es.service_id).filter(Boolean);
    serviceNames = (esRows || []).map(es => es.services?.nome).filter(Boolean);

    if (serviceIds.length > 0) {
      const { data: roleRows } = await supabase
        .from('service_roles')
        .select('service_id, funcao, quantidade, obrigatorio')
        .in('service_id', serviceIds);

      requiredRoles = _computeRequiredRoles(roleRows || []);
    }
  } catch (_) {
    // Triagem não migrada ainda — sem roles, engine ainda funciona
  }

  return {
    id:           ev.id,
    data:         ev.data,
    horaInicio:   ev.hora_inicio ? ev.hora_inicio.slice(0, 5) : null,
    horaFim:      ev.hora_fim    ? ev.hora_fim.slice(0, 5)    : null,
    serviceIds,
    serviceNames,
    requiredRoles,
  };
}

/**
 * Máximo de quantidade por função entre todos os serviços do evento.
 * Mesmo líder serve a todos os serviços → não duplicar.
 */
function _computeRequiredRoles(roles) {
  const byFuncao = {};
  for (const r of roles) {
    if (!r.funcao) continue;
    if (!byFuncao[r.funcao]) {
      byFuncao[r.funcao] = { funcao: r.funcao, quantidade: r.quantidade || 1, obrigatorio: r.obrigatorio ?? true };
    } else {
      byFuncao[r.funcao].quantidade = Math.max(byFuncao[r.funcao].quantidade, r.quantidade || 1);
      if (r.obrigatorio) byFuncao[r.funcao].obrigatorio = true;
    }
  }
  return Object.values(byFuncao);
}

async function _loadFreelancers(tenantId) {
  const { data, error } = await supabase
    .from('sf_dados')
    .select('dados')
    .eq('user_id', tenantId)
    .eq('tipo', 'freelancers')
    .maybeSingle();

  if (error) throw error;
  const raw = data?.dados;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [];
}

// Disponibilidade salva pelo admin para freelancers sem login
// Estrutura: { [freelancerId]: { 'YYYY-MM-DD': status } }
async function _loadAdminDisp(tenantId) {
  const { data, error } = await supabase
    .from('sf_dados')
    .select('dados')
    .eq('user_id', tenantId)
    .eq('tipo', 'disponibilidade')
    .maybeSingle();

  if (error) throw error;
  return data?.dados || null;
}

async function _loadDispCloud(userIds) {
  if (!userIds.length) return [];
  const { data, error } = await supabase
    .from('sf_dados')
    .select('user_id, dados')
    .eq('tipo', 'disponibilidade')
    .in('user_id', userIds);

  if (error) throw error;
  return (data || []).map(r => ({ userId: r.user_id, dados: r.dados }));
}

async function _loadFeedbacks(userIds, tenantId) {
  if (!userIds.length) return [];
  const { data, error } = await supabase
    .from('sf_dados')
    .select('user_id, dados')
    .eq('tipo', `feedbacks_${tenantId}`)
    .in('user_id', userIds);

  if (error) throw error;
  return (data || []).map(r => ({ userId: r.user_id, dados: r.dados }));
}

/**
 * Carrega histórico de event_team + event_services para todos os eventos do tenant.
 * Computa em JS para evitar dependência de RPC.
 */
async function _loadHistorico(tenantId) {
  // 1. IDs e datas de todos os eventos do tenant
  const { data: evRows, error: evErr } = await supabase
    .from('events')
    .select('id, data')
    .eq('tenant_id', tenantId);

  if (evErr) throw evErr;
  if (!evRows?.length) return { serviceCounts: [], funcaoCounts: [], lastEvent: [] };

  const eventIds = evRows.map(e => e.id);
  const eventDataMap = Object.fromEntries(evRows.map(e => [e.id, e.data]));

  // 2. Todos os membros de equipe nesses eventos
  const { data: teamRows, error: teamErr } = await supabase
    .from('event_team')
    .select('freelancer_id, funcao, event_id')
    .in('event_id', eventIds);

  if (teamErr) throw teamErr;

  // 3. Serviços reconhecidos nesses eventos (opcional — falha silenciosa)
  let esMap = {}; // eventId → [serviceId]
  try {
    const { data: esRows } = await supabase
      .from('event_services')
      .select('event_id, service_id')
      .in('event_id', eventIds)
      .not('service_id', 'is', null);

    for (const es of (esRows || [])) {
      if (!esMap[es.event_id]) esMap[es.event_id] = [];
      esMap[es.event_id].push(es.service_id);
    }
  } catch (_) {
    // triagem não existente — sem service counts
  }

  // 4. Computar contagens
  const serviceCountsMap = {}; // flId → { serviceId: count }
  const funcaoCountsMap  = {}; // flId → { funcao: count }
  const lastEventMap     = {}; // flId → 'YYYY-MM-DD'

  for (const row of (teamRows || [])) {
    const flId  = String(row.freelancer_id);
    const evData = eventDataMap[row.event_id];

    if (row.funcao) {
      if (!funcaoCountsMap[flId]) funcaoCountsMap[flId] = {};
      funcaoCountsMap[flId][row.funcao] = (funcaoCountsMap[flId][row.funcao] || 0) + 1;
    }

    if (evData && (!lastEventMap[flId] || evData > lastEventMap[flId])) {
      lastEventMap[flId] = evData;
    }

    for (const sid of (esMap[row.event_id] || [])) {
      if (!serviceCountsMap[flId]) serviceCountsMap[flId] = {};
      serviceCountsMap[flId][sid] = (serviceCountsMap[flId][sid] || 0) + 1;
    }
  }

  // 5. Transformar em arrays no formato esperado pelo engine
  const serviceCounts = [];
  for (const [flId, map] of Object.entries(serviceCountsMap)) {
    for (const [serviceId, count] of Object.entries(map)) {
      serviceCounts.push({ freelancer_id: flId, service_id: serviceId, count });
    }
  }

  const funcaoCounts = [];
  for (const [flId, map] of Object.entries(funcaoCountsMap)) {
    for (const [funcao, count] of Object.entries(map)) {
      funcaoCounts.push({ freelancer_id: flId, funcao, count });
    }
  }

  const lastEvent = Object.entries(lastEventMap)
    .map(([flId, date]) => ({ freelancer_id: flId, last_event_date: date }));

  return { serviceCounts, funcaoCounts, lastEvent };
}

async function _loadConflitos(tenantId, data, eventId, horaInicio, horaFim) {
  // Eventos no mesmo dia (exceto o alvo)
  const { data: eventsOnDay, error } = await supabase
    .from('events')
    .select('id, hora_inicio, hora_fim')
    .eq('tenant_id', tenantId)
    .eq('data', data)
    .neq('id', eventId);

  if (error) throw error;
  if (!eventsOnDay?.length) return [];

  // Filtrar por sobreposição de horário em JS
  const overlapping = eventsOnDay.filter(ev => {
    if (!horaInicio || !horaFim || !ev.hora_inicio || !ev.hora_fim) {
      return true; // sem horário → assume conflito por segurança
    }
    const s = ev.hora_inicio.slice(0, 5);
    const e = ev.hora_fim.slice(0, 5);
    return horaInicio < e && horaFim > s;
  });

  if (!overlapping.length) return [];

  const ids = overlapping.map(ev => ev.id);
  const { data: rows, error: e2 } = await supabase
    .from('event_team')
    .select('freelancer_id')
    .in('event_id', ids);

  if (e2) throw e2;
  return rows || [];
}

async function _loadSemana(tenantId, data, eventId) {
  // Semana da data do evento (Dom–Sáb)
  const d   = new Date(data + 'T12:00:00Z');
  const dow = d.getUTCDay(); // 0=Dom
  const startOfWeek = new Date(d);
  startOfWeek.setUTCDate(d.getUTCDate() - dow);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setUTCDate(startOfWeek.getUTCDate() + 6);

  const fmt = dt => dt.toISOString().slice(0, 10);

  const { data: eventsInWeek, error } = await supabase
    .from('events')
    .select('id')
    .eq('tenant_id', tenantId)
    .gte('data', fmt(startOfWeek))
    .lte('data', fmt(endOfWeek))
    .neq('id', eventId);

  if (error) throw error;
  if (!eventsInWeek?.length) return [];

  const ids = eventsInWeek.map(ev => ev.id);
  const { data: rows, error: e2 } = await supabase
    .from('event_team')
    .select('freelancer_id')
    .in('event_id', ids);

  if (e2) throw e2;
  return rows || [];
}

async function _loadEquipeAtual(eventId) {
  const { data, error } = await supabase
    .from('event_team')
    .select('freelancer_id')
    .eq('event_id', eventId);

  if (error) throw error;
  return data || [];
}

// ─── Persistência de decisão ──────────────────────────────────────────────────

/**
 * Grava as decisões tomadas (sugerido vs escolhido) em roster_decisions.
 * Chamado pelo controller quando o admin aplica a sugestão.
 *
 * @param {string} eventId
 * @param {Array<{ funcao, sugeridoFreelancerId, escolhidoFreelancerId }>} decisions
 */
async function saveDecisions(eventId, decisions) {
  if (!decisions?.length) return;
  const rows = decisions.map(d => ({
    event_id:                  eventId,
    funcao:                    d.funcao,
    sugerido_freelancer_id:    d.sugeridoFreelancerId  || null,
    escolhido_freelancer_id:   d.escolhidoFreelancerId || null,
  }));

  const { error } = await supabase.from('roster_decisions').insert(rows);
  if (error) throw error;
}

module.exports = { loadContext, saveDecisions };
