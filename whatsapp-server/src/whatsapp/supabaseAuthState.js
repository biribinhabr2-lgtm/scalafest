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

async function readData(adminId, key) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('session_data')
    .eq('admin_id', adminId)
    .eq('session_key', key)
    .maybeSingle();

  if (error || !data) return null;

  try {
    return JSON.parse(JSON.stringify(data.session_data), BufferJSON.reviver);
  } catch {
    return null;
  }
}

async function writeData(adminId, key, value) {
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

async function removeData(adminId, key) {
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq('admin_id', adminId)
    .eq('session_key', key);

  if (error) {
    console.warn(`[SupabaseAuth][${adminId}] removeData(${key}): ${error.message}`);
  }
}

// ─── API pública ───────────────────────────────────────────────────────────────

/**
 * Equivalente ao useMultiFileAuthState do Baileys, porém persiste no Supabase.
 *
 * Diferenças em relação a uma implementação ingênua:
 * - Cache em memória por sessão: keys.set atualiza o cache antes de escrever
 *   no DB, garantindo que keys.get imediato não leia valor stale.
 * - null → undefined: quando uma chave não existe, result[id] não é definido
 *   (fica undefined), exatamente como useMultiFileAuthState. Retornar null
 *   quebra checks internos do Baileys para tipos específicos.
 * - app-state-sync-key não é cacheado (objetos proto têm formato ambíguo entre
 *   o que keys.set recebe e o que keys.get deve retornar).
 * - Erros em keys.set são logados e propagados — falha silenciosa faz o
 *   ratchet Signal avançar em memória sem persistir, corrompendo sessões futuras.
 *
 * @param {string} adminId - UUID do admin (usado como partição na tabela)
 * @returns {{ state: AuthenticationState, saveCreds: () => Promise<void> }}
 */
async function useSupabaseAuthState(adminId) {
  const creds = (await readData(adminId, 'creds')) || initAuthCreds();

  // Cache em memória por instância de sessão.
  // Armazena o valor bruto (formato DB), não o objeto proto.
  // app-state-sync-key é excluído por ter formato ambíguo entre set e get.
  const keyCache = new Map();

  const state = {
    creds,

    keys: {
      get: async (type, ids) => {
        const result = {};
        const useCache = type !== 'app-state-sync-key';

        await Promise.all(
          ids.map(async id => {
            const storeKey = `${type}-${id}`;
            let value;

            if (useCache && keyCache.has(storeKey)) {
              value = keyCache.get(storeKey);
            } else {
              value = await readData(adminId, storeKey);
              if (useCache && value !== null) {
                keyCache.set(storeKey, value);
              }
            }

            // Baileys espera undefined para chaves ausentes, não null.
            // Definir result[id] = null quebra checks internos (ex: session lookup).
            if (value == null) return;

            result[id] = type === 'app-state-sync-key'
              ? proto.Message.AppStateSyncKeyData.fromObject(value)
              : value;
          })
        );
        return result;
      },

      set: async data => {
        const tasks = [];
        const useCache = true;

        for (const type of Object.keys(data)) {
          for (const id of Object.keys(data[type])) {
            const value = data[type][id];
            const storeKey = `${type}-${id}`;
            const cacheType = type !== 'app-state-sync-key';

            if (value) {
              if (useCache && cacheType) keyCache.set(storeKey, value);
              tasks.push(writeData(adminId, storeKey, value));
            } else {
              if (useCache) keyCache.delete(storeKey);
              tasks.push(removeData(adminId, storeKey));
            }
          }
        }

        try {
          await Promise.all(tasks);
        } catch (err) {
          // Falha ao persistir chaves Signal — crítico: ratchet avançou em
          // memória mas não foi salvo. Próxima sessão usará estado errado.
          console.error(
            `[SupabaseAuth][${adminId}] ERRO CRÍTICO ao salvar chaves Signal: ${err.message}`
          );
          throw err;
        }
      },
    },
  };

  return {
    state,
    saveCreds: () =>
      writeData(adminId, 'creds', state.creds).catch(err => {
        console.error(`[SupabaseAuth][${adminId}] ERRO ao salvar credenciais: ${err.message}`);
        throw err;
      }),
  };
}

/**
 * Remove todas as chaves de autenticação de um admin do Supabase.
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
