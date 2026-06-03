'use strict';

/**
 * supabaseAuthState.js
 *
 * Implementa a interface useMultiFileAuthState do Baileys, mas persiste
 * as credenciais no Supabase em vez de arquivos locais.
 *
 * Tabela necessária (execute no SQL Editor do Supabase):
 *
 *   CREATE TABLE IF NOT EXISTS wa_sessions (
 *     admin_id     TEXT        NOT NULL,
 *     session_key  TEXT        NOT NULL,
 *     session_data JSONB       NOT NULL,
 *     updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *     PRIMARY KEY (admin_id, session_key)
 *   );
 */

const supabase = require('../config/supabase');
const { proto, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');

const TABLE = 'wa_sessions';

// ─── Helpers de leitura/escrita ────────────────────────────────────────────────

/**
 * Lê um registro do Supabase e desserializa (restaurando Buffers via BufferJSON).
 */
async function readData(adminId, key) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('session_data')
    .eq('admin_id', adminId)
    .eq('session_key', key)
    .maybeSingle();

  if (error || !data) return null;

  // data.session_data já é um objeto JS (Supabase faz o parse do JSONB).
  // Usamos JSON.stringify + JSON.parse com o reviver do Baileys para
  // restaurar quaisquer campos { type: "Buffer", data: [...] } como Buffer real.
  try {
    return JSON.parse(JSON.stringify(data.session_data), BufferJSON.reviver);
  } catch {
    return null;
  }
}

/**
 * Persiste um registro no Supabase (upsert), serializando Buffers via BufferJSON.
 */
async function writeData(adminId, key, value) {
  // JSON.stringify com o replacer converte Buffers para { type: "Buffer", data: [...] },
  // e o JSON.parse de volta produz um objeto puro pronto para o JSONB.
  const serialized = JSON.parse(JSON.stringify(value, BufferJSON.replacer));

  const { error } = await supabase
    .from(TABLE)
    .upsert(
      {
        admin_id:     adminId,
        session_key:  key,
        session_data: serialized,
        updated_at:   new Date().toISOString(),
      },
      { onConflict: 'admin_id,session_key' }
    );

  if (error) throw new Error(`[SupabaseAuth] writeData(${key}): ${error.message}`);
}

/**
 * Remove um registro do Supabase.
 */
async function removeData(adminId, key) {
  await supabase
    .from(TABLE)
    .delete()
    .eq('admin_id', adminId)
    .eq('session_key', key);
}

// ─── API pública ───────────────────────────────────────────────────────────────

/**
 * Equivalente ao useMultiFileAuthState do Baileys, porém persiste no Supabase.
 *
 * @param {string} adminId - UUID do admin (usado como partição na tabela)
 * @returns {{ state: AuthenticationState, saveCreds: () => Promise<void> }}
 */
async function useSupabaseAuthState(adminId) {
  // Carrega ou inicializa as credenciais
  const creds = (await readData(adminId, 'creds')) || initAuthCreds();

  const state = {
    creds,

    keys: {
      /**
       * Busca chaves de sinal (pre-keys, sessions, etc.) pelo tipo e lista de IDs.
       */
      get: async (type, ids) => {
        const result = {};
        await Promise.all(
          ids.map(async id => {
            let value = await readData(adminId, `${type}-${id}`);
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            result[id] = value;
          })
        );
        return result;
      },

      /**
       * Persiste (ou remove) chaves de sinal.
       * data = { [type]: { [id]: value | null } }
       */
      set: async data => {
        const tasks = [];
        for (const type of Object.keys(data)) {
          for (const id of Object.keys(data[type])) {
            const value = data[type][id];
            const key   = `${type}-${id}`;
            if (value) {
              tasks.push(writeData(adminId, key, value));
            } else {
              tasks.push(removeData(adminId, key));
            }
          }
        }
        await Promise.all(tasks);
      },
    },
  };

  return {
    state,
    /** Chame após creds.update para persistir as credenciais atualizadas. */
    saveCreds: () => writeData(adminId, 'creds', state.creds),
  };
}

/**
 * Remove todas as chaves de autenticação de um admin do Supabase.
 * Chamado no logout ou ao destruir a sessão.
 */
async function clearAuthState(adminId) {
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq('admin_id', adminId);

  if (error) {
    console.error(`[SupabaseAuth] clearAuthState(${adminId}):`, error.message);
  }
}

/**
 * Retorna os adminIds que têm credenciais salvas no Supabase.
 * Usado na inicialização do servidor para restaurar sessões.
 */
async function listSavedAdminIds() {
  const { data, error } = await supabase
    .from(TABLE)
    .select('admin_id')
    .eq('session_key', 'creds');

  if (error || !data) return [];
  return [...new Set(data.map(r => r.admin_id))];
}

module.exports = { useSupabaseAuthState, clearAuthState, listSavedAdminIds };
