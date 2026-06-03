'use strict';

/**
 * whatsapp.service.js
 *
 * Camada de serviço de baixo nível para envio de mensagens.
 * Usa o sessionManager para suporte multi-tenant.
 */

const sessionMgr = require('../whatsapp/sessionManager');

/** Intervalo mínimo entre mensagens consecutivas (ms) — evita banimento. */
const DELAY_MS = 1_500;

/** Aguarda `ms` milissegundos. */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Envia uma mensagem de texto para um JID usando a sessão do admin.
 *
 * @param {string}   adminId  - UUID do admin
 * @param {string}   jid      - JID do destinatário
 * @param {string}   texto    - Texto da mensagem
 * @param {string[]} mentions - JIDs mencionados no texto
 * @returns {Promise<{ ok: boolean, erro?: string }>}
 */
async function enviarMensagem(adminId, jid, texto, mentions = []) {
  const sess = sessionMgr.getSession(adminId);
  if (!sess?.connected) {
    return { ok: false, erro: 'WhatsApp não conectado.' };
  }

  try {
    await sessionMgr.sendMessage(adminId, jid, texto, mentions);
    return { ok: true };
  } catch (err) {
    return { ok: false, erro: err.message };
  }
}

/**
 * Envia uma lista de mensagens com delay entre cada envio.
 *
 * @param {string} adminId
 * @param {Array<{ jid: string, texto: string, mentions?: string[] }>} mensagens
 * @returns {Promise<Array<{ jid: string, ok: boolean, erro?: string }>>}
 */
async function enviarLote(adminId, mensagens) {
  const resultados = [];

  for (const m of mensagens) {
    const resultado = await enviarMensagem(adminId, m.jid, m.texto, m.mentions ?? []);
    resultados.push({ jid: m.jid, ...resultado });
    if (resultado.ok) await sleep(DELAY_MS);
  }

  return resultados;
}

module.exports = { enviarMensagem, enviarLote };
