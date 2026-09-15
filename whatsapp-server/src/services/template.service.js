'use strict';

const repo = require('../repositories/templates.repo');

// ── Textos padrão (seed) ──────────────────────────────────────────────────────
// Estes são os fallbacks quando o tenant não customizou a mensagem.
// Manter em sync com _vars() em templates.repo.js.

const DEFAULTS = {
  confirmacao_presenca: {
    nome: 'Confirmação de Presença',
    corpo: [
      'Olá, *{{nome}}*! 👋',
      '',
      'Você foi escalado(a) para:',
      '',
      '🎪 *{{evento}}*',
      '📅 {{data}}',
      '⏰ {{hora_inicio}} — {{hora_fim}}',
      '📍 {{local}}',
      '🎭 Função: *{{funcao}}*',
      '💰 Cachê: *R$ {{cache}}*',
      '',
      'Confirme sua presença! 🙏',
    ].join('\n'),
    variaveis_disponiveis: ['{{nome}}','{{evento}}','{{data}}','{{hora_inicio}}','{{hora_fim}}','{{local}}','{{funcao}}','{{cache}}'],
    ativo: true,
  },

  aviso_pagamento: {
    nome: 'Aviso de Pagamento',
    corpo: [
      'Olá, *{{nome}}*! 👋',
      '',
      'Pagamento pendente:',
      '',
      '🎪 *{{evento}}*',
      '📅 {{data}}',
      '💰 R$ {{cache}}',
      '{{pix_linha}}',
      '',
      'Obrigado! ✅',
    ].join('\n'),
    variaveis_disponiveis: ['{{nome}}','{{evento}}','{{data}}','{{cache}}','{{pix_linha}}','{{pix}}'],
    ativo: true,
  },

  caches_pendentes_lote: {
    nome: 'Cachês Pendentes (lote)',
    corpo: [
      'Olá, *{{nome}}*! 👋',
      '',
      'Cachês pendentes:',
      '',
      '{{lista_eventos}}',
      '',
      '💰 *Total: R$ {{total}}*',
      '{{pix_linha}}',
      '',
      'Obrigado! 🙏',
    ].join('\n'),
    variaveis_disponiveis: ['{{nome}}','{{lista_eventos}}','{{total}}','{{pix_linha}}','{{pix}}'],
    ativo: true,
  },

  escala_diaria_grupo: {
    nome: 'Escala do Dia (grupo)',
    corpo: [
      '🗓️ {{data_extenso}}',
      '',
      '{{blocos_eventos}}',
    ].join('\n'),
    variaveis_disponiveis: ['{{data_extenso}}','{{blocos_eventos}}'],
    ativo: true,
  },

  lembrete_vespera: {
    nome: 'Lembrete Véspera',
    corpo: [
      'Olá, *{{nome}}*! 👋',
      '',
      'Lembrete: amanhã você está escalado(a) para:',
      '',
      '🎪 *{{evento}}*',
      '📅 {{data}}',
      '⏰ {{hora_inicio}} — {{hora_fim}}',
      '📍 {{local}}',
      '🎭 Função: *{{funcao}}*',
      '',
      'Qualquer dúvida, estamos por aqui! 😊',
    ].join('\n'),
    variaveis_disponiveis: ['{{nome}}','{{evento}}','{{data}}','{{hora_inicio}}','{{hora_fim}}','{{local}}','{{funcao}}'],
    ativo: true,
  },

  feedback_pos_evento: {
    nome: 'Pedido de Feedback',
    corpo: [
      'Olá, *{{nome}}*! 👋',
      '',
      'Obrigado por trabalhar conosco em *{{evento}}*! 🎉',
      '',
      'Sua opinião é muito importante. Acesse o link abaixo para avaliar o evento:',
      '',
      '{{link_feedback}}',
      '',
      'Leva menos de 2 minutos! ⭐',
    ].join('\n'),
    variaveis_disponiveis: ['{{nome}}','{{evento}}','{{link_feedback}}'],
    ativo: true,
  },
};

// ── Cache em memória (5 min por tenant) ──────────────────────────────────────

const _cache = new Map(); // tenantId → { merged: Object, ts: number }
const CACHE_TTL_MS = 5 * 60 * 1000;

async function _getAll(tenantId) {
  const hit = _cache.get(tenantId);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.merged;

  let rows = [];
  try {
    rows = await repo.listar(tenantId);
  } catch (err) {
    // Tabela pode não existir ainda — fallback silencioso para defaults
    console.warn('[template.service] Falha ao carregar templates do banco (usando defaults):', err.message);
  }

  // Começa com defaults; sobrescreve com valores do banco
  const merged = Object.fromEntries(
    Object.entries(DEFAULTS).map(([k, v]) => [k, { chave: k, ...v }])
  );
  for (const row of rows) {
    if (merged[row.chave]) {
      merged[row.chave] = { ...merged[row.chave], ...row };
    }
  }

  _cache.set(tenantId, { merged, ts: Date.now() });
  return merged;
}

/** Retorna um template resolvido (DB > default). Retorna null se chave desconhecida. */
async function loadTemplate(tenantId, chave) {
  const all = await _getAll(tenantId);
  return all[chave] || null;
}

/** Retorna todos os 6 templates como array, para a listagem na UI. */
async function listarTodos(tenantId) {
  const all = await _getAll(tenantId);
  return Object.values(all);
}

/**
 * Substitui {{variavel}} pelos valores em `vars`.
 * Variável ausente → string vazia + aviso no log.
 * Preserva quebras de linha.
 */
function renderTemplate(corpo, vars) {
  return corpo.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in vars)) {
      console.warn(`[template] Variável '${match}' não encontrada — deixando vazio`);
      return '';
    }
    const v = vars[key];
    return v == null ? '' : String(v);
  });
}

/** Invalida o cache de um tenant (chamar após salvar/deletar template). */
function clearCache(tenantId) {
  _cache.delete(tenantId);
}

/** Expõe os defaults para o controller usar em "restaurar padrão". */
function getDefault(chave) {
  return DEFAULTS[chave] || null;
}

module.exports = { loadTemplate, listarTodos, renderTemplate, clearCache, getDefault, DEFAULTS };
