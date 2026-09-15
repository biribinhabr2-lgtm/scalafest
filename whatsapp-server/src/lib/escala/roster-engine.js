'use strict';

/**
 * roster-engine.js — Motor puro de sugestão de escala.
 *
 * Sem dependências externas nem chamadas a banco.
 * Entrada: contexto montado por roster-data.js
 * Saída:   vagas com candidatos ranqueados e sugestões sem repetição de freelancer
 */

// ─── Pesos padrão ─────────────────────────────────────────────────────────────
// Cada peso define a contribuição máxima daquele fator no score final.
// Editável na chamada de sugerirEscala() ou por configuração de tenant no futuro.
const DEFAULT_WEIGHTS = {
  servicoMesmo:   5,    // experiência neste(s) serviço(s) específico(s) do evento
  funcaoQualquer: 3,    // experiência nessa função em qualquer serviço
  feedback:       2,    // nota média de feedback (0–10 → 0–1)
  rotacao:        1.5,  // dias sem trabalhar (cap 30 dias → fator 0–1)
  semana:         0.5,  // penalidade: já escalado em outro evento na mesma semana
};

// ─── Disponibilidade ──────────────────────────────────────────────────────────

/**
 * Retorna true se o freelancer pode ser considerado disponível na data.
 * Apenas "indisponivel" elimina; parcial/null/ausente são aceitos.
 */
function _isDisponivel(flId, data, disponibilidade) {
  const dayMap = disponibilidade[flId] || {};
  const val = dayMap[data];
  if (!val) return true;
  const status = typeof val === 'string' ? val : (val.status || 'parcial');
  return status !== 'indisponivel';
}

// ─── Score individual ─────────────────────────────────────────────────────────

/**
 * Calcula o score de um freelancer para uma função específica.
 *
 * @param {string}   flId    - ID do freelancer (string)
 * @param {string}   funcao  - nome da função a avaliar
 * @param {object}   ctx     - contexto do motor (montado por roster-data)
 * @param {object}   w       - pesos (default: DEFAULT_WEIGHTS)
 * @returns {{ score: number, motivos: string[] }}
 */
function calcScore(flId, funcao, ctx, w = DEFAULT_WEIGHTS) {
  const hist = ctx.historico[flId]  || { serviceCounts: {}, funcaoCounts: {}, lastEventDate: null };
  const fb   = ctx.feedbacks[flId]  || { avgNote: null };
  const motivos = [];
  let score = 0;

  // 1. Experiência no(s) serviço(s) do evento
  const serviceExp = (ctx.eventServiceIds || [])
    .reduce((sum, sid) => sum + (hist.serviceCounts[sid] || 0), 0);

  if (serviceExp > 0) {
    const fator = Math.min(serviceExp / 10, 1);
    score += w.servicoMesmo * fator;
    const nomes = ctx.eventServiceNames && ctx.eventServiceNames.length
      ? ctx.eventServiceNames.join(' e ')
      : 'este serviço';
    motivos.push(`Fez ${nomes} ${serviceExp}x`);
  }

  // 2. Experiência na função em qualquer serviço
  const funcaoExp = hist.funcaoCounts[funcao] || 0;
  if (funcaoExp > 0) {
    const fator = Math.min(funcaoExp / 10, 1);
    score += w.funcaoQualquer * fator;
    motivos.push(`Função ${funcao}: ${funcaoExp}x`);
  }

  // 3. Feedback
  if (fb.avgNote != null) {
    score += w.feedback * (fb.avgNote / 10);
    motivos.push(`Nota média ${Number(fb.avgNote).toFixed(1)}`);
  }

  // 4. Rotação (mais dias sem trabalhar = mais pontos, incentiva distribuição)
  if (hist.lastEventDate) {
    const now = ctx._now || new Date();
    const lastMs = new Date(hist.lastEventDate + 'T00:00:00').getTime();
    const dias = Math.floor((now.getTime() - lastMs) / 86_400_000);
    score += w.rotacao * Math.min(dias / 30, 1);
    motivos.push(`Último evento há ${dias} dia${dias !== 1 ? 's' : ''}`);
  } else {
    // Nunca trabalhou → máximo de rotação (favorece quem tem menos histórico)
    score += w.rotacao;
    motivos.push('Sem eventos anteriores');
  }

  // 5. Penalidade: já escalado em outro evento na mesma semana
  if (ctx.semana && ctx.semana.has(flId)) {
    score -= w.semana;
    motivos.push('Já escalado nesta semana');
  }

  return { score, motivos };
}

