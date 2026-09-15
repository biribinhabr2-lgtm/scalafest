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
 * @param {string}   data          - "YYYY-MM-DD"
 * @param {Array}    eventos       - eventos do dia, já filtrados por data
 * @param {Object}   flById        - { [id]: freelancer } índice para lookup rápido
 * @param {string}   [templateCorpo] - corpo do template com {{data_extenso}} e {{blocos_eventos}}
 * @returns {{ texto: string, mentions: string[] }}
 */
function buildEscalaDiariaGrupo(data, eventos, flById, templateCorpo) {
  const ordenados = [...eventos].sort((a, b) =>
    cmpHorario(a.horaInicio || '00:00', b.horaInicio || '00:00')
  );

  const mentionsSet = new Set();
  const blocoLinhas = [];

  for (const ev of ordenados) {
    blocoLinhas.push('');
    blocoLinhas.push(`*${ev.nome}*`);
    if (ev.local)    blocoLinhas.push(`📍 ${ev.local}`);
    if (ev.horaInicio && ev.horaFim)
      blocoLinhas.push(`⏰ ${ev.horaInicio} — ${ev.horaFim}`);

    const equipe = ev.equipe ?? [];
    const membrosOrdenados = [...equipe]
      .map(m => ({ m, fl: flById[String(m.freelancerId)] }))
      .filter(({ fl }) => fl)
      .sort((a, b) => (a.fl.nome || '').localeCompare(b.fl.nome || '', 'pt-BR'));

    for (const { m, fl } of membrosOrdenados) {
      const jid = telParaJid(fl.telefone);
      if (jid) {
        const num = jidParaNumero(jid);
        blocoLinhas.push(`@${num} - ${m.funcao}`);
        mentionsSet.add(jid);
      } else {
        blocoLinhas.push(`${fl.nome} - ${m.funcao}`);
      }
    }
  }

  const blocos_eventos = blocoLinhas.join('\n').replace(/^\n/, '');
  const corpo = templateCorpo || '🗓️ {{data_extenso}}\n\n{{blocos_eventos}}';
  const texto = renderTemplate(corpo, {
    data_extenso:   fmtDiaSemana(data),
    blocos_eventos,
  });

  return { texto, mentions: [...mentionsSet] };
}

/**
 * Substitui {{variavel}} no corpo. Variável ausente → string vazia.
 * Exportada para reuso no frontend (via cópia) e em testes.
 */
function renderTemplate(corpo, vars) {
  return corpo.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in vars)) {
      console.warn(`[template] '${match}' não encontrada — deixando vazio`);
      return '';
    }
    return vars[key] == null ? '' : String(vars[key]);
  });
}

module.exports = { buildEscalaDiariaGrupo, renderTemplate, telParaJid, limparTel };
