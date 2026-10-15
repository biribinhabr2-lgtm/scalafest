'use strict';

/**
 * envios.repo.js
 *
 * Acesso à tabela sf_envios_wa — registros de envios via WhatsApp.
 * A tabela é criada pelo migration: supabase/migrations/001_whatsapp_schema.sql
 */

const supabase = require('../config/supabase');

/**
 * Persiste um ou mais registros de envio (bem-sucedidos ou com erro).
 *
 * @param {Array<{
 *   admin_id: string,
 *   evento_id: number,
 *   evento_nome: string,
 *   freelancer_id: number,
 *   freelancer_nome: string,
 *   telefone: string,
 *   mensagem: string,
 *   status: 'enviado'|'erro'|'sem_telefone',
 *   erro?: string
 * }>} registros
 */
async function salvarEnvios(registros) {
  if (!registros.length) return;

  const { error } = await supabase
    .from('sf_envios_wa')
    .insert(registros);

  if (error) {
    // Log mas não interrompe o fluxo principal
    console.error('[envios.repo] Erro ao salvar registros:', error.message);
  }
}

/**
 * Retorna o histórico de envios de um admin, ordenado do mais recente.
 *
 * @param {string} adminId
 * @param {number} limite - Quantos registros retornar (padrão: 50)
 */
async function listarEnvios(adminId, limite = 50) {
  const { data, error } = await supabase
    .from('sf_envios_wa')
    .select('*')
    .eq('admin_id', adminId)
    .order('enviado_em', { ascending: false })
    .limit(limite);

  if (error) throw new Error(`Supabase [sf_envios_wa]: ${error.message}`);
  return data ?? [];
}

/**
 * Retorna o conjunto de freelancer_ids que já receberam mensagem individual
 * para qualquer um dos eventIds fornecidos.
 *
 * Usado pelo escala.service para evitar duplicação de individuais no reenvio.
 *
 * @param {string}   adminId
 * @param {string[]} eventIds - UUIDs dos eventos do dia
 * @returns {Promise<Set<string>>}
 */
async function listarIndividuaisEnviados(adminId, eventIds) {
  const ids = eventIds.filter(Boolean);
  if (!ids.length) return new Set();

  const { data, error } = await supabase
    .from('sf_envios_wa')
    .select('freelancer_id')
    .eq('admin_id', adminId)
    .in('evento_id', ids)
    .eq('mensagem', 'mensagem individual enviada')
    .eq('status', 'enviado');

  if (error) {
    console.warn('[envios.repo] listarIndividuaisEnviados:', error.message);
    return new Set();
  }
  return new Set((data ?? []).map(r => String(r.freelancer_id)));
}

module.exports = { salvarEnvios, listarEnvios, listarIndividuaisEnviados };
