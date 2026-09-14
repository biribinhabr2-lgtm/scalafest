import { createClient } from "npm:@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

async function getValidAccessToken(tokenRow: any): Promise<string> {
  if (new Date(tokenRow.token_expiry) > new Date()) {
    return tokenRow.access_token
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: tokenRow.refresh_token,
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      grant_type: "refresh_token",
    }),
  })
  const data = await res.json()
  await supabase.from("google_calendar_tokens").update({
    access_token: data.access_token,
    token_expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  }).eq("tenant_id", tokenRow.tenant_id)
  return data.access_token
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS })

  // Chamada manual: POST { tenant_id: "uuid" }
  // Chamada via cron: sem body — sincroniza todos os tenants ativos
  const body = req.method === "POST"
    ? await req.json().catch(() => ({}))
    : {}

  let query = supabase.from("google_calendar_tokens").select("*").eq("sync_enabled", true)
  if (body.tenant_id) query = query.eq("tenant_id", body.tenant_id)

  const { data: tokens } = await query

  if (!tokens?.length) {
    return new Response(
      JSON.stringify({ synced: 0, created: 0, updated: 0 }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    )
  }

  let created = 0
  let updated = 0

  for (const tokenRow of tokens) {
    try {
      const accessToken = await getValidAccessToken(tokenRow)

      const timeMin = new Date().toISOString()
      const daysAhead = tokenRow.sync_days_ahead ?? 60
      const timeMax = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString()

      const calRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
        new URLSearchParams({
          timeMin,
          timeMax,
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "200",
        }),
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )

      const calData = await calRes.json()
      const items: any[] = calData.items || []

      if (calRes.status !== 200) {
        return new Response(
          JSON.stringify({ error: "calendar_api_error", status: calRes.status, detail: calData }),
          { headers: { ...CORS, "Content-Type": "application/json" } }
        )
      }

      // Ler eventos atuais do sf_dados
      const { data: dadosRow, error: dadosError } = await supabase
        .from("sf_dados")
        .select("dados")
        .eq("user_id", tokenRow.tenant_id)
        .eq("tipo", "eventos")
        .maybeSingle()

      if (dadosError) {
        console.error(`[sync-gcal] Erro ao ler sf_dados para tenant ${tokenRow.tenant_id}:`, dadosError)
        continue // Nunca sobrescrever se a leitura falhou
      }

      // Se dadosRow é null (sem erro mas sem linha) e o tenant já foi sincronizado antes,
      // a linha deveria existir — abortar para não sobrescrever com lista vazia.
      if (dadosRow === null && tokenRow.last_synced_at) {
        console.error(`[sync-gcal] dadosRow não encontrado para tenant ${tokenRow.tenant_id} que já tinha histórico de sync — abortando para prevenir perda de dados`)
        continue
      }

      const eventosExistentes: any[] = Array.isArray(dadosRow?.dados) ? dadosRow.dados : []
      const eventos: any[] = [...eventosExistentes]

      for (const ev of items) {
        if (ev.status === "cancelled" || !ev.summary) continue

        const startRaw = ev.start?.dateTime ?? ev.start?.date
        const endRaw = ev.end?.dateTime ?? ev.end?.date
        if (!startRaw) continue

        const { data: ignoredRow } = await supabase
          .from("google_calendar_ignored")
          .select("id")
          .eq("tenant_id", tokenRow.tenant_id)
          .eq("google_event_id", ev.id)
          .maybeSingle()
        if (ignoredRow) continue

        const data = startRaw.substring(0, 10)
        const horaInicio = startRaw.length > 10 ? startRaw.substring(11, 16) : null
        const horaFim = endRaw?.length > 10 ? endRaw.substring(11, 16) : null

        const existingIdx = eventos.findIndex(
          (e: any) => e.google_event_id === ev.id
        )

        if (existingIdx === -1) {
          eventos.push({
            id: crypto.randomUUID(),
            nome: ev.summary,
            data,
            horaInicio,
            horaFim,
            tipo: "Outro",
            status: "Em negociação",
            local: "",
            obs: "",
            equipe: [],
            google_event_id: ev.id,
            google_calendar_synced: true,
          })
          created++
        } else {
          // Atualiza apenas campos do Calendar — nunca toca em status/tipo/local/equipe
          eventos[existingIdx] = {
            ...eventos[existingIdx],
            nome: ev.summary,
            data,
            horaInicio,
            horaFim,
          }
          updated++
        }
      }

      // Proteção: o array final nunca pode ser menor que o original
      // (o sync só adiciona/atualiza eventos, nunca remove)
      if (eventos.length < eventosExistentes.length) {
        console.error(`[sync-gcal] Abortando save — eventos passariam de ${eventosExistentes.length} para ${eventos.length} (tenant ${tokenRow.tenant_id})`)
        continue
      }

      // Salvar de volta no sf_dados
      await supabase.from("sf_dados").upsert(
        {
          user_id: tokenRow.tenant_id,
          tipo: "eventos",
          dados: eventos,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,tipo" }
      )

      await supabase.from("google_calendar_tokens").update({
        last_synced_at: new Date().toISOString(),
      }).eq("tenant_id", tokenRow.tenant_id)

    } catch (err) {
      console.error(`Erro ao sincronizar tenant ${tokenRow.tenant_id}:`, err)
    }
  }

  return new Response(
    JSON.stringify({ synced: tokens.length, created, updated }),
    { headers: { ...CORS, "Content-Type": "application/json" } }
  )
})
