#!/usr/bin/env node
/**
 * migrate-eventos.js
 *
 * Migra eventos do blob JSON em sf_dados (tipo='eventos') para as tabelas
 * relacionais `events` + `event_team`.
 *
 * Uso — dry-run (padrão, não grava nada):
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_KEY=eyJ... \
 *   node migrate-eventos.js
 *
 * Gravar de verdade:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node migrate-eventos.js --apply
 *
 * A linha original de sf_dados NÃO é alterada nem apagada.
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { randomUUID }   = require('crypto');

// ─── Configuração ────────────────────────────────────────────────────────────

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DRY_RUN              = !process.argv.includes('--apply');

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    '\nERRO: variáveis de ambiente ausentes.\n' +
    '  SUPABASE_URL e SUPABASE_SERVICE_KEY precisam estar definidas.\n' +
    '\nExemplo:\n' +
    '  SUPABASE_URL=https://xxx.supabase.co \\\n' +
    '  SUPABASE_SERVICE_KEY=eyJ... \\\n' +
    '  node migrate-eventos.js\n',
  );
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Constantes ──────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_TIPOS = new Set([
  'Aniversário Infantil',
  'Aniversário Adulto',
  'Corporativo',
  'Escolar',
  'Casamento',
  'Formatura',
  'Outro',
]);

const VALID_STATUS = new Set(['Confirmado', 'Em negociação', 'Cancelado']);

// Campos que têm coluna própria em `events` (não vão para dados_extras)
const MAPPED_EVENT_FIELDS = new Set([
  'id', 'nome', 'tipo', 'data', 'horaInicio', 'horaFim', 'local',
  'obs', 'status', 'updatedAt', 'google_event_id', 'recuperado', 'equipe',
  // estes dois têm tratamento especial mas são "conhecidos"
  'google_calendar_synced', 'google_calendar_id',
]);

// Campos que têm coluna própria em `event_team`
const MAPPED_TEAM_FIELDS = new Set([
  'freelancerId', 'funcao', 'cache', 'obs', 'pago',
  'turnos', 'bonusMultTurnos', 'bonus',
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isUuid(val) {
  return typeof val === 'string' && UUID_RE.test(val);
}

function toTime(str) {
  if (!str || typeof str !== 'string') return null;
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(str.trim()) ? str.trim() : null;
}

function toDate(str) {
  if (!str || typeof str !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(str.trim()) ? str.trim() : null;
}

function clamp(val, min, max) {
  const n = Number(val);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
}

// ─── Mapeamento: evento JSON → linha de `events` ─────────────────────────────

function mapEvent(raw, tenantId) {
  const rawId   = raw.id != null ? String(raw.id) : null;
  const isLegacy = !isUuid(rawId);
  const eventId  = isLegacy ? randomUUID() : rawId;
  const legacyId = isLegacy ? rawId : null;

  const date   = toDate(raw.data);
  const status = VALID_STATUS.has(raw.status) ? raw.status : null;
  const tipo   = VALID_TIPOS.has(raw.tipo)   ? raw.tipo   : null;

  // Dados extras: campos conhecidos com tratamento especial + campos desconhecidos
  const extras = {};
  if (raw.google_calendar_synced != null) extras.google_calendar_synced = raw.google_calendar_synced;
  if (raw.google_calendar_id     != null) extras.google_calendar_id     = raw.google_calendar_id;

  const unknownFields = [];
  for (const key of Object.keys(raw)) {
    if (!MAPPED_EVENT_FIELDS.has(key)) {
      extras[key]  = raw[key];
      unknownFields.push(key);
    }
  }

  const issues = [];
  if (!date)         issues.push('data_vazia_ou_invalida');
  if (!raw.nome)     issues.push('nome_vazio');
  if (!status)       issues.push(`status_desconhecido:${JSON.stringify(raw.status)}`);
  if (tipo === null && raw.tipo) issues.push(`tipo_desconhecido:${JSON.stringify(raw.tipo)}`);

  const eventRow = {
    id:               eventId,
    tenant_id:        tenantId,
    ...(legacyId ? { legacy_id: legacyId } : {}),
    nome:             raw.nome || '(sem nome)',
    tipo:             tipo,
    data:             date || '1970-01-01',   // placeholder; evento marcado como inválido
    hora_inicio:      toTime(raw.horaInicio),
    hora_fim:         toTime(raw.horaFim),
    local:            raw.local   || null,
    obs:              raw.obs     || null,
    status:           status      || 'Confirmado',
    google_event_id:  raw.google_event_id || null,
    dados_extras:     Object.keys(extras).length > 0 ? extras : null,
    recuperado:       !!raw.recuperado,
    ...(raw.updatedAt ? { updated_at: raw.updatedAt } : {}),
  };

  const teamRows = (Array.isArray(raw.equipe) ? raw.equipe : [])
    .map(m => mapTeamMember(m, eventId));

  return { eventRow, eventId, legacyId, isLegacy, teamRows, unknownFields, issues, rawId };
}

// ─── Mapeamento: membro JSON → linha de `event_team` ─────────────────────────

function mapTeamMember(m, eventId) {
  const bonus = m.bonus && typeof m.bonus === 'object' ? m.bonus : null;

  const extras = {};
  const unknownFields = [];
  for (const key of Object.keys(m)) {
    if (!MAPPED_TEAM_FIELDS.has(key)) {
      extras[key] = m[key];
      unknownFields.push(key);
    }
  }

  const row = {
    event_id:         eventId,
    freelancer_id:    m.freelancerId != null ? String(m.freelancerId) : 'UNKNOWN',
    funcao:           m.funcao  || null,
    cache:            m.cache   != null ? Number(m.cache)   : null,
    obs:              m.obs     || null,
    pago:             !!m.pago,
    turnos:           m.turnos  != null ? clamp(m.turnos, 1, 10) : 1,
    bonus_nivel:      bonus?.nivel || null,
    bonus_ativo:      !!(bonus?.ativo),
    bonus_mult_turnos: !!m.bonusMultTurnos,
    dados_extras:     Object.keys(extras).length > 0 ? extras : null,
  };

  return { row, unknownFields };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const mode = DRY_RUN ? 'DRY-RUN' : 'APPLY';
  console.log(`\n${'═'.repeat(62)}`);
  console.log(`  migrate-eventos.js  [${mode}]`);
  console.log(`  ${new Date().toISOString()}`);
  console.log(`${'═'.repeat(62)}\n`);

  // 1. Ler todos os tenants com eventos em sf_dados
  const { data: sfRows, error: sfErr } = await sb
    .from('sf_dados')
    .select('user_id, dados')
    .eq('tipo', 'eventos');

  if (sfErr) {
    console.error('ERRO ao ler sf_dados:', sfErr.message);
    process.exit(1);
  }

  if (sfRows.length === 0) {
    console.log('Nenhuma linha encontrada em sf_dados com tipo=\'eventos\'.');
    return;
  }

  console.log(`Tenants encontrados: ${sfRows.length}\n`);

  // 2. Parsear e mapear
  const tenantResults = [];

  // Acumula para o resumo global
  const globalSummary = {
    totalEvents:      0,
    legacyCount:      0,
    totalTeam:        0,
    allUnknownFields: new Set(),
    allInvalid:       [],
  };

  for (const sfRow of sfRows) {
    const tenantId = sfRow.user_id;
    let rawEvents;

    try {
      rawEvents = Array.isArray(sfRow.dados)
        ? sfRow.dados
        : JSON.parse(sfRow.dados);
      if (!Array.isArray(rawEvents)) throw new Error('dados não é um array');
    } catch (e) {
      console.warn(`  [AVISO] tenant=${tenantId}: falha ao parsear dados — ${e.message}`);
      tenantResults.push({ tenantId, mapped: [], sourceCount: 0, parseError: e.message });
      continue;
    }

    const mapped = rawEvents.map(ev => mapEvent(ev, tenantId));

    const legacyCount    = mapped.filter(m => m.isLegacy).length;
    const teamTotal      = mapped.reduce((s, m) => s + m.teamRows.length, 0);
    const invalidEvents  = mapped.filter(m => m.issues.length > 0);
    const unknownFields  = [...new Set(mapped.flatMap(m => m.unknownFields))];

    for (const f of unknownFields) globalSummary.allUnknownFields.add(f);
    globalSummary.totalEvents += mapped.length;
    globalSummary.legacyCount += legacyCount;
    globalSummary.totalTeam   += teamTotal;
    globalSummary.allInvalid.push(...invalidEvents.map(m => ({
      tenantId, rawId: m.rawId, issues: m.issues,
    })));

    tenantResults.push({ tenantId, mapped, sourceCount: rawEvents.length });

    // Relatório por tenant
    console.log(`  Tenant: ${tenantId}`);
    console.log(`    Eventos:        ${mapped.length} (${legacyCount} com legacy_id)`);
    console.log(`    Membros equipe: ${teamTotal}`);
    if (invalidEvents.length > 0) {
      console.log(`    ⚠ Inválidos:   ${invalidEvents.length}`);
      for (const iv of invalidEvents) {
        console.log(`      id=${iv.rawId ?? '(null)'} → ${iv.issues.join(', ')}`);
      }
    }
    if (unknownFields.length > 0) {
      console.log(`    Campos extras:  ${unknownFields.join(', ')}`);
    }
    console.log();
  }

  // 3. Resumo global
  console.log('─'.repeat(62));
  console.log('RESUMO GLOBAL');
  console.log('─'.repeat(62));
  console.log(`  Tenants:        ${tenantResults.filter(r => !r.parseError).length}`);
  console.log(`  Eventos:        ${globalSummary.totalEvents}`);
  console.log(`  Com legacy_id:  ${globalSummary.legacyCount}`);
  console.log(`  Membros equipe: ${globalSummary.totalTeam}`);
  if (globalSummary.allUnknownFields.size > 0) {
    console.log(`  Campos extras:  ${[...globalSummary.allUnknownFields].join(', ')}`);
  } else {
    console.log('  Campos extras:  nenhum');
  }
  if (globalSummary.allInvalid.length > 0) {
    console.log(`  ⚠ Inválidos:   ${globalSummary.allInvalid.length} evento(s):`);
    for (const iv of globalSummary.allInvalid) {
      console.log(`    tenant=${iv.tenantId}  id=${iv.rawId ?? '(null)'}  → ${iv.issues.join(', ')}`);
    }
  } else {
    console.log('  Eventos inválidos: nenhum ✓');
  }

  if (DRY_RUN) {
    console.log(
      '\n[DRY-RUN] Nenhum dado foi gravado.\n' +
      'Rode com --apply para persistir:\n\n' +
      '  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node migrate-eventos.js --apply\n',
    );
    return;
  }

  // 4. Gravar ──────────────────────────────────────────────────────────────────
  console.log('\n\n─'.repeat(62));
  console.log('[APPLY] Gravando...\n');

  let totalEventsWritten = 0;
  let totalTeamWritten   = 0;
  let totalErrors        = 0;

  for (const { tenantId, mapped, sourceCount, parseError } of tenantResults) {
    if (parseError) {
      console.warn(`  [SKIP] tenant=${tenantId}: erro de parse anterior — pulando`);
      continue;
    }

    let eventsWritten = 0;
    let teamWritten   = 0;
    let errors        = 0;

    for (const { eventRow, eventId, legacyId, isLegacy, teamRows } of mapped) {

      // ── Upsert do evento ────────────────────────────────────────────────────
      // Para eventos legados usamos onConflict:'legacy_id', que garante
      // idempotência mesmo que o UUID gerado localmente difira do que já está
      // no banco de uma execução anterior.
      const conflictCol = isLegacy ? 'legacy_id' : 'id';

      const { data: upsertedEvent, error: evErr } = await sb
        .from('events')
        .upsert(eventRow, { onConflict: conflictCol, ignoreDuplicates: false })
        .select('id')
        .maybeSingle();

      if (evErr) {
        console.error(
          `  [ERRO] evento rawId=${eventRow.legacy_id ?? eventRow.id}: ${evErr.message}`,
        );
        errors++;
        continue;
      }

      // UUID real no banco (pode diferir do gerado localmente para legados)
      const finalEventId = upsertedEvent?.id ?? eventId;

      eventsWritten++;

      // ── Idempotência do event_team: apaga e reinserere ──────────────────────
      // Escopo restrito ao event_id → seguro rodar duas vezes.
      const { error: delErr } = await sb
        .from('event_team')
        .delete()
        .eq('event_id', finalEventId);

      if (delErr) {
        console.error(
          `  [ERRO] delete event_team event_id=${finalEventId}: ${delErr.message}`,
        );
        errors++;
        continue;
      }

      if (teamRows.length > 0) {
        // Corrige o event_id caso o UUID gerado localmente tenha sido descartado
        const rowsWithCorrectId = teamRows.map(t => ({
          ...t.row,
          event_id: finalEventId,
        }));

        const { error: teamErr } = await sb
          .from('event_team')
          .insert(rowsWithCorrectId);

        if (teamErr) {
          console.error(
            `  [ERRO] insert event_team event_id=${finalEventId}: ${teamErr.message}`,
          );
          errors++;
        } else {
          teamWritten += teamRows.length;
        }
      }
    }

    totalEventsWritten += eventsWritten;
    totalTeamWritten   += teamWritten;
    totalErrors        += errors;

    const status = errors > 0 ? `⚠ ${errors} erro(s)` : '✓';
    console.log(
      `  ${status}  tenant=${tenantId}` +
      `  eventos=${eventsWritten}/${sourceCount}` +
      `  equipe=${teamWritten}`,
    );
  }

  console.log(
    `\n  Total gravado: ${totalEventsWritten} eventos, ${totalTeamWritten} membros` +
    (totalErrors > 0 ? `, ⚠ ${totalErrors} erro(s)` : ' ✓'),
  );

  // 5. Verificação de contagem ─────────────────────────────────────────────────
  console.log('\n\n─'.repeat(62));
  console.log('[VERIFICAÇÃO]\n');

  let allOk = true;

  for (const { tenantId, mapped, sourceCount, parseError } of tenantResults) {
    if (parseError) continue;

    const expectedEvents = sourceCount;
    const expectedTeam   = mapped.reduce((s, m) => s + m.teamRows.length, 0);

    // Contar eventos no banco para este tenant
    const { count: dbEvents, error: e1 } = await sb
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    if (e1) {
      console.error(`  [ERRO] count events tenant=${tenantId}: ${e1.message}`);
      allOk = false;
      continue;
    }

    // Buscar IDs dos eventos migrados (para contar membros de equipe)
    const { data: evIds, error: e2 } = await sb
      .from('events')
      .select('id')
      .eq('tenant_id', tenantId);

    if (e2) {
      console.error(`  [ERRO] list events tenant=${tenantId}: ${e2.message}`);
      allOk = false;
      continue;
    }

    const ids = (evIds || []).map(e => e.id);

    let dbTeam = 0;
    if (ids.length > 0) {
      const { count, error: e3 } = await sb
        .from('event_team')
        .select('id', { count: 'exact', head: true })
        .in('event_id', ids);

      if (e3) {
        console.error(`  [ERRO] count event_team tenant=${tenantId}: ${e3.message}`);
        allOk = false;
        continue;
      }
      dbTeam = count ?? 0;
    }

    // dbEvents pode ser >= expectedEvents (eventos criados por outras fontes)
    const evOk   = dbEvents >= expectedEvents;
    const teamOk = dbTeam   >= expectedTeam;

    console.log(`  Tenant: ${tenantId}`);
    console.log(`    ${evOk   ? '✓' : '✗'} eventos: JSON=${expectedEvents}  DB=${dbEvents}${evOk   ? '' : '  ← DIVERGÊNCIA'}`);
    console.log(`    ${teamOk ? '✓' : '✗'} equipe:  JSON=${expectedTeam}   DB=${dbTeam}${teamOk ? '' : '  ← DIVERGÊNCIA'}`);

    if (!evOk) {
      allOk = false;
      console.log(`      → Faltam ${expectedEvents - dbEvents} evento(s) no banco.`);
    }
    if (!teamOk) {
      allOk = false;
      console.log(`      → Faltam ${expectedTeam - dbTeam} membro(s) de equipe no banco.`);
    }
    console.log();
  }

  if (allOk) {
    console.log('✓ Verificação concluída — nenhuma divergência encontrada.\n');
  } else {
    console.log('✗ Há divergências. Verifique os erros acima e rode novamente.\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\nErro inesperado:', err.message ?? err);
  process.exit(1);
});
