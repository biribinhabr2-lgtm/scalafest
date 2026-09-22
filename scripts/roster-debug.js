'use strict';

/**
 * Diagnóstico do motor de sugestão de escala.
 *
 * Mostra o funil completo para um evento:
 *   total freelancers → ativos → exercem a função → disponíveis na data
 *   → horário cobre → sem conflito → elegíveis
 *
 * Para cada eliminado: motivo exato.
 * Detecta divergências de case/acento entre funcao de service_roles e fl.funcoes.
 *
 * Usage:
 *   node scripts/roster-debug.js                          # auto-pick primeiro evento com serviços
 *   node scripts/roster-debug.js --event <uuid>           # evento específico
 *   node scripts/roster-debug.js --event <uuid> --admin <uuid>
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ybnqjvucyutpdjfpkgzg.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlibnFqdnVjeXV0cGRqZnBrZ3pnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjA5OTM3NywiZXhwIjoyMDkxNjc1Mzc3fQ.Ax1FV2Wgvn3txw3HP_1EG8ry4XMiSZ8xUM9gcQPcr2s';

const argIdx = (name) => process.argv.indexOf(name);
const argVal = (name) => {
  const i = argIdx(name);
  return i !== -1 ? process.argv[i + 1] : null;
};

const FORCE_EVENT_ID = argVal('--event');
const FORCE_ADMIN_ID = argVal('--admin');

// ── Supabase REST helpers ─────────────────────────────────────────────────────

const fetch = (...args) => {
  try {
    return globalThis.fetch(...args);
  } catch (_) {
    return import('node-fetch').then(m => m.default(...args));
  }
};

function hdr(prefer) {
  const h = {
    apikey:        SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (prefer) h.Prefer = prefer;
  return h;
}

async function q(path, params = {}) {
  const url = new URL(SUPABASE_URL + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), { headers: hdr() });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Normalização (para comparação tolerante) ──────────────────────────────────

function norm(s) {
  if (!s) return '';
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// ── Disponibilidade ───────────────────────────────────────────────────────────

function _fmtHora(hhmm) {
  if (!hhmm) return '?';
  const [h, m] = hhmm.split(':');
  const min = parseInt(m, 10);
  return min ? `${parseInt(h, 10)}h${String(min).padStart(2, '0')}` : `${parseInt(h, 10)}h`;
}

function checkDisp(flId, eventData, horaInicio, horaFim, disponibilidade) {
  const dayMap = disponibilidade[flId] || {};
  const val = dayMap[eventData];

  if (val == null) return { elegivel: true, motivo: null, label: 'sem registro (disponível)' };

  if (typeof val === 'string') {
    if (val === 'indisponivel') return { elegivel: false, motivo: 'Indisponível na data', label: null };
    return { elegivel: true, motivo: null, label: 'Disponível (string)' };
  }

  const status = val.status || 'parcial';
  if (status === 'indisponivel') return { elegivel: false, motivo: 'Indisponível na data', label: null };
  if (status === 'disponivel')   return { elegivel: true,  motivo: null, label: 'Disponível' };

  const tipo  = val.tipo  || 'obs';
  const hora  = val.hora  || null;
  const hora2 = val.hora2 || null;

  if (tipo === 'obs' || !hora) return { elegivel: true, motivo: null, label: 'Disponível (com obs)' };
  if (!horaInicio || !horaFim) return { elegivel: true, motivo: null, label: `Parcial ${tipo}/${hora}` };

  if (tipo === 'apos') {
    if (horaInicio >= hora) return { elegivel: true, motivo: null, label: `A partir de ${_fmtHora(hora)}` };
    return { elegivel: false, motivo: `Disponível só a partir de ${_fmtHora(hora)} (evento começa ${_fmtHora(horaInicio)})`, label: null };
  }
  if (tipo === 'antes') {
    if (horaFim <= hora) return { elegivel: true, motivo: null, label: `Até ${_fmtHora(hora)}` };
    return { elegivel: false, motivo: `Disponível só até ${_fmtHora(hora)} (evento termina ${_fmtHora(horaFim)})`, label: null };
  }
  if (tipo === 'entre') {
    const fim = hora2 || '23:59';
    if (horaInicio >= hora && horaFim <= fim) return { elegivel: true, motivo: null, label: `${_fmtHora(hora)}–${_fmtHora(fim)}` };
    return { elegivel: false, motivo: `Disponível ${_fmtHora(hora)}–${_fmtHora(fim)} (evento ${_fmtHora(horaInicio)}–${_fmtHora(horaFim)})`, label: null };
  }
  return { elegivel: true, motivo: null, label: 'Parcial (tipo desconhecido)' };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const SEP  = '─'.repeat(64);
  const SEP2 = '═'.repeat(64);

  console.log('\n' + SEP2);
  console.log('  ROSTER-DEBUG — Funil do motor de sugestão de escala');
  console.log(SEP2 + '\n');

  // 1. Encontrar evento ────────────────────────────────────────────────────────
  let eventId = FORCE_EVENT_ID;
  let adminId = FORCE_ADMIN_ID;

  if (!eventId) {
    // Auto-pick: primeiro evento com event_services
    const esRows = await q('/rest/v1/event_services', {
      select:  'event_id',
      limit:   1,
    });
    if (!esRows.length) {
      console.error('❌  Nenhum evento com event_services encontrado. Forneça --event <uuid>.');
      process.exit(1);
    }
    eventId = esRows[0].event_id;
    console.log(`(Auto-selecionou evento: ${eventId})\n`);
  }

  // 2. Carregar evento ─────────────────────────────────────────────────────────
  const [evRow] = await q('/rest/v1/events', {
    select:  'id,nome,data,hora_inicio,hora_fim,tenant_id',
    id:      `eq.${eventId}`,
    limit:   1,
  });

  if (!evRow) {
    console.error(`❌  Evento ${eventId} não encontrado.`);
    process.exit(1);
  }

  if (!adminId) adminId = evRow.tenant_id;

  const horaInicio = evRow.hora_inicio ? evRow.hora_inicio.slice(0, 5) : null;
  const horaFim    = evRow.hora_fim    ? evRow.hora_fim.slice(0, 5)    : null;

  console.log(`Evento:  "${evRow.nome || '(sem nome)'}"`);
  console.log(`ID:      ${evRow.id}`);
  console.log(`Data:    ${evRow.data}  ${horaInicio || '?'}–${horaFim || '?'}`);
  console.log(`Tenant:  ${adminId}\n`);

  // 3. Serviços do evento ───────────────────────────────────────────────────────
  console.log(SEP);
  console.log('SERVIÇOS DO EVENTO (event_services + service_roles)');
  console.log(SEP);

  const esRows = await q('/rest/v1/event_services', {
    select:   'service_id,nome_bruto',
    event_id: `eq.${eventId}`,
  });

  console.log(`\nevent_services: ${esRows.length} linha(s)`);
  if (esRows.length === 0) {
    console.log('  ⚠️  NENHUM SERVIÇO vinculado a este evento.');
    console.log('  → triagem_status pode não ser "confirmado", ou evento ainda não foi triado.');
  } else {
    for (const es of esRows) {
      console.log(`  service_id=${es.service_id}  nome_bruto="${es.nome_bruto}"`);
    }
  }

  const serviceIds = esRows.map(es => es.service_id).filter(Boolean);

  let requiredRoles = [];
  if (serviceIds.length > 0) {
    const srRows = await q('/rest/v1/service_roles', {
      select:     'service_id,funcao,quantidade,obrigatorio',
      service_id: `in.(${serviceIds.join(',')})`,
    });

    console.log(`\nservice_roles: ${srRows.length} linha(s)`);
    if (srRows.length === 0) {
      console.log('  ⚠️  NENHUMA VAGA configurada em service_roles para estes serviços.');
      console.log('  → Sem vagas = sem sugestão. Configure service_roles no painel de Serviços.');
    } else {
      for (const sr of srRows) {
        console.log(`  funcao="${sr.funcao}"  qtd=${sr.quantidade}  obrigatorio=${sr.obrigatorio}`);
      }
    }

    // Deduplicar roles (max quantidade por funcao)
    const byFuncao = {};
    for (const r of srRows) {
      if (!r.funcao) continue;
      if (!byFuncao[r.funcao]) byFuncao[r.funcao] = { funcao: r.funcao, quantidade: r.quantidade || 1 };
      else byFuncao[r.funcao].quantidade = Math.max(byFuncao[r.funcao].quantidade, r.quantidade || 1);
    }
    requiredRoles = Object.values(byFuncao);
  }

  if (requiredRoles.length === 0) {
    console.log('\n⛔  requiredRoles = [] → O motor não tem vagas para preencher → resultado sempre vazio.');
    console.log('    CAUSA PROVÁVEL: service_roles não configurado para os serviços deste evento.\n');
  } else {
    console.log(`\nrequeiredRoles após deduplicação: ${requiredRoles.map(r => `"${r.funcao}" ×${r.quantidade}`).join(', ')}`);
  }

  // 4. Freelancers ─────────────────────────────────────────────────────────────
  console.log('\n' + SEP);
  console.log('FREELANCERS (sf_dados tipo=freelancers)');
  console.log(SEP);

  const [flDados] = await q('/rest/v1/sf_dados', {
    select:  'dados',
    user_id: `eq.${adminId}`,
    tipo:    'eq.freelancers',
    limit:   1,
  });

  const freelancers = Array.isArray(flDados?.dados) ? flDados.dados : [];
  console.log(`\nTotal freelancers no blob: ${freelancers.length}`);

  const ativos = freelancers.filter(f => f.ativo !== false);
  const inativos = freelancers.filter(f => f.ativo === false);
  console.log(`  Ativos (ativo !== false): ${ativos.length}`);
  if (inativos.length) console.log(`  Inativos (ativo=false):   ${inativos.length}  [${inativos.map(f => f.nome).join(', ')}]`);

  // 5. Disponibilidade ─────────────────────────────────────────────────────────
  console.log('\n' + SEP);
  console.log('DISPONIBILIDADE');
  console.log(SEP);

  // Admin blob (para quem não tem userId)
  const [adminDispRow] = await q('/rest/v1/sf_dados', {
    select:  'dados',
    user_id: `eq.${adminId}`,
    tipo:    'eq.disponibilidade',
    limit:   1,
  });
  const adminDispBlob = adminDispRow?.dados || null;

  // Cloud blobs (para quem tem userId)
  const userIds = ativos.filter(f => f.userId).map(f => f.userId);
  let dispCloud = [];
  if (userIds.length > 0) {
    dispCloud = await q('/rest/v1/sf_dados', {
      select:  'user_id,dados',
      tipo:    'eq.disponibilidade',
      user_id: `in.(${userIds.join(',')})`,
    });
  }

  // Montar mapa final: flId → dayMap
  const userIdToFlId = {};
  ativos.filter(f => f.userId).forEach(f => { userIdToFlId[f.userId] = String(f.id); });

  const disponibilidade = {};
  for (const { user_id, dados } of dispCloud) {
    const flId = userIdToFlId[user_id];
    if (flId) disponibilidade[flId] = dados || {};
  }
  for (const fl of ativos.filter(f => !f.userId)) {
    const flId = String(fl.id);
    if (adminDispBlob && adminDispBlob[flId]) disponibilidade[flId] = adminDispBlob[flId];
  }

  const comDisp  = Object.keys(disponibilidade).length;
  const semDisp  = ativos.filter(f => !disponibilidade[String(f.id)]).length;
  console.log(`\nAtivos com registro de disponibilidade: ${comDisp}`);
  console.log(`Ativos SEM registro (tratados como disponíveis o dia todo): ${semDisp}`);

  if (evRow.data) {
    // Resumo de disponibilidade na data do evento
    let disps = 0, indisps = 0, parciais = 0;
    for (const fl of ativos) {
      const flId = String(fl.id);
      const dayMap = disponibilidade[flId] || {};
      const val = dayMap[evRow.data];
      if (!val) { disps++; continue; }
      if (typeof val === 'string') {
        if (val === 'indisponivel') indisps++;
        else disps++;
      } else {
        if ((val.status || 'parcial') === 'indisponivel') indisps++;
        else parciais++;
      }
    }
    console.log(`\nNa data ${evRow.data}:`);
    console.log(`  Disponíveis/sem registro: ${disps}`);
    console.log(`  Indisponíveis:            ${indisps}`);
    console.log(`  Parciais:                 ${parciais}`);
  }

  // 6. Conflitos (outros eventos no mesmo dia) ──────────────────────────────────
  let conflitos = new Set();
  if (evRow.data) {
    const eventsOnDay = await q('/rest/v1/events', {
      select:    'id,hora_inicio,hora_fim',
      tenant_id: `eq.${adminId}`,
      data:      `eq.${evRow.data}`,
      id:        `neq.${eventId}`,
    });
    const overlapping = eventsOnDay.filter(ev => {
      if (!horaInicio || !horaFim || !ev.hora_inicio || !ev.hora_fim) return true;
      const s = ev.hora_inicio.slice(0, 5);
      const e = ev.hora_fim.slice(0, 5);
      return horaInicio < e && horaFim > s;
    });
    if (overlapping.length > 0) {
      const ids = overlapping.map(ev => ev.id);
      const teamRows = await q('/rest/v1/event_team', {
        select:   'freelancer_id',
        event_id: `in.(${ids.join(',')})`,
      });
      conflitos = new Set(teamRows.map(r => String(r.freelancer_id)));
    }
    console.log(`\nOutros eventos no mesmo dia com sobreposição de horário: ${overlapping.length}`);
    if (conflitos.size) console.log(`Freelancers em conflito: ${conflitos.size}`);
  }

  // 7. Já escalados ──────────────────────────────────────────────────────────
  const equipeAtual = await q('/rest/v1/event_team', {
    select:   'freelancer_id',
    event_id: `eq.${eventId}`,
  });
  const jaEscalados = new Set(equipeAtual.map(r => String(r.freelancer_id)));
  if (jaEscalados.size) console.log(`Já escalados neste evento: ${jaEscalados.size}`);

  // 8. Funil por função ────────────────────────────────────────────────────────
  console.log('\n' + SEP2);
  console.log('FUNIL POR FUNÇÃO');
  console.log(SEP2);

  if (requiredRoles.length === 0) {
    console.log('\n(Sem funções requeridas — nada a mostrar)\n');
    console.log('⛔  DIAGNÓSTICO FINAL: service_roles vazio ou event_services vazio.');
    console.log('    O motor retorna vagas=[] sem tentar nenhum candidato.\n');
    return;
  }

  // Coleta todas as funcoes distintas nos freelancers para comparar case/acento
  const allFuncoesFreelancers = new Set();
  for (const fl of ativos) {
    for (const f of (fl.funcoes || [])) allFuncoesFreelancers.add(f);
  }

  for (const { funcao, quantidade } of requiredRoles) {
    console.log(`\n${SEP}`);
    console.log(`FUNÇÃO: "${funcao}"  (${quantidade} vaga(s))`);
    console.log(SEP);

    // Checar divergências de case/acento
    const normFuncao = norm(funcao);
    const similares = [...allFuncoesFreelancers].filter(f => norm(f) === normFuncao && f !== funcao);
    if (similares.length > 0) {
      console.log(`  ⚠️  DIVERGÊNCIA DE ESCRITA — service_roles tem "${funcao}" mas freelancers têm:`);
      for (const s of similares) console.log(`    "${s}"`);
      console.log('  → fl.funcoes.includes(funcao) falha por case/acento!');
    }

    // Funil
    const exercem    = ativos.filter(f => Array.isArray(f.funcoes) && f.funcoes.includes(funcao));
    const exercemTol = ativos.filter(f => Array.isArray(f.funcoes) && f.funcoes.some(ff => norm(ff) === normFuncao));

    console.log(`\n  Total freelancers:          ${freelancers.length}`);
    console.log(`  → Ativos:                   ${ativos.length}`);
    console.log(`  → Exercem a função (exact):  ${exercem.length}`);
    if (exercemTol.length !== exercem.length) {
      console.log(`  → Exercem a função (norm):   ${exercemTol.length}  ← diferença detectada!`);
    }

    if (exercem.length === 0) {
      console.log('\n  ⛔  ZERO freelancers exercem essa função (comparação exata).');
      if (exercemTol.length > 0) {
        console.log(`      Com normalização encontraria ${exercemTol.length}. Corrigir escrita ou normalizar comparação.`);
        console.log(`      Freelancers com funcao similar: ${exercemTol.map(f => `${f.nome} ("${f.funcoes.find(ff => norm(ff) === normFuncao)}")`).join(', ')}`);
      } else {
        console.log('      Mesmo com normalização, ninguém tem essa função.');
        console.log(`      Funções existentes nos freelancers: ${[...allFuncoesFreelancers].sort().join(' | ')}`);
      }
      continue;
    }

    // Filtros passo a passo
    const passouDisp     = [];
    const passouHorario  = [];
    const passouConflito = [];
    const passouEscalado = [];
    const eliminados     = [];

    for (const fl of exercem) {
      const flId = String(fl.id);

      if (jaEscalados.has(flId)) {
        eliminados.push({ fl, motivo: 'Já escalado neste evento' });
        continue;
      }

      const { elegivel, motivo: motivoDisp } = checkDisp(flId, evRow.data, horaInicio, horaFim, disponibilidade);

      if (!elegivel) {
        eliminados.push({ fl, motivo: motivoDisp });
        continue;
      }
      passouDisp.push(fl);

      if (conflitos.has(flId)) {
        eliminados.push({ fl, motivo: 'Conflito de horário com outro evento' });
        continue;
      }
      passouConflito.push(fl);
    }

    console.log(`  → Disponíveis na data/horário: ${passouDisp.length}`);
    console.log(`  → Sem conflito de horário:     ${passouConflito.length}  ← ELEGÍVEIS FINAIS`);

    if (passouConflito.length === 0) {
      console.log('\n  ⛔  Nenhum elegível para esta função.');
    } else {
      console.log('\n  ✅  Elegíveis (serão ranqueados):');
      for (const fl of passouConflito) {
        console.log(`    • ${fl.nome}  (id=${fl.id}, estrelas=${fl.estrelas ?? 'N/A'})`);
      }
    }

    if (eliminados.length > 0) {
      console.log('\n  ✖  Eliminados:');
      for (const { fl, motivo } of eliminados) {
        console.log(`    × ${fl.nome}  → ${motivo}`);
      }
    }
  }

  // 9. Resumo ─────────────────────────────────────────────────────────────────
  console.log('\n' + SEP2);
  console.log('RESUMO DIAGNÓSTICO');
  console.log(SEP2 + '\n');

  if (requiredRoles.length === 0) {
    console.log('⛔  CAUSA: service_roles vazio → motor devolve vagas=[] imediatamente.\n');
  } else {
    console.log(`Funções requeridas: ${requiredRoles.map(r => `"${r.funcao}" ×${r.quantidade}`).join(', ')}`);
    console.log(`Freelancers ativos: ${ativos.length}`);
    console.log('');
    console.log('Se algum funil zerou em "exercem a função", verifique service_roles vs fl.funcoes.');
    console.log('Se zerou em "disponíveis", verifique registros de disponibilidade na data.');
    console.log('Se zerou em "sem conflito", outro evento na mesma data tem os mesmos freelancers.\n');
  }
}

main().catch(e => { console.error('\n❌ Erro:', e.message || e); process.exit(1); });
