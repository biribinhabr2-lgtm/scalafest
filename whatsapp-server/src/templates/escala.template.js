'use strict';

const DIAS_SEMANA = [
  'DOMINGO','SEGUNDA-FEIRA','TERÇA-FEIRA','QUARTA-FEIRA',
  'QUINTA-FEIRA','SEXTA-FEIRA','SÁBADO',
];

/** "2024-01-15" → "QUINTA-FEIRA (15/01)" */
function fmtDiaSemana(dataStr) {
  const [ano, mes, dia] = dataStr.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  const nomeDia = DIAS_SEMANA[d.getUTCDay()];
  return `${nomeDia} (${String(dia).padStart(2,'0')}/${String(mes).padStart(2,'0')})`;
}

/** "HH:MM:SS" ou "HH:MM" → "HH:MM" */
function fmtHora(h) {
  if (!h) return '';
  const parts = String(h).split(':');
  return `${parts[0]}:${parts[1] || '00'}`;
}

/** Remove tudo que não for dígito */
function limparTel(tel) {
  return tel ? tel.replace(/\D/g, '') : '';
}

/**
 * Normaliza número brasileiro para forma canônica: 55 + DDD(2) + 8 dígitos.
 *
 * Trata números com e sem o 9° dígito como equivalentes:
 *   "11987654321"   → "551187654321"
 *   "1187654321"    → "551187654321"
 *   "5511987654321" → "551187654321"
 *
 * Isso permite comparar o telefone cadastrado (pode ser formato antigo) com
 * o JID retornado pelo WhatsApp (sempre inclui o 9° dígito para celulares BR).
 *
 * Retorna null se não puder normalizar.
 */
