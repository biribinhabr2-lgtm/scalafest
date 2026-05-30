'use strict';
const repo = require('./driver.repo');

async function listar(adminId) {
  const { data, error } = await repo.list(adminId);
  if (error) throw new Error(error.message);
  return data;
}

async function buscar(id, adminId) {
  const { data, error } = await repo.get(id, adminId);
  if (error) throw new Error(error.message);
  return data;
}

async function criar(adminId, body) {
  const { nome, telefone, pin, veiculo_id, ponto_inicial_id } = body;
  if (!nome) throw new Error('Nome é obrigatório.');
  const { data, error } = await repo.create(adminId, { nome, telefone, pin, veiculo_id, ponto_inicial_id, status: 'disponivel', ativo: true });
  if (error) throw new Error(error.message);
  return data;
}

async function atualizar(id, adminId, body) {
  const { data, error } = await repo.update(id, adminId, body);
  if (error) throw new Error(error.message);
  return data;
}

async function remover(id, adminId) {
  const { error } = await repo.remove(id, adminId);
  if (error) throw new Error(error.message);
}

async function autenticar(telefone, pin) {
  const { data, error } = await repo.findByPhone(telefone, pin);
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Telefone ou PIN inválidos.');
  return data;
}

module.exports = { listar, buscar, criar, atualizar, remover, autenticar };
