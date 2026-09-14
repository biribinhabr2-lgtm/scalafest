#!/usr/bin/env node
/**
 * recover-eventos.js
 *
 * Recupera eventos apagados em 11/09/2026 a partir de:
 *   a) sf_dados tipo 'feedbacks_<tenant>' (--from-feedbacks) — RECOMENDADO
 *      Funciona sem GCal, sem backup. Usa nome+data+ID do evento nos feedbacks.
 *   b) sf_dados_backup_20260911 (--from-backup) — só funciona se backup pré-incidente
 *   c) Google Calendar (padrão)                — exige token OAuth válido
 *
 * Em todos os modos, confirmações enriquecem o event_team.
 *
 * Uso — dry-run via feedbacks (RECOMENDADO — sem credenciais externas):
 *   node recover-eventos.js --from-feedbacks --report=recover-report.md
 *
 * Gravar de verdade:
 *   node recover-eventos.js --from-feedbacks --apply
 *
 * Opções:
 *   --apply              grava no banco (padrão: dry-run)
 *   --from-feedbacks     usa feedbacks como fonte primária (sem GCal/OAuth)
 *   --from-backup        usa sf_dados_backup_20260911 como fonte primária
 *   --tenant=<uuid>      limita a um tenant específico
 *   --from=YYYY-MM-DD    início do período (padrão: 2025-09-01)
 *   --to=YYYY-MM-DD      fim   do período  (padrão: 2026-09-10)
 *   --report=<path>      onde salvar o relatório .md (padrão: ./recover-report.md)
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { randomUUID }   = require('crypto');
const fs               = require('fs');
const path             = require('path');

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args            = process.argv.slice(2);
const DRY_RUN         = !args.includes('--apply');
const FROM_BACKUP     = args.includes('--from-backup');
const FROM_FEEDBACKS  = args.includes('--from-feedbacks');
const TENANT_FILTER = (args.find(a => a.startsWith('--tenant=')) || '').split('=')[1] || null;
const FROM_DATE     = (args.find(a => a.startsWith('--from='))   || '--from=2025-09-01').split('=')[1];
const TO_DATE       = (args.find(a => a.startsWith('--to='))     || '--to=2026-09-10').split('=')[1];
const REPORT_PATH   = path.resolve(
  (args.find(a => a.startsWith('--report=')) || '--report=recover-report.md').split('=')[1]
);

// ─── Env ──────────────────────────────────────────────────────────────────────

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    '\nERRO: variáveis de ambiente obrigatórias ausentes.\n' +
    '  Defina SUPABASE_URL e SUPABASE_SERVICE_KEY.\n'
  );
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Constantes ───────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Status que indicam presença confirmada
const CONFIRMED = new Set([
  'confirmado', 'confirmed', 'sim', 'yes', 'presente', 'aceito', 'accepted', '1',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isUuid = s => typeof s === 'string' && UUID_RE.test(s);

function normDate(str) {
  if (!str) return null;
  const m = str.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function normTime(str) {
  // Extract HH:MM from "2025-12-31T19:00:00-03:00" or pure date strings
  if (!str || str.length <= 10) return null;
  const m = str.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : null;
}

// Normalised key for nome+data matching
const normKey = (nome, data) =>
  `${(nome || '').toLowerCase().trim().replace(/\s+/g, ' ')}|${data || ''}`;

function isConfirmed(conf) {
  if (conf == null) return false;
  // bare presence (key exists with no status) counts as confirmed
  if (typeof conf !== 'object') return CONFIRMED.has(String(conf).toLowerCase().trim());
  const s = conf.status;
  if (s == null || s === true) return true;
  return CONFIRMED.has(String(s).toLowerCase().trim());
}

// ─── Google OAuth ─────────────────────────────────────────────────────────────

async function refreshGoogleToken(tokenRow) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.warn('    ⚠ GOOGLE_CLIENT_ID/SECRET não definidos — não é possível renovar token expirado');
    return null;
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: tokenRow.refresh_token,
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type:    'refresh_token',
    }),
  });
  const d = await res.json();
  if (!d.access_token) {
    console.warn(`    ⚠ Falha ao renovar token: ${d.error} — ${d.error_description}`);
    return null;
  }
  const expiry = new Date(Date.now() + d.expires_in * 1000).toISOString();
  // Update stored token (always safe, non-destructive)
  await sb.from('google_calendar_tokens')
    .update({ access_token: d.access_token, token_expiry: expiry })
    .eq('tenant_id', tokenRow.tenant_id);
  return d.access_token;
}

async function getValidToken(tokenRow) {
  const expired = !tokenRow.token_expiry ||
    new Date(tokenRow.token_expiry) <= new Date(Date.now() + 60_000);
  if (!expired) return tokenRow.access_token;
  return refreshGoogleToken(tokenRow);
}

// ─── Google Calendar API ──────────────────────────────────────────────────────

async function fetchCalendarEvents(accessToken, fromDate, toDate) {
  const params = new URLSearchParams({
    timeMin:      `${fromDate}T00:00:00Z`,
    timeMax:      `${toDate}T23:59:59Z`,
    singleEvents: 'true',
    orderBy:      'startTime',
    maxResults:   '2500',
  });

  const all = [];
  let pageToken = null;

  do {
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await res.json();
    if (res.status !== 200)
      throw new Error(`Calendar API ${res.status}: ${data.error?.message ?? JSON.stringify(data)}`);
    all.push(...(data.items || []));
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return all.filter(ev => ev.status !== 'cancelled' && ev.summary);
}

// ─── Data loaders ─────────────────────────────────────────────────────────────

async function loadFeedbacks(tenantId) {
  const { data, error } = await sb
    .from('sf_dados')
    .select('user_id, dados')
    .eq('tipo', `feedbacks_${tenantId}`);
  if (error) console.warn(`  ⚠ feedbacks: ${error.message}`);

  const byNameDate = new Map(); // normKey(nome,data) → [entry]
  const byEventId  = new Map(); // eventoId(str)      → [entry]

  for (const row of (data || [])) {
    const fid   = row.user_id;
    const items = Array.isArray(row.dados) ? row.dados : [];
    for (const fb of items) {
      if (!fb.eventoId) continue;
      const evId = String(fb.eventoId);

      // Try to extract funcao from respostas keys like 'funcao', 'função', 'papel', 'cargo'
      let funcao = null;
      if (fb.respostas && typeof fb.respostas === 'object') {
        const key = Object.keys(fb.respostas)
          .find(k => /func|papel|cargo|role/i.test(k));
        if (key) funcao = String(fb.respostas[key]).trim() || null;
      }

      const entry = { freelancerId: fid, eventoId: evId, funcao };

      const nk = normKey(fb.eventoNome, normDate(fb.eventoData));
      if (!byNameDate.has(nk)) byNameDate.set(nk, []);
      byNameDate.get(nk).push(entry);

      if (!byEventId.has(evId)) byEventId.set(evId, []);
      byEventId.get(evId).push(entry);
    }
  }

  return { byNameDate, byEventId };
}

async function loadConfirmacoes(tenantId) {
  // Restrict to freelancers belonging to this tenant
  const { data: perfis, error: pErr } = await sb
    .from('sf_perfis')
    .select('id')
    .eq('admin_id', tenantId);
  if (pErr) console.warn(`  ⚠ sf_perfis: ${pErr.message}`);

  const flIds = (perfis || []).map(p => p.id);
  if (flIds.length === 0) return { byEventId: new Map(), allEventIds: new Set() };

  const byEventId  = new Map(); // evId → [{ freelancerId, conf }]
  const allEventIds = new Set();

  for (const tipo of ['confirmacoes', 'confirmacoes_presenca']) {
    const { data, error } = await sb
      .from('sf_dados')
      .select('user_id, dados')
      .eq('tipo', tipo)
      .in('user_id', flIds);
    if (error) console.warn(`  ⚠ ${tipo}: ${error.message}`);

    for (const row of (data || [])) {
      const fid   = row.user_id;
      const confs = (row.dados && typeof row.dados === 'object' && !Array.isArray(row.dados))
        ? row.dados : {};
      for (const [evId, conf] of Object.entries(confs)) {
        allEventIds.add(evId);
        if (!byEventId.has(evId)) byEventId.set(evId, []);
        byEventId.get(evId).push({ freelancerId: fid, conf });
      }
    }
  }

  return { byEventId, allEventIds };
}

async function loadBackupEvents(tenantId) {
  try {
    const { data, error } = await sb
      .from('sf_dados_backup_20260911')
      .select('dados')
      .eq('user_id', tenantId)
      .eq('tipo', 'eventos')
      .maybeSingle();

    if (error) {
      console.warn(`  ⚠ backup query error: ${error.message}`);
      return { byGcalId: new Map(), byNameDate: new Map(), total: 0, all: [] };
    }
    if (!data) {
      console.warn(`  ⚠ backup: nenhuma linha encontrada (user_id=${tenantId}, tipo='eventos')`);
      return { byGcalId: new Map(), byNameDate: new Map(), total: 0, all: [] };
    }

    const all = Array.isArray(data.dados) ? data.dados : [];
    console.log(`  Backup raw: ${all.length} evento(s) total na tabela`);

    if (all.length > 0) {
      // Diagnóstico: mostrar os primeiros 3 eventos para verificar formato das datas
      const sample = all.slice(0, 3).map(ev => `"${ev.nome || '?'}" data=${JSON.stringify(ev.data || ev.date || ev.Data)}`);
      console.log(`  Backup amostra: ${sample.join(' | ')}`);
    }

    // Filtrar pelo período FROM_DATE ≤ data ≤ TO_DATE (inclusive)
    // Aceita tanto campo 'data' quanto 'date' (defensivo)
    const inRange = all.filter(ev => {
      const d = normDate(ev.data || ev.date || ev.Data || '');
      return d && d >= FROM_DATE && d <= TO_DATE;
    });

    console.log(`  Backup no período ${FROM_DATE}→${TO_DATE}: ${inRange.length} evento(s)`);

    const byGcalId   = new Map(
      inRange.filter(e => e.google_event_id).map(e => [e.google_event_id, e])
    );
    const byNameDate = new Map();
    for (const ev of inRange) {
      const d  = normDate(ev.data || ev.date || ev.Data || '');
      const nk = normKey(ev.nome, d);
      if (!byNameDate.has(nk)) byNameDate.set(nk, []);
      byNameDate.get(nk).push({ ...ev, data: d }); // normaliza campo data
    }

    return { byGcalId, byNameDate, total: inRange.length, all };
  } catch (e) {
    console.warn(`  ⚠ backup exception: ${e.message}`);
    return { byGcalId: new Map(), byNameDate: new Map(), total: 0, all: [] };
  }
}

async function loadExistingEvents(tenantId) {
  const { data, error } = await sb
    .from('events')
    .select('id, legacy_id, google_event_id')
    .eq('tenant_id', tenantId);
  if (error) console.warn(`  ⚠ events existentes: ${error.message}`);

  const byGcalId   = new Map();
  const byLegacyId = new Map();
  const byUuid     = new Set();

  for (const ev of (data || [])) {
    if (ev.google_event_id) byGcalId.set(ev.google_event_id, ev);
    if (ev.legacy_id)       byLegacyId.set(String(ev.legacy_id), ev);
    byUuid.add(ev.id);
  }

  return { byGcalId, byLegacyId, byUuid, count: (data || []).length };
}

// ─── Team builder ─────────────────────────────────────────────────────────────

function buildConfTeam(eventUuid, tenantId, confByEventId, feedbackByEventId, originalId, gcalId) {
  // Collect all confirmation entries for this event
  const candidates = [
    ...(originalId ? (confByEventId.get(originalId) || []) : []),
    ...(confByEventId.get(gcalId) || []),
  ];

  const seen    = new Set();
  const members = [];

  for (const { freelancerId, conf } of candidates) {
    if (seen.has(freelancerId))   continue;
    if (!isConfirmed(conf))       continue;
    seen.add(freelancerId);

    // Try to get funcao from feedback
    const funcao = (feedbackByEventId.get(originalId || '') || [])
      .find(f => f.freelancerId === freelancerId)?.funcao || null;

    members.push({
      event_id:          eventUuid,
      tenant_id:         tenantId,
      freelancer_id:     freelancerId,
      funcao,
      cache_base:        null,
      obs:               null,
      pago:              false,
      turnos:            1,
      bonus_nivel:       null,
      bonus_ativo:       false,
      bonus_mult_turnos: false,
    });
  }

  return members;
}

function buildBackupTeam(eventUuid, tenantId, equipe) {
  if (!Array.isArray(equipe)) return [];
  return equipe
    .filter(m => m.freelancerId)
    .map(m => ({
      event_id:          eventUuid,
      tenant_id:         tenantId,
      freelancer_id:     String(m.freelancerId),
      funcao:            m.funcao           || null,
      cache_base:        m.cache  != null   ? Number(m.cache)  : null,
      obs:               m.obs              || null,
      pago:              !!m.pago,
      turnos:            m.turnos != null   ? Math.max(1, Number(m.turnos)) : 1,
      bonus_nivel:       m.bonus?.nivel     || null,
      bonus_ativo:       !!(m.bonus?.ativo),
      bonus_mult_turnos: !!m.bonusMultTurnos,
    }));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const mode = DRY_RUN ? 'DRY-RUN' : 'APPLY';
  const source = FROM_BACKUP ? 'BACKUP' : 'GCAL';
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  recover-eventos.js  [${mode}]  fonte: ${source}`);
  console.log(`  Período: ${FROM_DATE} → ${TO_DATE}`);
  console.log(`  ${new Date().toISOString()}`);
  console.log(`${'═'.repeat(70)}\n`);

  if (FROM_FEEDBACKS) {
    await runFromFeedbacks(mode);
  } else if (FROM_BACKUP) {
    await runFromBackup(mode);
  } else {
    await runFromGcal(mode);
  }
}

// ─── Modo feedbacks: reconstrói eventos a partir dos feedbacks dos freelancers ─

async function runFromFeedbacks(mode) {
  // Descobrir tenants: via TENANT_FILTER ou via google_calendar_tokens (lista de admins)
  let tenantIds;
  if (TENANT_FILTER) {
    tenantIds = [TENANT_FILTER];
  } else {
    const { data: tokRows, error } = await sb.from('google_calendar_tokens').select('tenant_id');
    if (error) { console.error('ERRO ao listar tenants:', error.message); process.exit(1); }
    tenantIds = (tokRows || []).map(r => r.tenant_id);
    if (!tenantIds.length) {
      console.error('Nenhum tenant encontrado. Use --tenant=<uuid>.');
      process.exit(1);
    }
  }

  console.log(`Tenants a processar: ${tenantIds.length}\n`);

  const reportSections = [];
  const G = { total: 0, casados: 0, soCal: 0, pulados: 0, confSemEvento: 0, erros: 0 };

  for (const tenantId of tenantIds) {
    console.log(`\n── Tenant: ${tenantId}`);

    const [feedbacks, confirmacoes, existing] = await Promise.all([
      loadFeedbacks(tenantId),
      loadConfirmacoes(tenantId),
      loadExistingEvents(tenantId),
    ]);

    console.log(`  Existing: ${existing.count} evento(s) já no banco`);
    console.log(`  Feedbacks: ${feedbacks.byEventId.size} evento(s) únicos referenciados`);
    console.log(`  Conf IDs únicos: ${confirmacoes.allEventIds.size}`);

    // Construir mapa de eventos a partir dos feedbacks:
    // Para cada eventoId único, pegar o nome+data mais frequente (maioria ganha)
    // Estrutura de feedbacks.byEventId: eventoId → [{ freelancerId, eventoId, funcao }]
    // Mas não temos eventoNome/eventoData aí — precisamos dos itens brutos dos feedbacks.
    // Vamos recarregar os dados brutos de feedbacks para ter nome+data por evento.
    const eventStubs = await buildEventStubsFromFeedbacks(tenantId, FROM_DATE, TO_DATE);
    console.log(`  Stubs de eventos no período: ${eventStubs.size} evento(s)`);

    const recovered = [];
    const skipped   = [];

    for (const [evId, stub] of eventStubs) {
      // Pular se já existe no banco
      if (isUuid(evId) && existing.byUuid.has(evId)) {
        skipped.push({ gcalId: null, nome: stub.nome, date: stub.data, reason: `já_existe_uuid:${evId}` });
        G.pulados++;
        continue;
      }
      if (!isUuid(evId) && existing.byLegacyId.has(evId)) {
        skipped.push({ gcalId: null, nome: stub.nome, date: stub.data, reason: `já_existe_legacy_id:${evId}` });
        G.pulados++;
        continue;
      }

      // Determinar UUID e legacy_id
      let newUuid, legacyId;
      if (isUuid(evId)) {
        newUuid = evId; legacyId = null;
      } else {
        newUuid = randomUUID(); legacyId = evId;
      }

      const confidence = 'casou_com_id_original';
      G.casados++;

      // Equipe: apenas de confirmações (feedbacks não têm equipe do backup)
      const teamMembers = buildConfTeam(
        newUuid, tenantId,
        confirmacoes.byEventId, feedbacks.byEventId,
        evId, null
      );

      const obs = '[RECUPERADO] hora, local, tipo e cachês precisam ser preenchidos manualmente.';

      const eventRow = {
        id:         newUuid,
        tenant_id:  tenantId,
        ...(legacyId ? { legacy_id: legacyId } : {}),
        nome:       stub.nome,
        tipo:       'Outro',
        status:     'Confirmado',
        data:       stub.data,
        hora_inicio: null,
        hora_fim:   null,
        local:      null,
        obs,
        recuperado: true,
      };

      recovered.push({
        uuid: newUuid, legacyId, gcalId: null,
        nome: stub.nome, date: stub.data,
        confidence,
        teamCount:   teamMembers.length,
        cachePreenc: 0,
        fromBackup:  false,
        eventRow,
        teamRows:    teamMembers,
      });
      G.total++;
    }

    const confSemEvento = buildConfSemEvento(recovered, existing, confirmacoes.allEventIds, G);
    printTenantSummary(recovered, skipped, confSemEvento);
    reportSections.push({ tenantId, recovered, skipped, confSemEvento });

    if (!DRY_RUN && recovered.length > 0) await applyRecovered(recovered, G);
  }

  finish(reportSections, G, mode);
}

// Constrói um mapa eventoId → { nome, data } a partir dos feedbacks brutos
async function buildEventStubsFromFeedbacks(tenantId, fromDate, toDate) {
  const { data, error } = await sb
    .from('sf_dados')
    .select('user_id, dados')
    .eq('tipo', `feedbacks_${tenantId}`);
  if (error) { console.warn(`  ⚠ feedbacks brutos: ${error.message}`); return new Map(); }

  // Para cada eventoId, acumular votos de nome+data (mais frequente ganha — robustez)
  const votes = new Map(); // evId → Map<"nome|data", count>
  const names = new Map(); // evId → Map<"nome|data", { nome, data }>

  for (const row of (data || [])) {
    const items = Array.isArray(row.dados) ? row.dados : [];
    for (const fb of items) {
      if (!fb.eventoId) continue;
      const evId   = String(fb.eventoId);
      const fbDate = normDate(fb.eventoData);
      if (!fbDate || fbDate < fromDate || fbDate > toDate) continue;

      const key = `${fb.eventoNome || ''}|${fbDate}`;
      if (!votes.has(evId)) { votes.set(evId, new Map()); names.set(evId, new Map()); }
      votes.get(evId).set(key, (votes.get(evId).get(key) || 0) + 1);
      names.get(evId).set(key, { nome: fb.eventoNome || '(sem nome)', data: fbDate });
    }
  }

  // Para cada eventoId, pegar a combinação nome+data com mais votos
  const stubs = new Map();
  for (const [evId, voteMap] of votes) {
    const bestKey = [...voteMap.entries()].sort((a, b) => b[1] - a[1])[0][0];
    stubs.set(evId, names.get(evId).get(bestKey));
  }

  return stubs;
}

// ─── Modo backup: usa sf_dados_backup_20260911 como fonte primária ────────────

async function runFromBackup(mode) {
  // Descobrir tenants com backup
  let backupQ = sb.from('sf_dados_backup_20260911').select('user_id').eq('tipo', 'eventos');
  if (TENANT_FILTER) backupQ = backupQ.eq('user_id', TENANT_FILTER);
  const { data: backupTenants, error: btErr } = await backupQ;
  if (btErr) { console.error('ERRO ao ler sf_dados_backup_20260911:', btErr.message); process.exit(1); }
  if (!backupTenants?.length) { console.log('Nenhum tenant com backup de eventos encontrado.'); return; }

  const tenantIds = [...new Set(backupTenants.map(r => r.user_id))];
  console.log(`Tenants com backup: ${tenantIds.length}\n`);

  const reportSections = [];
  const G = { total: 0, casados: 0, soCal: 0, pulados: 0, confSemEvento: 0, erros: 0 };

  for (const tenantId of tenantIds) {
    console.log(`\n── Tenant: ${tenantId}`);

    // Carregar todas as fontes em paralelo
    const [feedbacks, confirmacoes, backup, existing] = await Promise.all([
      loadFeedbacks(tenantId),
      loadConfirmacoes(tenantId),
      loadBackupEvents(tenantId),
      loadExistingEvents(tenantId),
    ]);

    console.log(`  Backup: ${backup.total} evento(s) históricos no período`);
    console.log(`  Existing: ${existing.count} evento(s) já no banco`);
    console.log(`  Conf IDs únicos: ${confirmacoes.allEventIds.size}`);
    console.log(`  Feedbacks (eventos únicos): ${feedbacks.byEventId.size}`);

    if (backup.total === 0) {
      if (backup.all.length > 0) {
        console.warn(`  ⚠ Backup tem ${backup.all.length} evento(s) no total, mas nenhum no período ${FROM_DATE}→${TO_DATE}.`);
        console.warn(`    Ajuste --from e --to ou verifique o formato de datas no backup.`);
      } else {
        console.log(`  Nenhum evento no backup — pulando tenant`);
      }
      reportSections.push({ tenantId, recovered: [], skipped: [], confSemEvento: [] });
      continue;
    }

    const recovered = [];
    const skipped   = [];

    // Iterar pelos eventos do backup como fonte primária
    // byNameDate pode ter duplicatas se dois eventos têm mesmo nome+data; byGcalId é único
    const seenIds = new Set();
    const allBackupEvents = [
      ...backup.byGcalId.values(),
      ...[...backup.byNameDate.values()].flat(),
    ].filter(ev => {
      const key = ev.google_event_id || String(ev.id ?? ev.nome + '|' + ev.data);
      if (seenIds.has(key)) return false;
      seenIds.add(key);
      return true;
    });

    for (const bEv of allBackupEvents) {
      const rawId     = bEv.id != null ? String(bEv.id) : null;
      const gcalId    = bEv.google_event_id || null;
      const eventDate = normDate(bEv.data || bEv.date || bEv.Data || '') || bEv.data || null;
      const eventNome = bEv.nome || '(sem nome)';

      // Pular se já existe no banco por google_event_id
      if (gcalId && existing.byGcalId.has(gcalId)) {
        skipped.push({ gcalId, nome: eventNome, date: eventDate, reason: 'já_existe_google_event_id' });
        G.pulados++;
        continue;
      }

      // Pular se já existe por legacy_id
      if (rawId && existing.byLegacyId.has(rawId)) {
        skipped.push({ gcalId, nome: eventNome, date: eventDate, reason: `já_existe_legacy_id:${rawId}` });
        G.pulados++;
        continue;
      }

      // Pular se rawId é UUID e já existe como events.id
      if (rawId && isUuid(rawId) && existing.byUuid.has(rawId)) {
        skipped.push({ gcalId, nome: eventNome, date: eventDate, reason: `já_existe_uuid:${rawId}` });
        G.pulados++;
        continue;
      }

      // Determinar UUID final e legacy_id
      let newUuid, legacyId;
      if (!rawId) {
        newUuid  = randomUUID();
        legacyId = null;
      } else if (isUuid(rawId)) {
        newUuid  = rawId;
        legacyId = null;
      } else {
        newUuid  = randomUUID();
        legacyId = rawId;
      }

      // Correlação com feedbacks para determinar confiança
      const nk        = normKey(eventNome, eventDate);
      const fbMatches = feedbacks.byNameDate.get(nk) || [];
      const hasFb     = fbMatches.length > 0 || feedbacks.byEventId.has(rawId || '');
      const confidence = hasFb
        ? (gcalId ? 'casou_com_id_original+backup+gcal' : 'casou_com_id_original+backup')
        : (gcalId ? 'so_backup+gcal' : 'so_backup');

      if (hasFb) G.casados++; else G.soCal++;

      // Equipe do backup + extras das confirmações
      const backupTeam  = buildBackupTeam(newUuid, tenantId, bEv.equipe);
      const confTeam    = buildConfTeam(
        newUuid, tenantId,
        confirmacoes.byEventId, feedbacks.byEventId,
        rawId, gcalId
      );
      const backupFlIds = new Set(backupTeam.map(m => m.freelancer_id));
      const extraConf   = confTeam.filter(m => !backupFlIds.has(m.freelancer_id));
      const teamMembers = [...backupTeam, ...extraConf];

      const obs = [bEv.obs, '[RECUPERADO] Cachês precisam ser preenchidos manualmente.']
        .filter(Boolean).join('\n');

      const eventRow = {
        id:                     newUuid,
        tenant_id:              tenantId,
        ...(legacyId ? { legacy_id: legacyId } : {}),
        nome:                   eventNome,
        tipo:                   bEv.tipo   || 'Outro',
        status:                 bEv.status || 'Confirmado',
        data:                   eventDate,
        hora_inicio:            bEv.horaInicio || null,
        hora_fim:               bEv.horaFim    || null,
        local:                  bEv.local      || null,
        obs,
        ...(gcalId ? { google_event_id: gcalId, google_calendar_synced: true } : {}),
        recuperado:             true,
      };

      recovered.push({
        uuid: newUuid, legacyId, gcalId,
        nome: eventNome, date: eventDate,
        confidence,
        teamCount:   teamMembers.length,
        cachePreenc: backupTeam.filter(m => m.cache_base != null).length,
        fromBackup:  true,
        eventRow,
        teamRows:    teamMembers,
      });
      G.total++;
    }

    const confSemEvento = buildConfSemEvento(recovered, existing, confirmacoes.allEventIds, G);

    printTenantSummary(recovered, skipped, confSemEvento);
    reportSections.push({ tenantId, recovered, skipped, confSemEvento });

    if (!DRY_RUN && recovered.length > 0) {
      await applyRecovered(recovered, G);
    }
  }

  finish(reportSections, G, mode);
}

// ─── Modo GCal: usa Google Calendar como fonte primária ──────────────────────

async function runFromGcal(mode) {
  let tokQ = sb.from('google_calendar_tokens').select('*');
  if (TENANT_FILTER) tokQ = tokQ.eq('tenant_id', TENANT_FILTER);
  const { data: tokenRows, error: tokErr } = await tokQ;
  if (tokErr) { console.error('ERRO ao ler google_calendar_tokens:', tokErr.message); process.exit(1); }
  if (!tokenRows?.length) { console.log('Nenhum token de Google Calendar encontrado.'); return; }

  console.log(`Tenants com token GCal: ${tokenRows.length}\n`);

  const reportSections = [];
  const G = { total: 0, casados: 0, soCal: 0, pulados: 0, confSemEvento: 0, erros: 0 };

  for (const tokenRow of tokenRows) {
    const tenantId = tokenRow.tenant_id;
    console.log(`\n── Tenant: ${tenantId}`);

    let accessToken;
    try   { accessToken = await getValidToken(tokenRow); }
    catch (e) { console.error(`  [SKIP] token: ${e.message}`); continue; }
    if (!accessToken) { console.error(`  [SKIP] token inválido ou não renovável — use --from-backup`); continue; }

    let calEvents;
    try   { calEvents = await fetchCalendarEvents(accessToken, FROM_DATE, TO_DATE); }
    catch (e) { console.error(`  [SKIP] Calendar API: ${e.message}`); continue; }
    console.log(`  GCal: ${calEvents.length} evento(s) no período`);

    const [feedbacks, confirmacoes, backup, existing] = await Promise.all([
      loadFeedbacks(tenantId),
      loadConfirmacoes(tenantId),
      loadBackupEvents(tenantId),
      loadExistingEvents(tenantId),
    ]);

    console.log(`  Backup: ${backup.total} evento(s) históricos`);
    console.log(`  Existing: ${existing.count} evento(s) já no banco`);
    console.log(`  Conf IDs únicos: ${confirmacoes.allEventIds.size}`);

    const recovered = [];
    const skipped   = [];

    for (const calEv of calEvents) {
      const gcalId     = calEv.id;
      const startRaw   = calEv.start?.dateTime ?? calEv.start?.date ?? '';
      const endRaw     = calEv.end?.dateTime   ?? calEv.end?.date   ?? '';
      const eventDate  = normDate(startRaw);
      const horaInicio = normTime(startRaw);
      const horaFim    = normTime(endRaw);
      const eventNome  = calEv.summary || '(sem nome)';

      if (existing.byGcalId.has(gcalId)) {
        skipped.push({ gcalId, nome: eventNome, date: eventDate, reason: 'já_existe_google_event_id' });
        G.pulados++;
        continue;
      }

      const nk     = normKey(eventNome, eventDate);
      const idFreq = new Map();
      for (const e of (feedbacks.byNameDate.get(nk) || []))
        idFreq.set(e.eventoId, (idFreq.get(e.eventoId) || 0) + 1);
      const originalId = idFreq.size > 0
        ? [...idFreq.entries()].sort((a, b) => b[1] - a[1])[0][0]
        : null;

      if (originalId && existing.byLegacyId.has(String(originalId))) {
        skipped.push({ gcalId, nome: eventNome, date: eventDate, reason: `já_existe_legacy_id:${originalId}` });
        G.pulados++;
        continue;
      }
      if (originalId && isUuid(originalId) && existing.byUuid.has(originalId)) {
        skipped.push({ gcalId, nome: eventNome, date: eventDate, reason: `já_existe_uuid:${originalId}` });
        G.pulados++;
        continue;
      }

      const backupEv = backup.byGcalId.get(gcalId) || backup.byNameDate.get(nk)?.[0] || null;

      let confidence, newUuid, legacyId;
      if (originalId && isUuid(originalId)) {
        newUuid = originalId; legacyId = null; confidence = 'casou_com_id_original'; G.casados++;
      } else if (originalId) {
        newUuid = randomUUID(); legacyId = originalId; confidence = 'casou_com_id_original'; G.casados++;
      } else if (backupEv?.id) {
        const bid = String(backupEv.id);
        newUuid = isUuid(bid) ? bid : randomUUID();
        legacyId = isUuid(bid) ? null : bid;
        confidence = 'so_calendario+backup_id'; G.soCal++;
      } else {
        newUuid = randomUUID(); legacyId = null; confidence = 'so_calendario'; G.soCal++;
      }

      let local = calEv.location || null, tipo = 'Outro', status = 'Confirmado', obsBase = '';
      if (backupEv) {
        local = backupEv.local || local; tipo = backupEv.tipo || tipo;
        status = backupEv.status || status; obsBase = backupEv.obs || '';
        confidence = confidence.includes('+backup') ? confidence : confidence + '+backup';
      }

      const obs = [obsBase, '[RECUPERADO] Cachês precisam ser preenchidos manualmente.']
        .filter(Boolean).join('\n');

      const backupTeam  = buildBackupTeam(newUuid, tenantId, backupEv?.equipe);
      const confTeam    = buildConfTeam(newUuid, tenantId, confirmacoes.byEventId, feedbacks.byEventId, originalId, gcalId);
      const backupFlIds = new Set(backupTeam.map(m => m.freelancer_id));
      const teamMembers = [...backupTeam, ...confTeam.filter(m => !backupFlIds.has(m.freelancer_id))];

      const eventRow = {
        id: newUuid, tenant_id: tenantId,
        ...(legacyId ? { legacy_id: legacyId } : {}),
        nome: eventNome, tipo, status, data: eventDate,
        hora_inicio: horaInicio, hora_fim: horaFim, local, obs,
        google_event_id: gcalId, google_calendar_synced: true, recuperado: true,
      };

      recovered.push({
        uuid: newUuid, legacyId, gcalId,
        nome: eventNome, date: eventDate, confidence,
        teamCount: teamMembers.length,
        cachePreenc: backupTeam.filter(m => m.cache_base != null).length,
        fromBackup: !!backupEv, eventRow, teamRows: teamMembers,
      });
      G.total++;
    }

    const confSemEvento = buildConfSemEvento(recovered, existing, confirmacoes.allEventIds, G);
    printTenantSummary(recovered, skipped, confSemEvento);
    reportSections.push({ tenantId, recovered, skipped, confSemEvento });

    if (!DRY_RUN && recovered.length > 0) await applyRecovered(recovered, G);
  }

  finish(reportSections, G, mode);
}

// ─── Utilitários compartilhados ────────────────────────────────────────────────

function buildConfSemEvento(recovered, existing, allConfIds, G) {
  const known = new Set([
    ...recovered.map(r => r.uuid),
    ...recovered.map(r => r.legacyId).filter(Boolean),
    ...recovered.map(r => r.gcalId).filter(Boolean),
    ...existing.byUuid,
    ...existing.byLegacyId.keys(),
    ...existing.byGcalId.keys(),
  ]);
  const sem = [];
  for (const evId of allConfIds) {
    if (!known.has(evId)) { sem.push(evId); G.confSemEvento++; }
  }
  return sem;
}

function printTenantSummary(recovered, skipped, confSemEvento) {
  const enriched = recovered.filter(r => r.fromBackup).length;
  console.log(`\n  Recuperados: ${recovered.length} (${enriched} com dados do backup)`);
  console.log(`  Pulados: ${skipped.length}  |  Conf sem evento: ${confSemEvento.length}`);
  for (const r of recovered) {
    const eq = r.teamCount > 0
      ? ` → ${r.teamCount} membro(s)${r.cachePreenc > 0 ? ` (${r.cachePreenc} com cache)` : ''}`
      : ' → sem equipe';
    console.log(`    ✓ ${r.date}  "${r.nome}"  [${r.confidence}]${eq}`);
  }
}

async function applyRecovered(recovered, G) {
  console.log(`\n  [APPLY] Gravando ${recovered.length} evento(s)...`);
  let written = 0, errors = 0;

  for (const r of recovered) {
    const { error: evErr } = await sb.from('events').insert(r.eventRow);
    if (evErr) {
      if (evErr.code === '23505') {
        console.warn(`    ⚠ Conflito (já existe): "${r.nome}" — pulando`);
      } else {
        console.error(`    ✗ "${r.nome}": ${evErr.message}`);
        G.erros++; errors++;
      }
      continue;
    }
    if (r.teamRows.length > 0) {
      const { error: teamErr } = await sb.from('event_team').insert(r.teamRows);
      if (teamErr) {
        console.error(`    ✗ event_team "${r.nome}": ${teamErr.message}`);
        G.erros++; errors++;
      }
    }
    written++;
    console.log(`    ✓ ${r.date}  "${r.nome}"`);
  }
  console.log(`\n  Resultado: ${written} gravado(s), ${errors} erro(s)`);
}

function finish(reportSections, G, mode) {
  const reportContent = buildReport(reportSections, G, mode, FROM_DATE, TO_DATE);
  fs.writeFileSync(REPORT_PATH, reportContent, 'utf8');

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`Relatório salvo em: ${REPORT_PATH}`);

  if (DRY_RUN) {
    console.log(`\n[DRY-RUN] Nada foi gravado. Para aplicar:\n`);
    const extra = [
      FROM_BACKUP ? '--from-backup' : '',
      TENANT_FILTER ? `--tenant=${TENANT_FILTER}` : '',
    ].filter(Boolean).join(' ');
    console.log(`  node recover-eventos.js --apply ${extra}\n`);
  }
}

// ─── Relatório Markdown ───────────────────────────────────────────────────────

function buildReport(sections, G, mode, fromDate, toDate) {
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const L = [];

  L.push(`# Relatório de Recuperação de Eventos`);
  L.push(``);
  L.push(`> **Modo:** ${mode} &nbsp;·&nbsp; **Período:** ${fromDate} → ${toDate} &nbsp;·&nbsp; **Gerado em:** ${now}`);
  L.push(``);
  L.push(`## Resumo Global`);
  L.push(``);
  L.push(`| Métrica | Valor |`);
  L.push(`|---------|------:|`);
  L.push(`| Eventos a recuperar | **${G.total}** |`);
  L.push(`| ↳ Casados com ID original | ${G.casados} |`);
  L.push(`| ↳ Somente calendário (sem feedback) | ${G.soCal} |`);
  L.push(`| Pulados (já existiam no banco) | ${G.pulados} |`);
  L.push(`| IDs de confirmações sem evento | ${G.confSemEvento} |`);
  if (G.erros > 0)
    L.push(`| ⚠ Erros de gravação | **${G.erros}** |`);
  L.push(``);

  // Grau de confiança
  L.push(`## Grau de Confiança`);
  L.push(``);
  L.push(`| Nível | Descrição |`);
  L.push(`|-------|-----------|`);
  L.push(`| \`casou_com_id_original\` | Evento encontrado nos feedbacks pelo nome+data; ID original recuperado. Confirmações e feedbacks voltam a casar. |`);
  L.push(`| \`casou_com_id_original+backup\` | Idem acima, mais dados completos do backup (equipe, cache, tipo). |`);
  L.push(`| \`so_calendario+backup_id\` | Sem feedback mas backup tem o evento; ID extraído do backup. |`);
  L.push(`| \`so_calendario+backup\` | Sem feedback, backup tem o evento mas não há ID confiável; UUID novo gerado. |`);
  L.push(`| \`so_calendario\` | Apenas Google Calendar, sem outras fontes. UUID novo. Equipe vazia — preencher manualmente. |`);
  L.push(``);

  for (const sec of sections) {
    L.push(`---`);
    L.push(``);
    L.push(`## Tenant \`${sec.tenantId}\``);
    L.push(``);

    if (sec.recovered.length === 0) {
      L.push(`*Nenhum evento novo a recuperar para este tenant.*`);
      L.push(``);
    } else {
      L.push(`### Eventos Recuperados (${sec.recovered.length})`);
      L.push(``);
      L.push(`| Data | Nome | Confiança | Equipe | Cache preenc. | GCal ID | ID / legacy_id |`);
      L.push(`|------|------|-----------|-------:|--------------:|---------|----------------|`);
      for (const r of sec.recovered) {
        const idRef = r.legacyId
          ? `legacy \`${r.legacyId}\``
          : `uuid \`${r.uuid.substring(0, 8)}…\``;
        const nome = r.nome.replace(/\|/g, '\\|');
        L.push(`| ${r.date} | ${nome} | \`${r.confidence}\` | ${r.teamCount} | ${r.cachePreenc} | \`${r.gcalId.substring(0, 16)}…\` | ${idRef} |`);
      }
      L.push(``);
    }

    if (sec.skipped.length > 0) {
      L.push(`### Pulados (${sec.skipped.length})`);
      L.push(``);
      L.push(`| Data | Nome | Motivo |`);
      L.push(`|------|------|--------|`);
      for (const s of sec.skipped) {
        L.push(`| ${s.date} | ${s.nome.replace(/\|/g, '\\|')} | \`${s.reason}\` |`);
      }
      L.push(``);
    }

    if (sec.confSemEvento.length > 0) {
      L.push(`### IDs de Confirmações sem Evento Associado (${sec.confSemEvento.length})`);
      L.push(``);
      L.push(`Estes IDs aparecem em \`sf_dados.confirmacoes\` mas não correspondem a nenhum evento`);
      L.push(`do Google Calendar nem a eventos já existentes no banco.`);
      L.push(`Podem ser eventos que não estavam no calendário sincronizado, ou IDs de épocas`);
      L.push(`anteriores ao início do período pesquisado (\`${fromDate}\`).`);
      L.push(``);
      L.push(`\`\`\``);
      for (const evId of sec.confSemEvento) L.push(evId);
      L.push(`\`\`\``);
      L.push(``);
    }
  }

  L.push(`---`);
  L.push(``);
  L.push(`*Gerado por \`scripts/recover-eventos.js\`*`);

  return L.join('\n');
}

// ─── Entry point ──────────────────────────────────────────────────────────────

main().catch(err => {
  console.error('\nErro inesperado:', err?.message ?? err);
  process.exit(1);
});
