'use strict';
const sb = require('../../../config/supabase');
const T = 'sf_config_logistica';

const DEFAULTS = { tempo_seguranca_min: 30, tempo_carga_min: 20, tempo_desmontagem_min: 20 };

async function get(adminId) {
  const { data } = await sb.from(T).select('*').eq('admin_id', adminId).maybeSingle();
  return data || { admin_id: adminId, ...DEFAULTS };
}

async function upsert(adminId, fields) {
  const { data, error } = await sb.from(T)
    .upsert({ admin_id: adminId, ...fields, updated_at: new Date().toISOString() }, { onConflict: 'admin_id' })
    .select().single();
  if (error) throw new Error(error.message);
  return data;
}

module.exports = { get, upsert, DEFAULTS };
