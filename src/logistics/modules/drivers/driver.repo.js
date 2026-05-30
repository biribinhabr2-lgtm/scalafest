'use strict';
const sb = require('../../../config/supabase');
const T = 'sf_motoristas';

const list   = (adminId)              => sb.from(T).select('*, veiculo:sf_veiculos(nome,placa), ponto:sf_pontos_encontro(nome)').eq('admin_id', adminId).order('nome');
const get    = (id, adminId)          => sb.from(T).select('*, veiculo:sf_veiculos(*), ponto:sf_pontos_encontro(*)').eq('id', id).eq('admin_id', adminId).single();
const create = (adminId, data)        => sb.from(T).insert({ ...data, admin_id: adminId }).select().single();
const update = (id, adminId, data)    => sb.from(T).update(data).eq('id', id).eq('admin_id', adminId).select().single();
const remove = (id, adminId)          => sb.from(T).delete().eq('id', id).eq('admin_id', adminId);
const setStatus = (id, status)        => sb.from(T).update({ status }).eq('id', id);
const findByPhone = (telefone, pin)   => sb.from(T).select('*, veiculo:sf_veiculos(nome), ponto:sf_pontos_encontro(nome,endereco)').eq('telefone', telefone).eq('pin', pin).eq('ativo', true).maybeSingle();

module.exports = { list, get, create, update, remove, setStatus, findByPhone };
