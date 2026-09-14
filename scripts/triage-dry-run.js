'use strict';

// Dry-run triage on existing events.
// Usage:
//   node scripts/triage-dry-run.js            # preview only
//   node scripts/triage-dry-run.js --apply    # persist to DB

const APPLY = process.argv.includes('--apply');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars.');
  process.exit(1);
}

const { parseTituloEvento } = require('./lib/triage-parser');
const { matchServico }      = require('./lib/triage-match');

// ── Minimal fetch wrapper for Supabase REST API ───────────────────────────────
const fetch = (...args) => import('node-fetch').then(m => m.default(...args)).catch(() => {
  // Node 18+ has built-in fetch
  return globalThis.fetch(...args);
});

function headers(prefer) {
  const h = {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (prefer) h['Prefer'] = prefer;
  return h;
}

async function supaGet(path, params) {
  const url = new URL(SUPABASE_URL + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function supaPost(path, body) {
  const res = await fetch(SUPABASE_URL + path, {
    method: 'POST',
    headers: headers('return=minimal'),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await res.text()}`);
}

async function supaPatch(path, params, body) {
  const url = new URL(SUPABASE_URL + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: headers('return=minimal'),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status} ${await res.text()}`);
}

async function supaDelete(path, params) {
  const url = new URL(SUPABASE_URL + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    method: 'DELETE',
    headers: headers('return=minimal'),
  });
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status} ${await res.text()}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(60));
  console.log(`TRIAGE DRY-RUN  ${APPLY ? '[--apply MODE]' : '[preview only]'}`);
  console.log('='.repeat(60));

  // 1. Load all events (service role bypasses RLS)
  const events = await supaGet('/rest/v1/events', {
    select: 'id,nome,tenant_id,triagem_status',
    triagem_status: 'neq.confirmado',
    order: 'created_at.asc',
    limit: 2000,
  });
  console.log(`\nLoaded ${events.length} events (excluding confirmado).`);

  // 2. Load all service keywords with service info
  const keywords = await supaGet('/rest/v1/service_keywords', {
    select: 'service_id,keyword',
    limit: 5000,
  });
  const allKw = keywords.map(k => ({ serviceId: k.service_id, keyword: k.keyword }));
  console.log(`Loaded ${allKw.length} service keywords.`);

  // 3. Load services (for name lookup in output)
  const services = await supaGet('/rest/v1/services', {
    select: 'id,nome,template_kit_id',
    limit: 1000,
  });
  const svcById = Object.fromEntries(services.map(s => [s.id, s]));

  // 4. Process each event
  const stats = { reconhecido: 0, nao_identificado: 0, confirmado: 0, pendente: 0 };
  const unrecognized = [];

  for (const ev of events) {
    const titulo = ev.nome || '';
    const { blocos, cliente } = parseTituloEvento(titulo);

    // Compute total duration
    const duracaoTotal = blocos.reduce((s, b) => s + (b.duracaoMin || 0), 0);

    // Match each block
    const blocosMatched = blocos.map((b, i) => {
      const serviceId = allKw.length > 0 ? matchServico(b.nomeNormalizado, allKw) : null;
      return { ...b, serviceId, ordem: i };
    });

    const allMatched = blocosMatched.length > 0 && blocosMatched.every(b => b.serviceId);
    const triagemStatus = blocosMatched.length === 0
      ? 'nao_identificado'
      : allMatched ? 'reconhecido' : 'nao_identificado';

    stats[triagemStatus] = (stats[triagemStatus] || 0) + 1;

    if (triagemStatus === 'nao_identificado') {
      unrecognized.push({ ev, blocosMatched, cliente });
    }

    if (APPLY) {
      // Update events row
      await supaPatch('/rest/v1/events', { id: `eq.${ev.id}` }, {
        titulo_original: titulo,
        cliente: cliente || null,
        duracao_total_min: duracaoTotal || null,
        triagem_status: triagemStatus,
      });

      // Replace event_services rows
      await supaDelete('/rest/v1/event_services', { event_id: `eq.${ev.id}` });

      if (blocosMatched.length > 0) {
        await supaPost('/rest/v1/event_services', blocosMatched.map(b => ({
          event_id: ev.id,
          service_id: b.serviceId || null,
          nome_bruto: b.nomeBruto,
          duracao_min: b.duracaoMin || null,
          ordem: b.ordem,
        })));
      }
    }
  }

  // 5. Print summary
  console.log('\n── RESULTADO ──────────────────────────────────────────────');
  console.log(`  ✓ Reconhecido:      ${stats.reconhecido || 0}`);
  console.log(`  ✗ Não identificado: ${stats.nao_identificado || 0}`);
  console.log(`  Total processados:  ${events.length}`);

  if (unrecognized.length > 0) {
    console.log('\n── TÍTULOS NÃO IDENTIFICADOS ────────────────────────────');
    for (const { ev, blocosMatched, cliente } of unrecognized) {
      const clienteStr = cliente ? ` — ${cliente}` : '';
      console.log(`\n  "${ev.nome}"${clienteStr}`);
      for (const b of blocosMatched) {
        const icon = b.serviceId ? '✓' : '✗';
        const svcNome = b.serviceId ? svcById[b.serviceId]?.nome || b.serviceId : 'não identificado';
        const dur = b.duracaoMin ? ` (${b.duracaoMin}min)` : '';
        console.log(`    ${icon} [${b.nomeNormalizado}]${dur} → ${svcNome}`);
      }
    }
  }

  if (APPLY) {
    console.log(`\n✅ Aplicado: ${events.length} eventos atualizados.`);
  } else {
    console.log('\nRode com --apply para persistir.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
