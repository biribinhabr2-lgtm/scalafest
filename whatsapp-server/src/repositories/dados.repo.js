'use strict';

/**
 * dados.repo.js
 *
 * Acesso genérico à tabela sf_dados do Supabase.
 *
 * O Dashboard armazena TODOS os dados como blobs JSON nessa tabela:
 *   sf_dados(user_id, tipo, dados)
 *
 * Exemplos de `tipo`: "eventos", "freelancers", "disponibilidade", etc.
 */

const supabase = require('../config/supabase');

/**
 * Carrega o array JSON de um `tipo` para um determinado `adminId`.
 *
 * @param {string} adminId  - UUID do admin (user_id no Supabase Auth)
 * @param {string} tipo     - Ex: "eventos", "freelancers"
 * @returns {Promise<any[]>} - Array de objetos (vazio se não encontrado)
 */
async function loadDados(adminId, tipo) {
  const { data, error } = await supabase
    .from('sf_dados')
    .select('dados')
    .eq('user_id', adminId)
    .eq('tipo', tipo)
    .maybeSingle();

  if (error) throw new Error(`Supabase [${tipo}]: ${error.message}`);
  if (!data || !data.dados) return [];

  // dados pode vir como string JSON ou já como array
  const parsed = typeof data.dados === 'string'
    ? JSON.parse(data.dados)
    : data.dados;

  return Array.isArray(parsed) ? parsed : [];
}

// ─── Helpers de domínio (evitam repetir o mesmo .from() em todo o código) ─────

/** Retorna a lista de eventos do admin. */
async function loadEventos(adminId) {
  return loadDados(adminId, 'eventos');
}

/** Retorna a lista de freelancers/colaboradores do admin. */
async function loadFreelancers(adminId) {
  return loadDados(adminId, 'freelancers');
}

module.exports = { loadDados, loadEventos, loadFreelancers };
