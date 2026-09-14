// supabase/functions/cleanup-event-attachments/index.ts
// Deleta arquivos de Storage e registros de event_attachments cujo evento
// aconteceu há mais de 2 dias, dando margem para a equipe consultar após o evento.
//
// Agendar no Dashboard Supabase (Edge Functions → Add schedule):
//   Cron: 0 4 * * *   (todo dia às 04:00 UTC)
//
// Ou via supabase/config.toml:
//   [functions.cleanup-event-attachments]
//   schedule = "0 4 * * *"
//
// Variáveis preenchidas automaticamente pelo Supabase:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async () => {
  try {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 2)
    const cutoffDate = cutoff.toISOString().slice(0, 10)

    const { data: attachments, error: selectErr } = await sb
      .from('event_attachments')
      .select('id, storage_path')
      .lt('event_date', cutoffDate)

    if (selectErr) throw selectErr

    if (!attachments?.length) {
      return new Response(
        JSON.stringify({ deleted: 0, message: 'Nenhum anexo para limpar.' }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    const paths = attachments.map((a) => a.storage_path)
    const { error: storageErr } = await sb.storage
      .from('event-attachments')
      .remove(paths)
    if (storageErr) console.warn('[cleanup] Storage remove parcial:', storageErr.message)

    const ids = attachments.map((a) => a.id)
    const { error: deleteErr } = await sb
      .from('event_attachments')
      .delete()
      .in('id', ids)
    if (deleteErr) throw deleteErr

    console.log(`[cleanup] Deletados ${attachments.length} anexo(s) (eventos até ${cutoffDate})`)
    return new Response(
      JSON.stringify({ deleted: attachments.length, cutoff: cutoffDate }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[cleanup] Erro:', err)
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
