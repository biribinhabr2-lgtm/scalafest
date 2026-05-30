'use strict';
const sb = require('../../../config/supabase');
const T  = 'sf_rotas';
const TH = 'sf_historico_status';

const SELECT_FULL = `
  *,
  motorista:sf_motoristas(id,nome,telefone,status),
  veiculo:sf_veiculos(nome,placa,capacidade),
  ponto_saida:sf_pontos_encontro!ponto_saida_id(nome,endereco,lat,lng),
  ponto_retorno:sf_pontos_encontro!ponto_retorno_id(nome,endereco,lat,lng)
`.trim();

module.exports = {
  listByDate: (adminId, data) =>
    sb.from(T).select(SELECT_FULL).eq('admin_id', adminId).eq('data_evento', data).order('horario_inicio'),

  listByAdmin: (adminId, limit = 50) =>
    sb.from(T).select(SELECT_FULL).eq('admin_id', adminId).order('data_evento', { ascending: false }).order('horario_inicio').limit(limit),

  listByDriver: (motoristaId, data) =>
    sb.from(T).select(SELECT_FULL).eq('motorista_id', motoristaId).eq('data_evento', data).order('horario_inicio'),

  get: (id) =>
    sb.from(T).select(SELECT_FULL).eq('id', id).single(),

  create: (adminId, data) =>
    sb.from(T).insert({ ...data, admin_id: adminId, updated_at: new Date().toISOString() }).select(SELECT_FULL).single(),

  update: (id, adminId, data) =>
    sb.from(T).update({ ...data, updated_at: new Date().toISOString() }).eq('id', id).eq('admin_id', adminId).select(SELECT_FULL).single(),

  updateStatus: (id, status) =>
    sb.from(T).update({ status, updated_at: new Date().toISOString() }).eq('id', id),

  remove: (id, adminId) =>
    sb.from(T).delete().eq('id', id).eq('admin_id', adminId),

  addHistory: (rotaId, status, extra = {}) =>
    sb.from(TH).insert({ rota_id: rotaId, status, ...extra }),

  getHistory: (rotaId) =>
    sb.from(TH).select('*').eq('rota_id', rotaId).order('criado_em', { ascending: false }),

  livePanel: (adminId) =>
    sb.from(T).select(SELECT_FULL)
      .eq('admin_id', adminId)
      .not('status', 'in', '(finalizado,cancelado)')
      .order('data_evento').order('horario_inicio'),
};
