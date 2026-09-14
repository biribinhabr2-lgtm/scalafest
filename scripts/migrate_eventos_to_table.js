#!/usr/bin/env node
// scripts/migrate_eventos_to_table.js
// Migra o JSON de eventos de sf_dados → tabelas events + event_team.
// Também remapeia event_id em event_items e event_attachments.
//
// Uso:
//   node scripts/migrate_eventos_to_table.js [--dry-run]
//
// Variáveis de ambiente (pode usar .env do whatsapp-server):
//   SUPABASE_URL=https://xxx.supabase.co
//   SUPABASE_SERVICE_KEY=eyJhbG...  (service_role, nunca anon)

const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '../whatsapp-server/.env') }); } catch {}

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_KEY.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

if (DRY_RUN) console.log('[DRY RUN] Nenhum dado será gravado.\n');

async function main() {
  // 1. Ler todos os tenants com dados de eventos
  const { data: rows, error } = await sb.from('sf_dados')
    .select('user_id, dados')
    .eq('tipo', 'eventos');
  if (error) { console.error('Falha ao ler sf_dados:', error.message); process.exit(1); }

  let totalEvents = 0, totalMembers = 0, totalItems = 0, totalAttachments = 0;
  const errors = [];

  for (const row of rows) {
    const tenantId = row.user_id;
    const eventos = Array.isArray(row.dados) ? row.dados : [];
    console.log(`\nTenant ${tenantId}: ${eventos.length} eventos`);

    for (const ev of eventos) {
      const legacyId = String(ev.id);
      try {
        // Idempotência: pula se legacy_id já migrado
        const { data: existing } = await sb.from('events')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('legacy_id', legacyId)
          .maybeSingle();

        let newId;
        if (existing) {
          newId = existing.id;
          console.log(`  [skip] ${ev.nome} (${legacyId}) → ${newId}`);
        } else {
          const evRow = {
            tenant_id:              tenantId,
            legacy_id:              legacyId,
            nome:                   ev.nome || '(sem nome)',
            tipo:                   ev.tipo || 'Outro',
            status:                 ev.status || 'Em negociação',
            data:                   ev.data,
            hora_inicio:            ev.horaInicio || null,
            hora_fim:               ev.horaFim || null,
            local:                  ev.local || '',
            obs:                    ev.obs || '',
            cliente_nome:           ev.cliente_nome || '',
            cliente_telefone:       ev.cliente_telefone || '',
            horario_quintal:        ev.horarioQuintal || null,
            horario_galpao:         ev.horarioGalpao || null,
            obs_logistica:          ev.obsLogistica || null,
            google_event_id:        ev.google_event_id || null,
            google_calendar_synced: ev.google_calendar_synced || false,
            updated_at:             ev.updatedAt || new Date().toISOString(),
          };

          if (!DRY_RUN) {
            const { data: ins, error: evErr } = await sb.from('events')
              .insert(evRow)
              .select('id')
              .single();
            if (evErr) {
              if (evErr.code === '23505') {
                // Conflito de unique constraint (google_event_id duplicado entre tenants?)
                console.warn(`  [conflict] ${ev.nome} (${legacyId}): ${evErr.message}`);
                errors.push({ tenantId, legacyId, nome: ev.nome, err: evErr.message });
                continue;
              }
              throw new Error(evErr.message);
            }
            newId = ins.id;
          } else {
            newId = `UUID_${legacyId}`;
          }
          console.log(`  [+ev] ${ev.nome} (${legacyId}) → ${newId}`);
          totalEvents++;
        }

        // 2. Inserir membros da equipe (pular se já existem para esse event_id)
        const equipe = Array.isArray(ev.equipe) ? ev.equipe : [];
        if (!DRY_RUN && newId && !newId.startsWith('UUID_')) {
          // Verificar se team já populado
          const { count: teamCount } = await sb.from('event_team')
            .select('id', { count: 'exact', head: true })
            .eq('event_id', newId);
          if (teamCount === 0 && equipe.length > 0) {
            const teamRows = equipe.map(m => ({
              event_id:          newId,
              tenant_id:         tenantId,
              freelancer_id:     String(m.freelancerId),
              funcao:            m.funcao || '',
              cache_base:        m.cache || 0,
              obs:               m.obs || '',
              pago:              m.pago || false,
              turnos:            m.turnos || 1,
              bonus_mult_turnos: m.bonusMultTurnos || false,
              bonus_nivel:       m.bonus?.nivel || null,
              bonus_ativo:       m.bonus?.ativo || false,
            }));
            const { error: teamErr } = await sb.from('event_team').insert(teamRows);
            if (teamErr) console.warn(`    [warn team] ${teamErr.message}`);
            else { console.log(`    [+team] ${teamRows.length} membros`); totalMembers += teamRows.length; }
          }
        } else if (DRY_RUN) {
          totalMembers += equipe.length;
        }

        // 3. Remap event_items.event_id: legacy_id → novo UUID
        if (!DRY_RUN && newId && !newId.startsWith('UUID_')) {
          const { data: itemsToUpdate } = await sb.from('event_items')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('event_id', legacyId);
          if (itemsToUpdate?.length > 0) {
            for (const item of itemsToUpdate) {
              await sb.from('event_items').update({ event_id: String(newId) }).eq('id', item.id);
            }
            console.log(`    [+items] ${itemsToUpdate.length} event_items remapeados`);
            totalItems += itemsToUpdate.length;
          }

          // 4. Remap event_attachments.event_id
          const { data: attsToUpdate } = await sb.from('event_attachments')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('event_id', legacyId);
          if (attsToUpdate?.length > 0) {
            for (const att of attsToUpdate) {
              await sb.from('event_attachments').update({ event_id: String(newId) }).eq('id', att.id);
            }
            console.log(`    [+att] ${attsToUpdate.length} event_attachments remapeados`);
            totalAttachments += attsToUpdate.length;
          }
        }
      } catch (err) {
        console.error(`  [ERRO] ${ev.nome} (${legacyId}): ${err.message}`);
        errors.push({ tenantId, legacyId, nome: ev.nome, err: err.message });
      }
    }
  }

  console.log('\n─────────────────── Sumário ───────────────────');
  console.log(`Eventos migrados:              ${totalEvents}`);
  console.log(`Membros de equipe:             ${totalMembers}`);
  console.log(`event_items remapeados:        ${totalItems}`);
  console.log(`event_attachments remapeados:  ${totalAttachments}`);
  if (errors.length > 0) {
    console.error(`\nErros (${errors.length}):`);
    errors.forEach(e => console.error(`  - ${e.tenantId}/${e.legacyId} (${e.nome}): ${e.err}`));
    process.exit(1);
  }
  console.log('\nMigração concluída com sucesso.');
  if (DRY_RUN) console.log('[DRY RUN] Nenhum dado foi gravado.');
}

main().catch(e => { console.error(e); process.exit(1); });
