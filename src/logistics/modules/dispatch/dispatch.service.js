'use strict';

const repo     = require('./dispatch.repo');
const cfgRepo  = require('../config/config.repo');
const drvRepo  = require('../drivers/driver.repo');
const maps     = require('../../config/maps');
const optSvc   = require('../optimization/optimization.service');

/**
 * Creates a dispatch entry and immediately calculates route info.
 */
async function criar(adminId, body) {
  const { ponto_saida_id, ...rest } = body;
  const rota = { ...rest, ponto_saida_id, status: 'pendente' };

  // Validate required fields
  if (!rota.nome_evento || !rota.endereco_evento || !rota.data_evento || !rota.horario_inicio || !rota.horario_fim) {
    throw new Error('nome_evento, endereco_evento, data_evento, horario_inicio e horario_fim são obrigatórios.');
  }

  const { data, error } = await repo.create(adminId, rota);
  if (error) throw new Error(error.message);

  // Auto-calculate route if ponto_saida has address
  if (ponto_saida_id) setImmediate(() => calcularRota(data.id, adminId).catch(() => {}));

  return data;
}

/**
 * Calculates route info from Google Maps and updates the dispatch entry.
 */
async function calcularRota(id, adminId) {
  const { data: rota, error } = await repo.get(id);
  if (error || !rota) throw new Error('Rota não encontrada.');

  const pontoSaida = rota.ponto_saida?.endereco;
  if (!pontoSaida) throw new Error('Ponto de saída sem endereço.');

  const cfg    = await cfgRepo.get(adminId);
  const inicio = `${rota.data_evento}T${rota.horario_inicio}`;

  const info = await maps.routeInfo(pontoSaida, rota.endereco_evento, new Date(inicio).getTime());

  const horarioInicioMs  = new Date(inicio).getTime();
  const saida            = maps.horarioSaida(inicio, info.duracao_min, cfg);
  const chegada          = new Date(saida.getTime() + info.duracao_min * 60_000 + (cfg.tempo_carga_min || 20) * 60_000);

  const updates = {
    distancia_km:              info.distancia_km,
    duracao_min:               info.duracao_min,
    horario_saida_calculado:   saida.toISOString(),
    horario_chegada_calculado: chegada.toISOString(),
  };

  const { data: updated, error: errU } = await repo.update(id, adminId, updates);
  if (errU) throw new Error(errU.message);

  return updated;
}

/**
 * Generates the Google Maps navigation URL for the driver.
 * Includes all intermediate stops (paradas_extras) and handles tipo_rota.
 */
async function urlNavegacao(id) {
  const { data, error } = await repo.get(id);
  if (error || !data) throw new Error('Rota não encontrada.');

  const origem  = data.ponto_saida?.endereco;
  const destino = data.endereco_evento;

  if (!destino) throw new Error('Endereço do evento não configurado.');

  // Collect intermediate waypoints from paradas_extras
  const paradas = Array.isArray(data.paradas_extras) ? data.paradas_extras : [];
  const waypointsMeio = paradas.map(p => p.endereco).filter(Boolean);

  // Build full stop sequence
  const pontos = [];
  if (origem) pontos.push(origem);
  pontos.push(...waypointsMeio);
  pontos.push(destino);

  // For non-ida_fica routes: append return point after destination
  if (data.tipo_rota !== 'ida_fica') {
    const retorno = data.ponto_retorno?.endereco || origem;
    if (retorno && retorno !== pontos[pontos.length - 1]) pontos.push(retorno);
  }

  // Single point fallback (no origin configured)
  if (pontos.length < 2) {
    return { url: `https://www.google.com/maps/search/${encodeURIComponent(destino)}` };
  }

  const url = `https://www.google.com/maps/dir/${pontos.map(encodeURIComponent).join('/')}`;
  return { url };
}

/**
 * Updates driver status and records history.
 */
