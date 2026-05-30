'use strict';

const DIAS_SEMANA = [
  'DOMINGO','SEGUNDA-FEIRA','TERÇA-FEIRA','QUARTA-FEIRA',
  'QUINTA-FEIRA','SEXTA-FEIRA','SÁBADO',
];

/** "2024-01-15" → "QUINTA-FEIRA (15/01)" */
function fmtDiaSemana(dataStr) {
  const [ano, mes, dia] = dataStr.split('-').map(Number);
  // Usa UTC para evitar problema de fuso horário
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  const nomeDia = DIAS_SEMANA[d.getUTCDay()];
  return `${nomeDia} (${String(dia).padStart(2,'0')}/${String(mes).padStart(2,'0')})`;
}

/** Remove tudo que não for dígito */
function limparTel(tel) {
  return tel ? tel.replace(/\D/g, '') : '';
}

/**
 * Converte telefone brasileiro para JID do WhatsApp.
 * "(11) 99999-0000" → "5511999990000@s.whatsapp.net"
 */
function telParaJid(tel) {
  const digits = limparTel(tel);
  if (!digits) return null;
  const com55 = digits.startsWith('55') ? digits : `55${digits}`;
  return `${com55}@s.whatsapp.net`;
}

/** Extrai só o número do JID: "5511999990000@s.whatsapp.net" → "5511999990000" */
function jidParaNumero(jid) {
  return jid.split('@')[0];
}

/**
 * Compara dois horários "HH:MM" para ordenação.
 */
function cmpHorario(a, b) {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  return ah !== bh ? ah - bh : am - bm;
}

/**
 * Constrói a mensagem de escala diária para envio em grupo.
 *
 * @param {string}   data        - "YYYY-MM-DD"
 * @param {Array}    eventos     - eventos do dia, já filtrados por data
 * @param {Object}   flById      - { [id]: freelancer } índice para lookup rápido
 * @returns {{ texto: string, mentions: string[] }}
 */
function buildEscalaDiariaGrupo(data, eventos, flById) {
  // Ordena eventos do mais cedo para o mais tarde
  const ordenados = [...eventos].sort((a, b) =>
    cmpHorario(a.horaInicio || '00:00', b.horaInicio || '00:00')
  );

  const mentionsSet = new Set(); // JIDs únicos para @menção
  const linhas = [`🗓️ ${fmtDiaSemana(data)}`];

  for (const ev of ordenados) {
    linhas.push('');
    linhas.push(`*${ev.nome}*`);
    if (ev.local)    linhas.push(`📍 ${ev.local}`);
    if (ev.horaInicio && ev.horaFim)
      linhas.push(`⏰ ${ev.horaInicio} — ${ev.horaFim}`);

    const equipe = ev.equipe ?? [];
    // Ordena os membros do evento por nome
    const membrosOrdenados = [...equipe]
      .map(m => ({ m, fl: flById[String(m.freelancerId)] }))
      .filter(({ fl }) => fl) // ignora freelancers removidos
      .sort((a, b) => (a.fl.nome || '').localeCompare(b.fl.nome || '', 'pt-BR'));

    for (const { m, fl } of membrosOrdenados) {
      const jid = telParaJid(fl.telefone);
      if (jid) {
        const num = jidParaNumero(jid);
        linhas.push(`@${num} - ${m.funcao}`);
        mentionsSet.add(jid);
      } else {
        // Sem telefone — lista sem @menção
        linhas.push(`${fl.nome} - ${m.funcao}`);
      }
    }
  }

  return {
    texto: linhas.join('\n'),
    mentions: [...mentionsSet],
  };
}

module.exports = { buildEscalaDiariaGrupo, telParaJid, limparTel };
