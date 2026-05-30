'use strict';

/**
 * Route optimization service.
 * Algorithm: time-window aware nearest-neighbor with priority weighting.
 * Falls back to chronological sort if Google Maps is unavailable.
 */

const maps = require('../../config/maps');

/**
 * Sorts a set of routes/events into optimal dispatch sequence.
 *
 * @param {string}   pontoSaida  - Origin address
 * @param {Array}    rotas       - Array of route objects with { endereco_evento, horario_inicio, prioridade }
 * @returns {Promise<Array>}     - Same array in optimized order
 */
async function otimizar(pontoSaida, rotas) {
  if (!rotas || rotas.length <= 1) return rotas || [];

  const enderecos = [pontoSaida, ...rotas.map(r => r.endereco_evento)];

  try {
    const matrix = await maps.distanceMatrix(enderecos, enderecos, true);
    const duracoes = parseDurations(matrix, enderecos.length);
    return nearestNeighbor(rotas, duracoes);
  } catch (err) {
    console.warn('[optimization] Fallback to time sort:', err.message);
    return sortByTime(rotas);
  }
}

/**
 * For each route in a day, calculates departure time and detects conflicts.
 *
 * @param {Array}  rotas  - Routes with motorista_id, horario_inicio, duracao_min
 * @param {Object} config - { tempo_seguranca_min, tempo_carga_min }
 * @returns {{ rotasComHorarios: Array, conflitos: Array }}
 */
function calcularDia(rotas, config) {
  const conflitos = [];
  // Group by driver
  const porMotorista = {};
  rotas.forEach(r => {
    if (!r.motorista_id) return;
    (porMotorista[r.motorista_id] = porMotorista[r.motorista_id] || []).push(r);
  });

  Object.entries(porMotorista).forEach(([mid, rs]) => {
    rs.sort((a, b) => new Date(a.horario_inicio) - new Date(b.horario_inicio));
    for (let i = 1; i < rs.length; i++) {
      const prev = rs[i - 1];
      const curr = rs[i];
      // Check if previous route's end (arrival + event_duration) overlaps with next departure
      const prevFim = new Date(prev.horario_chegada_calculado || prev.horario_inicio);
      const currSaida = new Date(curr.horario_saida_calculado || curr.horario_inicio);
      if (prevFim > currSaida) {
        conflitos.push({
          motorista_id: mid,
          rota1_id: prev.id, rota1_nome: prev.nome_evento,
          rota2_id: curr.id, rota2_nome: curr.nome_evento,
          mensagem: `Conflito: "${prev.nome_evento}" sobrepõe "${curr.nome_evento}"`,
        });
      }
    }
  });

  return { rotasComHorarios: rotas, conflitos };
}

/**
 * Calculates minimum number of drivers needed for a set of routes on the same day.
 */
function qtdMotoristasNecessarios(rotas) {
  if (!rotas.length) return 0;
  // Sort by start time
  const sorted = sortByTime(rotas);
  // Greedy interval scheduling
  const slots = []; // each slot = end time of last assigned route
  for (const r of sorted) {
    const ini = new Date(r.horario_inicio).getTime();
    const fim = new Date(r.horario_fim).getTime() + (r.motorista_permanece ? 0 : (r.duracao_min || 30) * 60_000);
    const free = slots.findIndex(end => end <= ini);
    if (free >= 0) slots[free] = fim;
    else slots.push(fim);
  }
  return slots.length;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseDurations(matrix, n) {
  const d = Array.from({ length: n }, () => new Array(n).fill(Infinity));
  (matrix?.rows || []).forEach((row, i) => {
    (row.elements || []).forEach((el, j) => {
      if (el.status === 'OK') {
        d[i][j] = el.duration_in_traffic?.value ?? el.duration?.value ?? Infinity;
      }
    });
  });
  return d;
}

function nearestNeighbor(rotas, duracoes) {
  const n = rotas.length;
  const visited = new Array(n).fill(false);
  const result = [];
  let cur = 0; // 0 = origin in duracoes matrix

  for (let step = 0; step < n; step++) {
    let best = -1, bestScore = Infinity;
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      const travel = duracoes[cur][i + 1] ?? Infinity; // +1 offset: origin is index 0
      const priorityWeight = (4 - (rotas[i].prioridade || 1)) * 600; // 10min per priority level
      const timeWeight = new Date(rotas[i].horario_inicio).getTime() / 1e9;
      const score = travel + priorityWeight + timeWeight;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    if (best >= 0) { visited[best] = true; result.push(rotas[best]); cur = best + 1; }
  }
  return result;
}

function sortByTime(rotas) {
  return [...rotas].sort((a, b) => new Date(a.horario_inicio) - new Date(b.horario_inicio));
}

module.exports = { otimizar, calcularDia, qtdMotoristasNecessarios };
