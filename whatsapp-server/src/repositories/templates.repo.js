'use strict';

const supabase = require('../config/supabase');

async function listar(tenantId) {
  const { data, error } = await supabase
    .from('message_templates')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('chave');
  if (error) throw new Error(`[templates.repo] listar: ${error.message}`);
  return data || [];
}

async function upsert(tenantId, chave, { corpo, ativo, updatedBy }) {
  // Se corpo não foi fornecido, tenta buscar o existente para não apagar
  let corpoFinal = corpo;
  if (corpoFinal === undefined) {
    const { data: existente } = await supabase
      .from('message_templates')
      .select('corpo')
      .eq('tenant_id', tenantId)
      .eq('chave', chave)
      .maybeSingle();
    corpoFinal = existente?.corpo;
  }
  if (!corpoFinal) throw new Error(`Corpo obrigatório para ${chave}`);

  const row = {
    tenant_id:             tenantId,
    chave,
    nome:                  _nome(chave),
    corpo:                 corpoFinal,
    variaveis_disponiveis: _vars(chave),
    ativo:                 ativo !== undefined ? ativo : true,
    updated_at:            new Date().toISOString(),
    updated_by:            updatedBy || null,
  };

  const { data, error } = await supabase
    .from('message_templates')
    .upsert(row, { onConflict: 'tenant_id,chave' })
    .select()
    .single();
  if (error) throw new Error(`[templates.repo] upsert: ${error.message}`);
  return data;
}

async function remover(tenantId, chave) {
  const { error } = await supabase
    .from('message_templates')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('chave', chave);
  if (error) throw new Error(`[templates.repo] remover: ${error.message}`);
}

// Nomes amigáveis por chave
function _nome(chave) {
  const nomes = {
    confirmacao_presenca:  'Confirmação de Presença',
    aviso_pagamento:       'Aviso de Pagamento',
    caches_pendentes_lote: 'Cachês Pendentes (lote)',
    escala_diaria_grupo:   'Escala do Dia (grupo)',
    lembrete_vespera:      'Lembrete Véspera',
    feedback_pos_evento:   'Pedido de Feedback',
  };
  return nomes[chave] || chave;
}

// Variáveis disponíveis por chave — mantido em sync com template.service.js DEFAULTS
function _vars(chave) {
  const vars = {
    confirmacao_presenca:  ['{{nome}}','{{evento}}','{{data}}','{{hora_inicio}}','{{hora_fim}}','{{local}}','{{funcao}}','{{cache}}'],
    aviso_pagamento:       ['{{nome}}','{{evento}}','{{data}}','{{cache}}','{{pix_linha}}','{{pix}}'],
    caches_pendentes_lote: ['{{nome}}','{{lista_eventos}}','{{total}}','{{pix_linha}}','{{pix}}'],
    escala_diaria_grupo:   ['{{data_extenso}}','{{blocos_eventos}}'],
    lembrete_vespera:      ['{{nome}}','{{evento}}','{{data}}','{{hora_inicio}}','{{hora_fim}}','{{local}}','{{funcao}}'],
    feedback_pos_evento:   ['{{nome}}','{{evento}}','{{link_feedback}}'],
  };
  return vars[chave] || [];
}

module.exports = { listar, upsert, remover, _nome, _vars };
