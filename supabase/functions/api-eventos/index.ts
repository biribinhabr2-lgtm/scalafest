// supabase/functions/api-eventos/index.ts
//
// API REST somente-leitura para consumo externo de dados de eventos.
// Autenticação: header x-api-key com a chave em EVENTOS_API_KEY.
// Tenant fixo: EVENTOS_API_TENANT_ID (UUID do admin dono dos dados).
//
// Não expõe: cachês, valores financeiros, bônus, pagamentos,
//            telefones ou e-mails da equipe.
//
// Variáveis de ambiente necessárias (supabase secrets set ...):
//   SUPABASE_URL              — preenchida automaticamente pelo Supabase
//   SUPABASE_SERVICE_ROLE_KEY — preenchida automaticamente pelo Supabase
//   EVENTOS_API_KEY           — chave aleatória entregue ao setor consumidor
//   EVENTOS_API_TENANT_ID     — UUID do admin (auth.uid) dono dos dados
//
// Deploy:
//   supabase functions deploy api-eventos --no-verify-jwt

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// CORS aberto: leitura de dados não-sensíveis protegida por API key,
// sem cookies — Access-Control-Allow-Credentials não é necessário.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-api-key, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'))
}

// Normaliza confirmação: suporta formato antigo { confirmado: true }
// e novo { status: 'confirmed' | 'declined' }.
function getConfStatus(conf: any): 'confirmado' | 'recusou' | 'pendente' {
  if (!conf) return 'pendente'
  if (conf.status === 'confirmed') return 'confirmado'
  if (conf.status === 'declined') return 'recusou'
  if (conf.confirmado) return 'confirmado'
  return 'pendente'
}