// ─── Ranqueamento por função ──────────────────────────────────────────────────

/**
 * Retorna todos os freelancers elegíveis para uma função, ranqueados por score.
 * Freelancers eliminados por filtro aparecem no final com score -Infinity.
 *
 * @param {string} funcao
 * @param {object} ctx
 * @param {object} [w]
 * @param {Set}    [excluidos] - IDs já alocados nesta rodada (cross-function)
 * @returns {Array<{ freelancerId, nome, score, motivos, eliminado? }>}
 */
function rankCandidatos(funcao, ctx, w = DEFAULT_WEIGHTS, excluidos = new Set()) {
  const { freelancers, conflitos, jaEscalados, disponibilidade } = ctx;
  const eventData = ctx.event.data;
  const elegíveis = [];
  const eliminados = [];

  for (const fl of freelancers) {
    const flId = String(fl.id);

    // Filtros estruturais: inativo ou não exerce a função
    if (fl.ativo === false) continue;
    if (!Array.isArray(fl.funcoes) || !fl.funcoes.includes(funcao)) continue;

    // Filtros eliminatórios situacionais
    let motivo = null;
    if (!_isDisponivel(flId, eventData, disponibilidade || {})) {
      motivo = 'Indisponível na data';
    } else if (conflitos && conflitos.has(flId)) {
      motivo = 'Conflito de horário';
    } else if (jaEscalados && jaEscalados.has(flId)) {
      motivo = 'Já escalado neste evento';
    } else if (excluidos.has(flId)) {
      motivo = 'Já alocado em outra função nesta sugestão';
    }

    if (motivo) {
      eliminados.push({ freelancerId: flId, nome: fl.nome, score: -Infinity, motivos: [motivo], eliminado: motivo });
      continue;
    }

    const { score, motivos } = calcScore(flId, funcao, ctx, w);
    elegíveis.push({ freelancerId: flId, nome: fl.nome, score, motivos });
  }

  // Elegíveis ordenados por score decrescente; empate: rotação já está no score
  elegíveis.sort((a, b) => b.score - a.score);

  return [...elegíveis, ...eliminados];
}

// ─── Motor principal ──────────────────────────────────────────────────────────

/**
 * Sugere escala para o evento.
 *
 * Para cada vaga necessária (funcao + quantidade), produz:
 *   - candidatos: lista completa ranqueada (elegíveis + eliminados)
 *   - sugeridos:  melhores candidatos sem repetição cross-função
 *
 * @param {object} ctx     - contexto montado por roster-data.loadContext()
 * @param {object} [w]     - pesos opcionais
 * @returns {Array<{
 *   funcao:      string,
 *   quantidade:  number,
 *   obrigatorio: boolean,
 *   candidatos:  Array<{ freelancerId, nome, score, motivos, eliminado? }>,
 *   sugeridos:   Array<{ freelancerId, nome, score, motivos }>,
 *   semSugestao: string|undefined,
 * }>}
 */
function sugerirEscala(ctx, w = DEFAULT_WEIGHTS) {
  const { requiredRoles } = ctx;
  const alocados = new Set(ctx.jaEscalados || []);

  return (requiredRoles || []).map(({ funcao, quantidade, obrigatorio }) => {
    const candidatos = rankCandidatos(funcao, ctx, w, alocados);
    const elegíveis  = candidatos.filter(c => !c.eliminado);
    const sugeridos  = [];

    for (let i = 0; i < (quantidade || 1); i++) {
      const prox = elegíveis.find(c => !alocados.has(c.freelancerId));
      if (prox) {
        alocados.add(prox.freelancerId);
        sugeridos.push(prox);
      }
    }

    const vaga = { funcao, quantidade: quantidade || 1, obrigatorio: obrigatorio ?? true, candidatos, sugeridos };

    if (sugeridos.length < (quantidade || 1)) {
      const faltam = (quantidade || 1) - sugeridos.length;
      vaga.semSugestao = elegíveis.length === 0
        ? `${faltam} vaga(s) sem sugestão: nenhum candidato com função "${funcao}" elegível`
        : `${faltam} vaga(s) sem sugestão: candidatos disponíveis insuficientes`;
    }

    return vaga;
  });
}

module.exports = { sugerirEscala, rankCandidatos, calcScore, DEFAULT_WEIGHTS };
