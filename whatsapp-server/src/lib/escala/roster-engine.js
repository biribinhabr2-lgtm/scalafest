'use strict';

/**
 * roster-engine.js — Motor puro de sugestão de escala.
 *
 * Sem dependências externas nem chamadas a banco.
 * Entrada: contexto montado por roster-data.js
 * Saída:   { vagas, aviso_rotacao? }
 *
 * Critérios de ranking (por peso decrescente):
 *   1. Eventos na função (funcaoExp)
 *   2. Estrelas atribuídas pelo admin (estrelas)
 *   3. Dias sem trabalhar — rotação (rotacao)
 *   4. Eventos no mesmo serviço — desempate (servicoExp)
 *
 * Feedbacks de freelancers NÃO entram no cálculo.
 */

// ─── Configuração ─────────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS = {
  funcaoExp:  10,  // eventos na função (cap 20 → fator 0–1)
  estrelas:    3,  // 1–5 estrelas → score 0–3 (default 3 = 1.5)
  rotacao:     2,  // dias parado → 0–2 (cap em dias_para_considerar_parado * 2)
  servicoExp:  1,  // eventos no mesmo serviço (cap 10 → fator 0–1)
};

const ROTATION_CONFIG = {
  dias_para_considerar_parado: 14,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** "HH:MM" → "Xh" ou "Xh30" */
function _fmtHora(hhmm) {
  if (!hhmm) return '?';
  const [h, m] = hhmm.split(':');
  const min = parseInt(m, 10);
  return min ? `${parseInt(h, 10)}h${String(min).padStart(2, '0')}` : `${parseInt(h, 10)}h`;
}

/** Dias desde o último evento (Infinity = nunca trabalhou). */
function _diasSemTrabalhar(flId, ctx) {
  const hist = ctx.historico[flId] || {};
  if (!hist.lastEventDate) return Infinity;
  const now = ctx._now || new Date();
  const lastMs = new Date(hist.lastEventDate + 'T00:00:00').getTime();
  return Math.floor((now.getTime() - lastMs) / 86_400_000);
}

// ─── Verificação de disponibilidade ───────────────────────────────────────────

/**
 * Verifica se a janela de disponibilidade do freelancer cobre o horário do evento.
 *
 * Disponibilidade por dia (sf_dados tipo='disponibilidade'):
 *   "disponivel"                                  → dia inteiro
 *   "indisponivel"                                → bloqueado
 *   { status:"parcial", tipo:"apos",  hora }      → disponível a partir de hora
 *   { status:"parcial", tipo:"antes", hora }      → disponível até hora
 *   { status:"parcial", tipo:"entre", hora, hora2 } → janela específica
 *   { status:"parcial", tipo:"obs",   obs }       → restrição textual s/ horário
 *   ausente / null                               → disponível (não marcou nada)
 *
 * @returns {{ elegivel: boolean, eliminadoMotivo: string|null, janelaLabel: string }}
 */
function _checkDisponibilidade(flId, eventData, horaInicio, horaFim, disponibilidade) {
  const dayMap = disponibilidade[flId] || {};
  const val = dayMap[eventData];

  // Não marcou nada → disponível o dia todo
  if (val == null) {
    return { elegivel: true, eliminadoMotivo: null, janelaLabel: 'Disponível o dia todo' };
  }

  // Valor simples (string)
  if (typeof val === 'string') {
    if (val === 'indisponivel') {
      return { elegivel: false, eliminadoMotivo: 'Indisponível na data', janelaLabel: null };
    }
    return { elegivel: true, eliminadoMotivo: null, janelaLabel: 'Disponível o dia todo' };
  }

  // Objeto com status
  const status = val.status || 'parcial';
  if (status === 'indisponivel') {
    return { elegivel: false, eliminadoMotivo: 'Indisponível na data', janelaLabel: null };
  }
  if (status === 'disponivel') {
    return { elegivel: true, eliminadoMotivo: null, janelaLabel: 'Disponível o dia todo' };
  }

  // status === 'parcial'
  const tipo = val.tipo || 'obs';
  const hora  = val.hora  || null;
  const hora2 = val.hora2 || null;

  // Restrição textual sem horário → não dá para verificar, trata como elegível
  if (tipo === 'obs' || !hora) {
    return { elegivel: true, eliminadoMotivo: null, janelaLabel: 'Disponível (com restrição)' };
  }

  // Sem horário de evento → não eliminar, mas mostrar a janela
  if (!horaInicio || !horaFim) {
    let janelaLabel = 'Disponível (com restrição)';
    if (tipo === 'apos')  janelaLabel = `A partir de ${_fmtHora(hora)}`;
    else if (tipo === 'antes') janelaLabel = `Disponível até ${_fmtHora(hora)}`;
    else if (tipo === 'entre') janelaLabel = `Disponível ${_fmtHora(hora)} às ${_fmtHora(hora2 || '23:59')}`;
    return { elegivel: true, eliminadoMotivo: null, janelaLabel };
  }

  // Verificar cobertura do horário do evento
  if (tipo === 'apos') {
    // Disponível a partir de hora → evento deve começar >= hora
    const janelaLabel = `A partir de ${_fmtHora(hora)}`;
    if (horaInicio >= hora) {
      return { elegivel: true, eliminadoMotivo: null, janelaLabel };
    }
    return {
      elegivel: false,
      eliminadoMotivo: `Disponível só a partir de ${_fmtHora(hora)} (evento começa às ${_fmtHora(horaInicio)})`,
      janelaLabel,
    };
  }

  if (tipo === 'antes') {
    // Disponível até hora → evento deve terminar <= hora
    const janelaLabel = `Disponível até ${_fmtHora(hora)}`;
    if (horaFim <= hora) {
      return { elegivel: true, eliminadoMotivo: null, janelaLabel };
    }
    return {
      elegivel: false,
      eliminadoMotivo: `Disponível só até ${_fmtHora(hora)} (evento termina às ${_fmtHora(horaFim)})`,
      janelaLabel,
    };
  }

  if (tipo === 'entre') {
    const fim = hora2 || '23:59';
    const janelaLabel = `Disponível ${_fmtHora(hora)} às ${_fmtHora(fim)}`;
    if (horaInicio >= hora && horaFim <= fim) {
      return { elegivel: true, eliminadoMotivo: null, janelaLabel };
    }
    return {
      elegivel: false,
      eliminadoMotivo: `Disponível ${_fmtHora(hora)}–${_fmtHora(fim)} (evento ${_fmtHora(horaInicio)}–${_fmtHora(horaFim)})`,
      janelaLabel,
    };
  }

  // Tipo desconhecido → não eliminar
  return { elegivel: true, eliminadoMotivo: null, janelaLabel: 'Disponível (com restrição)' };
}

// ─── Score individual ─────────────────────────────────────────────────────────

/**
 * Calcula score e motivos de um freelancer para uma função.
 *
 * Não usa feedbacks de freelancers em nenhum critério.
 *
 * @param {string}   flId
 * @param {string}   funcao
 * @param {object}   ctx
 * @param {object}   [w]
 * @returns {{ score: number, motivos: string[] }}
 */
function calcScore(flId, funcao, ctx, w = DEFAULT_WEIGHTS) {
  const hist = ctx.historico[flId] || { serviceCounts: {}, funcaoCounts: {}, lastEventDate: null };
  const motivos = [];
  let score = 0;

  // 1. Eventos na função (critério principal)
  const funcaoExp = hist.funcaoCounts[funcao] || 0;
  score += Math.min(funcaoExp / 20, 1) * w.funcaoExp;
  if (funcaoExp > 0) {
    motivos.push(`${funcaoExp} evento${funcaoExp !== 1 ? 's' : ''} como ${funcao}`);
  }

  // 2. Estrelas atribuídas pelo admin (default 3 se não definido)
  const fl = ctx.freelancers.find(f => String(f.id) === flId);
  const estrelasRaw = fl?.estrelas;
  const estrelas = (typeof estrelasRaw === 'number' && estrelasRaw > 0) ? estrelasRaw : 3;
  score += ((estrelas - 1) / 4) * w.estrelas;
  motivos.push(`${estrelas} estrela${estrelas !== 1 ? 's' : ''}`);

  // 3. Dias sem trabalhar (incentivo à rotação)
  const dias = _diasSemTrabalhar(flId, ctx);
  const diasCap = ROTATION_CONFIG.dias_para_considerar_parado * 2;
  const diasEfetivo = dias === Infinity ? diasCap : Math.min(dias, diasCap);
  score += (diasEfetivo / diasCap) * w.rotacao;
  if (dias === Infinity) {
    motivos.push('Sem eventos anteriores');
  } else {
    motivos.push(`Sem trabalhar há ${dias} dia${dias !== 1 ? 's' : ''}`);
  }

  // 4. Experiência no(s) serviço(s) específico(s) do evento (tie-breaker)
  const serviceExp = (ctx.eventServiceIds || [])
    .reduce((sum, sid) => sum + (hist.serviceCounts[sid] || 0), 0);
  if (serviceExp > 0) {
    score += Math.min(serviceExp / 10, 1) * w.servicoExp;
    const nomes = ctx.eventServiceNames?.length
      ? ctx.eventServiceNames.join(' e ')
      : 'este serviço';
    motivos.push(`Já fez ${nomes} ${serviceExp}x`);
  }

  return { score, motivos };
}

// ─── Ranqueamento por função ──────────────────────────────────────────────────

/**
 * Retorna todos os candidatos para uma função, ranqueados por score.
 * Candidatos eliminados aparecem no final com score -Infinity.
 *
 * @param {string} funcao
 * @param {object} ctx
 * @param {object} [w]
 * @param {Set}    [excluidos] - IDs já alocados nesta rodada
 * @returns {Array}
 */
function rankCandidatos(funcao, ctx, w = DEFAULT_WEIGHTS, excluidos = new Set()) {
  const { freelancers, conflitos, jaEscalados, disponibilidade } = ctx;
  const eventData  = ctx.event.data;
  const horaInicio = ctx.event.horaInicio || null;
  const horaFim    = ctx.event.horaFim    || null;
  const elegíveis  = [];
  const eliminados = [];

  for (const fl of freelancers) {
    const flId = String(fl.id);

    // Filtros estruturais (não geram motivo — o candidato não aparece)
    if (fl.ativo === false) continue;
    // Comparação com trim() para tolerar espaços extras (ex: "Apoio " vs "Apoio")
    if (!Array.isArray(fl.funcoes) || !fl.funcoes.map(f => f.trim()).includes(funcao.trim())) continue;

    // Filtros eliminatórios situacionais (aparecem no painel como inelegíveis)
    let motivo = null;

    if (jaEscalados && jaEscalados.has(flId)) {
      motivo = 'Já escalado neste evento';
    } else if (excluidos.has(flId)) {
      motivo = 'Já alocado em outra função nesta sugestão';
    } else {
      // Verificação de disponibilidade por horário
      const { elegivel, eliminadoMotivo, janelaLabel } =
        _checkDisponibilidade(flId, eventData, horaInicio, horaFim, disponibilidade || {});

      if (!elegivel) {
        motivo = eliminadoMotivo;
      } else if (conflitos && conflitos.has(flId)) {
        // Conflito de horário com outro evento no mesmo dia
        motivo = 'Conflito de horário';
      } else {
        const { score, motivos } = calcScore(flId, funcao, ctx, w);
        motivos.push(janelaLabel);
        const dias = _diasSemTrabalhar(flId, ctx);
        elegíveis.push({ freelancerId: flId, nome: fl.nome, score, motivos, _dias: dias });
        continue;
      }
    }

    eliminados.push({
      freelancerId: flId,
      nome: fl.nome,
      score: -Infinity,
      motivos: [motivo],
      eliminado: motivo,
    });
  }

  elegíveis.sort((a, b) => b.score - a.score);
  return [...elegíveis, ...eliminados];
}

// ─── Motor principal ──────────────────────────────────────────────────────────

/**
 * Sugere escala para o evento.
 *
 * @param {object} ctx   - contexto de roster-data.loadContext()
 * @param {object} [w]   - pesos (default: DEFAULT_WEIGHTS)
 * @returns {{ vagas: Array, aviso_rotacao?: string }}
 */
function sugerirEscala(ctx, w = DEFAULT_WEIGHTS) {
  const { requiredRoles } = ctx;
  const alocados = new Set(ctx.jaEscalados || []);
  const threshold = ROTATION_CONFIG.dias_para_considerar_parado;

  const vagas = (requiredRoles || []).map(({ funcao, quantidade, obrigatorio }) => {
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

    const vaga = {
      funcao,
      quantidade: quantidade || 1,
      obrigatorio: obrigatorio ?? true,
      candidatos,
      sugeridos,
    };

    if (sugeridos.length < (quantidade || 1)) {
      const faltam = (quantidade || 1) - sugeridos.length;
      vaga.semSugestao = elegíveis.length === 0
        ? `${faltam} vaga(s) sem sugestão: nenhum candidato com função "${funcao}" elegível`
        : `${faltam} vaga(s) sem sugestão: candidatos disponíveis insuficientes`;
    }

    return vaga;
  });

  // ── Regra de rotação global ────────────────────────────────────────────────
  //
  // Ao menos uma vaga sugerida deve ir para alguém parado >= threshold dias.
  // Se nenhum alocado cumprir isso, substituímos a alocação de menor score
  // pela pessoa elegível para aquela função com mais dias ociosa.

  const todosAlocados = vagas.flatMap(v => v.sugeridos);

  if (todosAlocados.length === 0) {
    return { vagas };
  }

  const algumJaParado = todosAlocados.some(s => {
    const d = s._dias ?? _diasSemTrabalhar(s.freelancerId, ctx);
    return d >= threshold;
  });

  if (algumJaParado) {
    return { vagas };
  }

  // Buscar o melhor par (vaga, candidato_parado) para substituição
  let melhorCandidato = null;
  let melhorVagaIdx   = -1;
  let melhorSugIdx    = -1;
  let melhorDias      = -1;

  for (let vi = 0; vi < vagas.length; vi++) {
    const vaga = vagas[vi];
    if (vaga.sugeridos.length === 0) continue;

    // Candidatos elegíveis para esta função que não estão ainda alocados
    // Inclui quem foi eliminado apenas por "Já alocado em outra função nesta sugestão"
    // mas que agora (após substituição) poderia ser liberado
    const candidatosParados = vaga.candidatos
      .filter(c => {
        if (alocados.has(c.freelancerId)) return false;
        if (!c.eliminado) return true;
        if (c.eliminado === 'Já alocado em outra função nesta sugestão') return true;
        return false;
      })
      .filter(c => {
        const d = c._dias ?? _diasSemTrabalhar(c.freelancerId, ctx);
        return d >= threshold;
      })
      .sort((a, b) => {
        const da = a._dias ?? _diasSemTrabalhar(a.freelancerId, ctx);
        const db = b._dias ?? _diasSemTrabalhar(b.freelancerId, ctx);
        return db - da; // mais parado primeiro
      });

    if (candidatosParados.length === 0) continue;

    const cand = candidatosParados[0];
    const dias = cand._dias ?? _diasSemTrabalhar(cand.freelancerId, ctx);

    if (dias > melhorDias) {
      melhorDias      = dias;
      melhorCandidato = cand;
      melhorVagaIdx   = vi;
      // Sugerido com menor score nesta vaga
      melhorSugIdx = vaga.sugeridos.reduce(
        (minIdx, s, i, arr) => s.score < arr[minIdx].score ? i : minIdx,
        0,
      );
    }
  }

  if (melhorCandidato && melhorVagaIdx >= 0 && melhorSugIdx >= 0) {
    const vaga       = vagas[melhorVagaIdx];
    const substituido = vaga.sugeridos[melhorSugIdx];
    alocados.delete(substituido.freelancerId);
    alocados.add(melhorCandidato.freelancerId);

    const janelaLabel = (_checkDisponibilidade(
      melhorCandidato.freelancerId,
      ctx.event.data,
      ctx.event.horaInicio,
      ctx.event.horaFim,
      ctx.disponibilidade || {},
    )).janelaLabel || 'Disponível o dia todo';

    const { score, motivos } = calcScore(melhorCandidato.freelancerId, vaga.funcao, ctx, w);
    motivos.push(janelaLabel);

    vaga.sugeridos[melhorSugIdx] = {
      freelancerId: melhorCandidato.freelancerId,
      nome:         melhorCandidato.nome,
      score,
      motivos,
      _dias:        melhorDias,
      rotacao:      true,
    };

    return { vagas };
  }

  // Não há ninguém elegível parado para nenhuma vaga
  return { vagas, aviso_rotacao: 'ninguém em rotação disponível nesta data' };
}

module.exports = {
  sugerirEscala,
  rankCandidatos,
  calcScore,
  DEFAULT_WEIGHTS,
  ROTATION_CONFIG,
  _checkDisponibilidade,
  _fmtHora,
};
