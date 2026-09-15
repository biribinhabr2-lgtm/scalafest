'use strict';

const templateSvc = require('../services/template.service');
const repo        = require('../repositories/templates.repo');

/**
 * GET /api/templates?adminId=xxx
 * Retorna os 6 templates (merged DB + defaults) para o tenant.
 */
async function listar(req, res) {
  const adminId = req.query.adminId || req.headers['x-admin-id'];
  if (!adminId) return res.status(400).json({ error: 'adminId é obrigatório.' });

  try {
    const templates = await templateSvc.listarTodos(adminId);
    res.json(templates);
  } catch (err) {
    console.error('[templates.controller] listar:', err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * PUT /api/templates/:chave?adminId=xxx
 * Body: { corpo: string, updatedBy?: string }
 * Salva corpo customizado para o tenant. Valida variáveis conhecidas.
 */
async function salvar(req, res) {
  const adminId = req.query.adminId || req.headers['x-admin-id'];
  const { chave } = req.params;
  const { corpo, ativo, updatedBy } = req.body || {};

  if (!adminId) return res.status(400).json({ error: 'adminId é obrigatório.' });
  // corpo é obrigatório apenas quando ativo não é o único campo mudando
  if (ativo === undefined && (!corpo || !corpo.trim())) {
    return res.status(400).json({ error: 'corpo não pode ser vazio.' });
  }

  const def = templateSvc.getDefault(chave);
  if (!def) return res.status(404).json({ error: `Chave desconhecida: ${chave}` });

  // Valida variáveis usadas no corpo (se corpo foi fornecido)
  if (corpo) {
    const usados = [...corpo.matchAll(/\{\{(\w+)\}\}/g)].map(m => `{{${m[1]}}}`);
    const desconhecidos = usados.filter(v => !def.variaveis_disponiveis.includes(v));
    if (desconhecidos.length) {
      return res.status(422).json({
        error: `Variáveis não reconhecidas para "${chave}": ${desconhecidos.join(', ')}`,
      });
    }
  }

  try {
    const saved = await repo.upsert(adminId, chave, {
      corpo: corpo ? corpo.trim() : undefined,
      ativo,
      updatedBy,
    });
    templateSvc.clearCache(adminId);
    res.json(saved);
  } catch (err) {
    console.error('[templates.controller] salvar:', err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * DELETE /api/templates/:chave?adminId=xxx
 * Remove a customização do tenant — próxima leitura usará o default.
 */
async function restaurar(req, res) {
  const adminId = req.query.adminId || req.headers['x-admin-id'];
  const { chave } = req.params;

  if (!adminId) return res.status(400).json({ error: 'adminId é obrigatório.' });

  const def = templateSvc.getDefault(chave);
  if (!def) return res.status(404).json({ error: `Chave desconhecida: ${chave}` });

  try {
    await repo.remover(adminId, chave);
    templateSvc.clearCache(adminId);
    res.json({ restaurado: true, corpo: def.corpo });
  } catch (err) {
    console.error('[templates.controller] restaurar:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listar, salvar, restaurar };
