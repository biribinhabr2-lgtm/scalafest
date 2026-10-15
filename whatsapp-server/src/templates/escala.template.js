'use strict';

const DIAS_SEMANA = [
  'DOMINGO','SEGUNDA-FEIRA','TERÇA-FEIRA','QUARTA-FEIRA',
  'QUINTA-FEIRA','SEXTA-FEIRA','SÁBADO',
];

/** "2024-01-15" → "QUINTA-FEIRA — 15/01" */
function fmtDiaSemana(dataStr) {
  const [ano, mes, dia] = dataStr.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  const nomeDia = DIAS_SEMANA[d.getUTCDay()];
  return `${nomeDia} — ${String(dia).padStart(2,'0')}/${String(mes).padStart(2,'0')}`;
}

/** "HH:MM:SS" ou "HH:MM" → "HH:MM" */
function fmtHora(h) {
  if (!h) return '';
  const parts = String(h).split(':');
  return `${parts[0]}:${parts[1] || '00'}`;
}

/**
 * Calcula duração entre dois horários "HH:MM".
 * "09:00", "11:00" → "2h"   |   "09:30", "11:00" → "1h30"
 * Retorna string vazia se inválido ou duração ≤ 0.
 */
function calcDuracao(horaInicio, horaFim) {
  const hi = fmtHora(horaInicio);
  const hf = fmtHora(horaFim);
  if (!hi || !hf) return '';
  const [hI, mI] = hi.split(':').map(Number);
  const [hF, mF] = hf.split(':').map(Number);
  const total = (hF * 60 + mF) - (hI * 60 + mI);
  if (total <= 0) return '';
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h${m}`;
}

/** Remove tudo que não for dígito */
function limparTel(tel) {
  return tel ? tel.replace(/\D/g, '') : '';
}

/**
 * Normaliza número brasileiro para forma canônica: 55 + DDD(2) + 8 dígitos.
 * Trata números com e sem o 9° dígito como equivalentes.
 * Retorna null se não puder normalizar.
 */
function normalizarTelefone(tel) {
  if (!tel) return null;
  let d = String(tel).replace(/\D/g, '');
  if (!d) return null;

  if (!d.startsWith('55')) d = '55' + d;

  // 13 dígitos = 55 + DDD(2) + local(9) com 9° dígito → strip o 9
  if (d.length === 13) {
    const local = d.slice(4); // 9 dígitos do número local
    if (local[0] === '9') return d.slice(0, 4) + local.slice(1); // 12 dígitos canônicos
    return null; // 13 dígitos sem 9° dígito = inválido para celular BR
  }
  // 12 dígitos = 55 + DDD(2) + local(8) = já canônico
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

/** "5511999990000@s.whatsapp.net" → "5511999990000" */
function jidParaNumero(jid) {
  return jid.split('@')[0];
}

/** Compara dois horários "HH:MM" para ordenação. */
function cmpHorario(a, b) {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  return ah !== bh ? ah - bh : am - bm;
}

// ── Títulos de função ─────────────────────────────────────────────────────────

const PLURAL_MAP = {
  'Líder':        'Líderes',
  'Auxiliar':     'Auxiliares',
  'Personagem':   'Personagens',
  'Animador':     'Animadores',
  'Animadora':    'Animadoras',
  'Recreador':    'Recreadores',
  'Recreadora':   'Recreadoras',
  'Monitor':      'Monitores',
  'Monitora':     'Monitoras',
  'Coordenador':  'Coordenadores',
  'Coordenadora': 'Coordenadoras',
  'Assistente':   'Assistentes',
  'Fotógrafo':    'Fotógrafos',
  'Fotógrafa':    'Fotógrafas',
  'Maquiador':    'Maquiadores',
  'Maquiadora':   'Maquiadoras',
};

/** Título do grupo de função: plural quando count > 1. */
function tituloFuncao(fn, count) {
  if (count <= 1) return fn;
  return PLURAL_MAP[fn] || `${fn}s`;
}

// Funções com posição fixa (sempre listadas primeiro, nessa ordem)
const ORDEM_FIXA = ['Líder', 'Auxiliar', 'Personagem'];

/** Ordena nomes de função: primeiro as de ORDEM_FIXA, depois as demais em ordem alfabética. */
function sortFuncoes(funcoes) {
  return [...funcoes].sort((a, b) => {
    const pa = ORDEM_FIXA.indexOf(a);
    const pb = ORDEM_FIXA.indexOf(b);
    if (pa >= 0 && pb >= 0) return pa - pb;
    if (pa >= 0) return -1;
    if (pb >= 0) return  1;
    return a.localeCompare(b, 'pt-BR');
  });
}

// ── Builders ──────────────────────────────────────────────────────────────────

/**
 * Constrói a mensagem de escala diária para envio em grupo.
 *
 * Formato gerado (por evento, separados por ———):
 *
 *   *NOME DO EVENTO*
 *   09:00 às 11:00 · 2h
 *   _Local do evento_
 *   _Obs: observação do evento_
 *
 *   *Líder*
 *   @Nome Cadastro
 *
 *   *Personagens*
 *   @Nome A — Personagem X
 *   @Nome B — Personagem Y
 *
 * Regras:
 *   - Nome exibido: sempre do cadastro (fl.nome), nunca o nome do contato WA.
 *   - Menção (@): o texto usa "@<número>" (dígitos do JID, sem formatação) e o
 *     JID completo entra em `mentions` — os dois precisam casar para o WA notificar.
 *     Formato: "@5511987654321 — Ana Lima" ou "@5511987654321 — Camylle (Tristeza)"
 *   - Obs da alocação (m.obs): entre parênteses após o nome, sem itálico.
 *   - Obs do evento (ev.obs): no cabeçalho em itálico.
 *   - participantesMap === null → fallback: menciona todos com telefone.
 *
 * @param {string}   data
 * @param {Array}    eventos         - eventos do dia já filtrados
 * @param {Object}   flById          - { [id]: freelancer }
 * @param {string}   [templateCorpo]
 * @param {Map<string,string>|null} [participantesMap]  canonical → JID real
 * @returns {{ texto, mentions, foraDaGrupo, semTelefone }}
 */
function buildEscalaDiariaGrupo(data, eventos, flById, templateCorpo, participantesMap) {
  const ordenados = [...eventos].sort((a, b) =>
    cmpHorario(fmtHora(a.horaInicio) || '00:00', fmtHora(b.horaInicio) || '00:00')
  );

  const mentionsSet    = new Set();
  const blocosEvento   = [];
  const foraDaGrupoMap = new Map();
  const semTelefoneSet = new Set();

  for (const ev of ordenados) {
    const linhas = [];

    // ── Cabeçalho do evento ─────────────────────────────────────────────────
    linhas.push(`*${ev.nome}*`);

    if (ev.horaInicio && ev.horaFim) {
      const dur = calcDuracao(ev.horaInicio, ev.horaFim);
      linhas.push(`⏰ ${fmtHora(ev.horaInicio)} às ${fmtHora(ev.horaFim)}${dur ? ` · ${dur}` : ''}`);
    }

    if (ev.local) linhas.push(`📍 _${ev.local}_`);
    if (ev.obs)   linhas.push(`📝 _Obs: ${ev.obs}_`);

    // ── Grupos de função ────────────────────────────────────────────────────
    const equipe = ev.equipe ?? [];
    const mapaFn = {};
    for (const m of equipe) {
      const fn = m.funcao || 'Sem função';
      if (!mapaFn[fn]) mapaFn[fn] = [];
      mapaFn[fn].push(m);
    }

    for (const fn of sortFuncoes(Object.keys(mapaFn))) {
      const membrosOrdenados = [...mapaFn[fn]]
        .map(m => ({ m, fl: flById[String(m.freelancerId)] }))
        .filter(({ fl }) => fl)
        .sort((a, b) => (a.fl.nome || '').localeCompare(b.fl.nome || '', 'pt-BR'));

      if (!membrosOrdenados.length) continue;

      linhas.push('');
      linhas.push(`🎭 *${tituloFuncao(fn, membrosOrdenados.length)}*`);

      for (const { m, fl } of membrosOrdenados) {
        const flId     = String(fl.id ?? m.freelancerId);
        const nome     = fl.nome || `ID ${m.freelancerId}`;
        const obsStr   = m.obs ? ` — ${m.obs}` : '';
        const obsParen = m.obs ? ` (${m.obs})` : '';
        const telDigits = limparTel(fl.telefone);

        if (!telDigits) {
          linhas.push(`${nome}${obsStr}`);
          semTelefoneSet.add(nome);
          continue;
        }

        if (participantesMap === null) {
          // Fallback: menciona todos — @<número> no texto, JID completo no array
          const jid = telParaJid(fl.telefone);
          if (jid) {
            const num = jid.split('@')[0];
            linhas.push(`@${num} — ${nome}${obsParen}`);
            mentionsSet.add(jid);
          } else {
            linhas.push(`${nome}${obsStr}`);
          }
          continue;
        }

        const canonical  = normalizarTelefone(fl.telefone);
        const jidNoGrupo = canonical ? participantesMap.get(canonical) : null;

        if (jidNoGrupo) {
          // Participante do grupo → @<número> no texto, JID real no array de menções
          const num = jidNoGrupo.split('@')[0];
          linhas.push(`@${num} — ${nome}${obsParen}`);
          mentionsSet.add(jidNoGrupo);
        } else {
          // Fora do grupo → só nome, agenda envio individual
          linhas.push(`${nome}${obsStr}`);
          if (!foraDaGrupoMap.has(flId)) {
            foraDaGrupoMap.set(flId, { fl, eventosInfo: [] });
          }
          foraDaGrupoMap.get(flId).eventosInfo.push({ ev, funcao: m.funcao, obs: m.obs });
        }
      }
    }

    blocosEvento.push(linhas.join('\n'));
  }

  const blocos_eventos = blocosEvento.join('\n\n———\n\n');
  const corpo = templateCorpo || '📅 *{{data_extenso}}*\n\n{{blocos_eventos}}';
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
  calcDuracao,
  tituloFuncao,
  sortFuncoes,
  renderTemplate,
  telParaJid,
  limparTel,
};