function normalizarTelefone(tel) {
  if (!tel) return null;
  let d = String(tel).replace(/\D/g, '');
  if (!d) return null;

  // Garante código de país 55
  if (!d.startsWith('55')) d = '55' + d;

  // 55 + DDD(2) + 9 dígitos = 13 chars → contém 9° dígito
  if (d.length === 13) {
    const afterDDD = d.slice(4); // 9 chars
    if (afterDDD[0] === '9') {
      return d.slice(0, 4) + afterDDD.slice(1); // remove 9° → 12 chars
    }
    return d.slice(0, 12); // edge: não começa com 9, trunca
  }

  // 55 + DDD(2) + 8 dígitos = 12 chars → já canônico
  if (d.length === 12) return d;

  return null;
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

/** Compara dois horários "HH:MM" para ordenação. */
function cmpHorario(a, b) {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  return ah !== bh ? ah - bh : am - bm;
}

/**
 * Constrói a mensagem de escala diária para envio em grupo.
 *
 * @param {string}   data            - "YYYY-MM-DD"
 * @param {Array}    eventos         - eventos do dia, já filtrados por data
 * @param {Object}   flById          - { [id]: freelancer } índice para lookup rápido
 * @param {string}   [templateCorpo] - corpo do template com {{data_extenso}} e {{blocos_eventos}}
 * @param {Map<string,string>|null} [participantesMap]
 *   Map de número canônico → JID real do grupo (@s.whatsapp.net).
 *   null = falha ao buscar participantes → fallback: menciona todos que têm telefone.
 *   Map vazio = grupo sem participantes resolvidos → ninguém é mencionado.
 * @returns {{
 *   texto: string,
 *   mentions: string[],
 *   foraDaGrupo: Array<{ fl: Object, eventosInfo: Array<{ ev, funcao, obs }> }>,
 *   semTelefone: string[]
 * }}
 */
function buildEscalaDiariaGrupo(data, eventos, flById, templateCorpo, participantesMap) {
  const ordenados = [...eventos].sort((a, b) =>
    cmpHorario(fmtHora(a.horaInicio) || '00:00', fmtHora(b.horaInicio) || '00:00')
  );

  const mentionsSet    = new Set();
  const blocoLinhas    = [];
  const foraDaGrupoMap = new Map(); // flId → { fl, eventosInfo: [] }
  const semTelefoneSet = new Set();

  for (const ev of ordenados) {
    blocoLinhas.push('');
    blocoLinhas.push(`*${ev.nome}*`);
    if (ev.local) blocoLinhas.push(`📍 ${ev.local}`);
    if (ev.horaInicio && ev.horaFim)
      blocoLinhas.push(`⏰ ${fmtHora(ev.horaInicio)} — ${fmtHora(ev.horaFim)}`);
    if (ev.obs) blocoLinhas.push(`📋 ${ev.obs}`);

    const equipe = ev.equipe ?? [];

    const mapaFn = {};
    for (const m of equipe) {
      const fn = m.funcao || 'Sem função';
      if (!mapaFn[fn]) mapaFn[fn] = [];
      mapaFn[fn].push(m);
    }
    const funcoes   = Object.keys(mapaFn).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const temGrupos = funcoes.length > 1;

    for (const fn of funcoes) {
      if (temGrupos) blocoLinhas.push(`_${fn}_`);

      const membrosOrdenados = [...mapaFn[fn]]
        .map(m => ({ m, fl: flById[String(m.freelancerId)] }))
        .filter(({ fl }) => fl)
        .sort((a, b) => (a.fl.nome || '').localeCompare(b.fl.nome || '', 'pt-BR'));

      for (const { m, fl } of membrosOrdenados) {
        const funcaoObs = m.obs ? `${m.funcao} _(${m.obs})_` : m.funcao;
        const flId      = String(fl.id ?? m.freelancerId);
        const telDigits = limparTel(fl.telefone);

        if (!telDigits) {
          // Sem telefone cadastrado → só nome
          blocoLinhas.push(`${fl.nome} - ${funcaoObs}`);
          semTelefoneSet.add(fl.nome);
          continue;
        }

        if (participantesMap === null) {
          // Fallback: não foi possível buscar participantes → menciona normalmente
          const jid = telParaJid(fl.telefone);
          if (jid) {
            blocoLinhas.push(`@${jidParaNumero(jid)} - ${funcaoObs}`);
            mentionsSet.add(jid);
          } else {
            blocoLinhas.push(`${fl.nome} - ${funcaoObs}`);
          }
          continue;
        }

        // Verifica se está no grupo pelo número canônico
        const canonical  = normalizarTelefone(fl.telefone);
        const jidNoGrupo = canonical ? participantesMap.get(canonical) : null;

        if (jidNoGrupo) {
          // Participante do grupo → menção normal com o JID real do WA
          blocoLinhas.push(`@${jidParaNumero(jidNoGrupo)} - ${funcaoObs}`);
          mentionsSet.add(jidNoGrupo);
        } else {
          // Não está no grupo → só nome, agenda envio individual
          blocoLinhas.push(`${fl.nome} - ${funcaoObs}`);
          if (!foraDaGrupoMap.has(flId)) {
            foraDaGrupoMap.set(flId, { fl, eventosInfo: [] });
          }
          foraDaGrupoMap.get(flId).eventosInfo.push({ ev, funcao: m.funcao, obs: m.obs });
        }
      }
    }
  }

  const blocos_eventos = blocoLinhas.join('\n').replace(/^\n/, '');
  const corpo = templateCorpo || '🗓️ {{data_extenso}}\n\n{{blocos_eventos}}';
  const texto = renderTemplate(corpo, {
    data_extenso: fmtDiaSemana(data),
    blocos_eventos,
  });

  return {
    texto,
    mentions:    [...mentionsSet],
    foraDaGrupo: [...foraDaGrupoMap.values()],
    semTelefone: [...semTelefoneSet],
  };
}

/**
 * Constrói a mensagem individual para um freelancer que não está no grupo.
 *
 * @param {string} data         - "YYYY-MM-DD"
 * @param {Object} fl           - objeto freelancer
 * @param {Array}  eventosInfo  - [{ ev, funcao, obs }] eventos desse freelancer no dia
 * @param {string} [templateCorpo]
 * @returns {string}
 */
function buildEscalaIndividual(data, fl, eventosInfo, templateCorpo) {
  const linhas = [];
  for (const { ev, funcao, obs } of eventosInfo) {
    linhas.push(`*${ev.nome}*`);
    if (ev.local) linhas.push(`📍 ${ev.local}`);
    if (ev.horaInicio && ev.horaFim)
      linhas.push(`⏰ ${fmtHora(ev.horaInicio)} — ${fmtHora(ev.horaFim)}`);
    const funcaoObs = obs ? `${funcao} _(${obs})_` : funcao;
    linhas.push(`🎭 ${funcaoObs}`);
    linhas.push('');
  }
  const blocos_eventos = linhas.join('\n').trimEnd();
  const corpo = templateCorpo || [
    'Olá, *{{nome}}*! 👋',
    '',
    'Você está escalado(a) para {{data_extenso}}:',
    '',
    '{{blocos_eventos}}',
    '',
    'Qualquer dúvida, é só chamar! 😊',
  ].join('\n');
  return renderTemplate(corpo, { nome: fl.nome, data_extenso: fmtDiaSemana(data), blocos_eventos });
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

module.exports = {
  buildEscalaDiariaGrupo,
  buildEscalaIndividual,
  normalizarTelefone,
  renderTemplate,
  telParaJid,
  limparTel,
};
