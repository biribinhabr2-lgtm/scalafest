'use strict';

/**
 * dados.repo.js
 *
 * Carrega eventos e freelancers para o serviço de escala WA.
 *
 * Fonte de eventos — ordem de prioridade:
 *   1. Tabela `events` + `event_team` (nova, pós-migração)
 *   2. `sf_dados` blob JSON (legado — fallback automático enquanto a migração
 *      não foi aplicada, ou se a tabela ainda não tiver dados)
 *
 * Freelancers continuam em `sf_dados` (não foram migrados para tabela própria).
 */

const supabase = require('../config/supabase');

// ─── Leitura genérica do blob JSON em sf_dados ────────────────────────────────

async function loadDados(adminId, tipo) {
  const { data, error } = await supabase
    .from('sf_dados')
    .select('dados')
    .eq('user_id', adminId)
    .eq('tipo', tipo)
    .maybeSingle();

  if (error) throw new Error(`Supabase [${tipo}]: ${error.message}`);
  if (!data?.dados) return [];

  const parsed = typeof data.dados === 'string'
    ? JSON.parse(data.dados)
    : data.dados;

  return Array.isArray(parsed) ? parsed : [];
}

// ─── Leitura da tabela events (nova) ─────────────────────────────────────────

/**
 * Lê eventos da tabela `events` + `event_team` e normaliza para o formato
 * esperado pelo escala.service e pelo template:
 *   { id, nome, data, horaInicio, horaFim, local, status,
 *     equipe: [{ freelancerId, funcao, cache, obs, pago }] }
 */
async function loadEventosFromTable(adminId) {
  const { data, error } = await supabase
    .from('events')
    .select(`
      id,
      nome,
      data,
      hora_inicio,
      hora_fim,
      local,
      status,
      event_team (
        id,
        freelancer_id,
        funcao,
        cache_base,
        obs,
        pago
      )
    `)
    .eq('tenant_id', adminId)
    .order('data', { ascending: true });

  if (error) throw error;

  return (data || []).map(ev => ({
    id:         ev.id,
    nome:       ev.nome,
    data:       ev.data,       // "YYYY-MM-DD"
    horaInicio: ev.hora_inicio ?? '',
    horaFim:    ev.hora_fim    ?? '',
    local:      ev.local       ?? '',
    status:     ev.status,
    equipe: (ev.event_team || []).map(m => ({
      freelancerId: m.freelancer_id,  // TEXT — mesmo valor do id numérico legado
      funcao:       m.funcao  ?? '',
      cache:        m.cache_base,
      obs:          m.obs     ?? '',
      pago:         m.pago    ?? false,
    })),
  }));
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Retorna a lista de eventos do admin.
 *
 * Tenta a tabela `events` primeiro; se falhar (tabela inexistente ou vazia)
 * cai de volta para o blob JSON em `sf_dados`.
 */
async function loadEventos(adminId) {
  try {
    const eventos = await loadEventosFromTable(adminId);
    // Usa a tabela nova se retornar qualquer resultado (inclusive array vazio
    // após a migração estar completa — sem fallback desnecessário).
    // Detectamos "migração não feita" pela exceção, não pelo array vazio.
    return eventos;
  } catch (err) {
    // Tabela events não existe ainda — fallback silencioso para sf_dados
    console.warn('[dados.repo] Tabela events indisponível, usando sf_dados:', err.message);
    return loadDados(adminId, 'eventos');
  }
}

/** Retorna a lista de freelancers/colaboradores do admin (ainda em sf_dados). */
async function loadFreelancers(adminId) {
  return loadDados(adminId, 'freelancers');
}

module.exports = { loadDados, loadEventos, loadFreelancers };