serve(async (req) => {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  if (req.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  // ── Autenticação ────────────────────────────────────────────────────────────

  const apiKey = req.headers.get('x-api-key')
  const expectedKey = Deno.env.get('EVENTOS_API_KEY')
  if (!apiKey || !expectedKey || apiKey !== expectedKey) {
    return json({ error: 'unauthorized' }, 401)
  }

  const tenantId = Deno.env.get('EVENTOS_API_TENANT_ID')
  if (!tenantId) {
    console.error('[api-eventos] EVENTOS_API_TENANT_ID não configurado')
    return json({ error: 'server_misconfigured' }, 500)
  }

  // ── Parâmetros ──────────────────────────────────────────────────────────────

  const url = new URL(req.url)
  const idParam     = url.searchParams.get('id')
  const fromParam   = url.searchParams.get('from')
  const toParam     = url.searchParams.get('to')
  const statusParam = url.searchParams.get('status')

  if (fromParam && !isValidDate(fromParam)) {
    return json({ error: 'invalid_param', detail: 'from deve ser YYYY-MM-DD' }, 400)
  }
  if (toParam && !isValidDate(toParam)) {
    return json({ error: 'invalid_param', detail: 'to deve ser YYYY-MM-DD' }, 400)
  }

  const today    = new Date().toISOString().split('T')[0]
  const fromDate = fromParam || today
  const toDate   = toParam   || addDays(today, 30)

  if (!idParam) {
    const diffDays =
      (new Date(toDate + 'T00:00:00Z').getTime() - new Date(fromDate + 'T00:00:00Z').getTime()) /
      (1000 * 60 * 60 * 24)

    if (diffDays < 0) {
      return json({ error: 'invalid_param', detail: 'from deve ser anterior ou igual a to' }, 400)
    }
    if (diffDays > 90) {
      return json({ error: 'invalid_param', detail: 'Janela máxima é 90 dias' }, 400)
    }
  }

  // ── Dados base (eventos + freelancers) ──────────────────────────────────────

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const [evRes, flRes] = await Promise.all([
    supabase
      .from('sf_dados')
      .select('dados')
      .eq('user_id', tenantId)
      .eq('tipo', 'eventos')
      .maybeSingle(),
    supabase
      .from('sf_dados')
      .select('dados')
      .eq('user_id', tenantId)
      .eq('tipo', 'freelancers')
      .maybeSingle(),
  ])

  if (evRes.error) {
    console.error('[api-eventos] Erro ao carregar eventos:', evRes.error.message)
    return json({ error: 'db_error' }, 500)
  }

  const allEvents: any[]      = evRes.data?.dados || []
  const allFreelancers: any[] = flRes.data?.dados || []
  const flById = new Map<number, any>(allFreelancers.map((f: any) => [f.id, f]))

  // ── Filtrar eventos ─────────────────────────────────────────────────────────

  let events: any[]

  if (idParam) {
    events = allEvents.filter(ev => ev.id === idParam)
    if (!events.length) return json({ error: 'not_found' }, 404)
  } else {
    events = allEvents.filter(ev => {
      if (!ev.data) return false
      if (ev.data < fromDate || ev.data > toDate) return false
      if (statusParam) {
        // Comparação case-insensitive; espaços → underscore
        const normalize = (s: string) => (s || '').toLowerCase().replace(/\s+/g, '_')
        if (normalize(ev.status) !== normalize(statusParam)) return false
      }
      return true
    })
    events.sort(
      (a, b) =>
        a.data.localeCompare(b.data) ||
        (a.horaInicio || '').localeCompare(b.horaInicio || ''),
    )
  }

  // ── Carregar event_items e confirmações em paralelo ─────────────────────────

  const eventIds = events.map(ev => ev.id)

  // IDs de usuário dos freelancers que aparecem nos eventos filtrados
  const flIdsInEvents = new Set<number>(
    events.flatMap(ev => (ev.equipe || []).map((m: any) => m.freelancerId)),
  )
  const uniqueUserIds = [
    ...new Set(
      allFreelancers
        .filter((f: any) => f.userId && flIdsInEvents.has(f.id))
        .map((f: any) => f.userId as string),
    ),
  ]

  const [itemsRes, confRes] = await Promise.all([
    eventIds.length > 0
      ? supabase
          .from('event_items')
          .select('event_id, categoria, descricao, obs, concluido')
          .eq('tenant_id', tenantId)
          .in('event_id', eventIds)
          .order('ordem', { ascending: true })
      : Promise.resolve({ data: [] as any[], error: null }),

    uniqueUserIds.length > 0
      ? supabase
          .from('sf_dados')
          .select('user_id, dados')
          .in('user_id', uniqueUserIds)
          .eq('tipo', 'confirmacoes')
      : Promise.resolve({ data: [] as any[], error: null }),
  ])

  // Itens por evento
  const itemsByEvent = new Map<string, any[]>()
  for (const item of itemsRes.data || []) {
    if (!itemsByEvent.has(item.event_id)) itemsByEvent.set(item.event_id, [])
    itemsByEvent.get(item.event_id)!.push(item)
  }

  // Confirmações por userId do freelancer
  const confByUserId = new Map<string, any>()
  for (const row of confRes.data || []) {
    confByUserId.set(row.user_id, row.dados || {})
  }

  // ── Montar resposta ─────────────────────────────────────────────────────────

  const responseEvents = events.map(ev => {
    const evItems = itemsByEvent.get(ev.id) || []

    const equipe = (ev.equipe || [])
      .map((m: any) => {
        const fl = flById.get(m.freelancerId)
        if (!fl) return null // freelancer removido — omite da equipe

        let confirmacao: 'pendente' | 'confirmado' | 'recusou' = 'pendente'
        if (fl.userId) {
          const cfms = confByUserId.get(fl.userId)
          if (cfms) confirmacao = getConfStatus(cfms[ev.id])
        }

        return {
          nome: fl.nome,
          funcao: m.funcao ?? null,
          turnos: m.turnos || 1,
          confirmacao,
        }
      })
      .filter(Boolean)

    const makeItems = (cat: string) =>
      evItems
        .filter(i => i.categoria === cat)
        .map(i => ({
          descricao: i.descricao,
          obs: i.obs ?? null,
          concluido: !!i.concluido,
        }))

    const logisticaObj = {
      horario_quintal: ev.horarioQuintal ?? null,
      horario_galpao:  ev.horarioGalpao  ?? null,
      obs:             ev.obsLogistica   ?? null,
    }
    const temLogistica = !!(ev.horarioQuintal || ev.horarioGalpao || ev.obsLogistica)

    return {
      id:          ev.id,
      nome:        ev.nome,
      tipo:        ev.tipo   ?? null,
      status:      ev.status ?? null,
      data:        ev.data,
      inicio:      ev.horaInicio ?? null,
      fim:         ev.horaFim    ?? null,
      local:       ev.local      ?? null,
      observacoes: ev.obs        ?? null,
      logistica:   temLogistica ? logisticaObj : null,
      equipe,
      checklist: {
        checklist: makeItems('checklist'),
        material:  makeItems('material'),
        figurino:  makeItems('figurino'),
      },
    }
  })

  // Resposta por ID não inclui periodo
  if (idParam) {
    return json({ eventos: responseEvents, total: 1 })
  }

  return json({
    eventos: responseEvents,
    total:   responseEvents.length,
    periodo: { from: fromDate, to: toDate },
  })
})
