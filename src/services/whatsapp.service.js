'use strict';

/**
 * whatsapp.service.js
 *
 * Camada de serviço de baixo nível para envio de mensagens.
 * Encapsula o cliente Baileys e adiciona delay entre envios
 * para evitar bloqueio de conta pelo WhatsApp.
 */

const waClient = require('../whatsapp/client');

/** Intervalo mínimo entre mensagens consecutivas (ms). */
const DELAY_MS = 1_500;

/** Aguarda `ms` milissegundos. */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Envia uma mensagem de texto para um JID.
 * Retorna um objeto com o resultado do envio.
 *
 * @param {string}   jid      - JID do destinatário
 * @param {string}   texto    - Texto da mensagem
 * @param {string[]} mentions - JIDs mencionados no texto
 * @returns {Promise<{ ok: boolean, erro?: string }>}
 */
async function enviarMensagem(jid, texto, mentions = []) {
  if (!waClient.connected()) {
    return { ok: false, erro: 'WhatsApp não conectado.' };
  }

  try {
    await waClient.sendTextMessage(jid, texto, mentions);
    return { ok: true };
  } catch (err) {
    return { ok: false, erro: err.message };
  }
}

/**
 * Envia uma lista de mensagens com delay entre cada envio.
 *
 * @param {Array<{ jid: string, texto: string, mentions: string[] }>} mensagens
 * @returns {Promise<Array<{ jid: string, ok: boolean, erro?: string }>>}
 */
async function enviarLote(mensagens) {
  const resultados = [];

  for (const m of mensagens) {
    const resultado = await enviarMensagem(m.jid, m.texto, m.mentions);
    resultados.push({ jid: m.jid, ...resultado });
    if (resultado.ok) await sleep(DELAY_MS);
  }

  return resultados;
}

module.exports = { enviarMensagem, enviarLote };