async function atualizarStatus(id, status, extra = {}) {
  const VALID = ['pendente','aguardando_saida','em_deslocamento','chegou','em_evento','retornando','finalizado','cancelado'];
  if (!VALID.includes(status)) throw new Error(`Status inválido: ${status}`);

  const now = new Date().toISOString();
  const updates = { status };

  if (status === 'em_deslocamento') updates.horario_saida_real    = now;
  if (status === 'chegou')          updates.horario_chegada_real  = now;
  if (status === 'retornando')      updates.horario_retorno_real  = now;

  const { error } = await repo.updateStatus(id, status);
  if (error) throw new Error(error.message);
  await repo.addHistory(id, status, { registrado_por: extra.por || 'motorista', observacao: extra.obs || null });

  // Update driver status
  const { data: rota } = await repo.get(id);
  if (rota?.motorista_id) {
    const driverStatus = {
      em_deslocamento: 'em_rota',
      chegou: 'aguardando',
      em_evento: 'preso_em_evento',
      retornando: 'retornando',
      finalizado: 'disponivel',
    }[status];
    if (driverStatus) await drvRepo.setStatus(rota.motorista_id, driverStatus);
  }

  return { ok: true, status };
}

/**
 * Optimizes all dispatches for a given day.
 */
async function otimizarDia(adminId, data) {
  const { data: rotas, error } = await repo.listByDate(adminId, data);
  if (error) throw new Error(error.message);
  if (!rotas?.length) return { rotas: [], conflitos: [] };

  // Find most common ponto_saida
  const pontoSaida = rotas.find(r => r.ponto_saida?.endereco)?.ponto_saida?.endereco || '';
  const otimizadas = await optSvc.otimizar(pontoSaida, rotas);
  const { conflitos } = optSvc.calcularDia(rotas, await cfgRepo.get(adminId));
  const qtd = optSvc.qtdMotoristasNecessarios(rotas);

  return { rotas: otimizadas, conflitos, motoristasNecessarios: qtd };
}

/**
 * Dashboard analytics.
 */
async function dashboard(adminId) {
  const { data: rotas, error } = await repo.listByAdmin(adminId, 200);
  if (error) throw new Error(error.message);

  const finalizadas = rotas.filter(r => r.status === 'finalizado');
  const atrasos     = finalizadas.filter(r =>
    r.horario_chegada_real && r.horario_chegada_calculado &&
    new Date(r.horario_chegada_real) > new Date(r.horario_chegada_calculado)
  );

  const totalKm = finalizadas.reduce((s, r) => s + (r.distancia_km || 0), 0);

  // Most used driver
  const contagem = {};
  finalizadas.forEach(r => { if (r.motorista_id) contagem[r.motorista_id] = (contagem[r.motorista_id] || 0) + 1; });
  const motoristaMaisUsado = Object.entries(contagem).sort((a, b) => b[1] - a[1])[0];

  return {
    total_rotas:          rotas.length,
    finalizadas:          finalizadas.length,
    taxa_atraso:          finalizadas.length ? Math.round(atrasos.length / finalizadas.length * 100) : 0,
    distancia_total_km:   Math.round(totalKm * 10) / 10,
    combustivel_estimado: Math.round(totalKm / 12 * 10) / 10, // 12 km/L default
    motorista_mais_usado: motoristaMaisUsado ? { id: motoristaMaisUsado[0], corridas: motoristaMaisUsado[1] } : null,
  };
}

/**
 * Admin confirms a route — sets confirmada_adm = true.
 * Driver app blocks status transitions until route is confirmed.
 */
async function confirmar(id, adminId) {
  const { data, error } = await repo.update(id, adminId, {
    confirmada_adm: true,
    confirmada_em: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  await repo.addHistory(id, 'confirmada_adm', { registrado_por: 'admin' });
  return data;
}

/**
 * Remove todas as rotas de dias anteriores ao dia atual.
 * Mantém apenas rotas de hoje em diante.
 */
async function limparAntigas(adminId) {
  const hoje = new Date().toISOString().slice(0, 10);
  const { data, error } = await repo.deleteAntigas(adminId, hoje);
  if (error) throw new Error(error.message);
  return { removidas: Array.isArray(data) ? data.length : 0 };
}

module.exports = { criar, calcularRota, urlNavegacao, atualizarStatus, confirmar, limparAntigas, otimizarDia, dashboard };
