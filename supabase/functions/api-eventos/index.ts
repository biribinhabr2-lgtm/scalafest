// supabase/functions/api-eventos/index.ts
//
// API REST somente-leitura — expõe eventos e escala para apps externos.
//
// Autenticação: header x-api-key  →  hash SHA-256 comparado em api_clients.
// Tenant: lido de api_clients.tenant_id (multi-tenant, uma chave por cliente).
//
// Variáveis de ambiente:
//   SUPABASE_URL              — preenchida automaticamente pelo Supabase
//   SUPABASE_SERVICE_ROLE_KEY — preenchida automaticamente pelo Supabase
//   ALLOWED_ORIGINS           — origens CORS permitidas, separadas por vírgula
//                               ex: "https://app.parceiro.com,https://outro.app.com"
//                               Deixe vazio para bloquear todo acesso de browser.
//
// Deploy:
//   supabase functions deploy api-eventos --no-verify-jwt

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Helpers puros (exportados para testes) ───────────────────────────────────

export async function sha256hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T12:00:00Z'))
}

export function getConfStatus(conf: unknown): 'confirmado' | 'recusou' | 'pendente' {
  if (!conf || typeof conf !== 'object') return 'pendente'
  const c = conf as Record<string, unknown>
  if (c.status === 'confirmed') return 'confirmado'
  if (c.status === 'declined')  return 'recusou'
  if (c.confirmado === true)    return 'confirmado'
  return 'pendente'
}

export function resolveCorsHeaders(
  origin: string | null,
  allowedOrigins: string[],
): Record<string, string> {
  const base: Record<string, string> = {
    'Access-Control-Allow-Headers': 'x-api-key, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  }
  // Sem Origin header → chamada server-to-server, sem restrição CORS
  if (!origin) return base
  // Sem origens configuradas → bloqueia todo acesso de browser
  if (allowedOrigins.length === 0) return base
  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    return { ...base, 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' }
  }
  return base
}

// ── Utilitários internos ─────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

function todayBRT(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

function jsonResp(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function apiError(
  code: string,
  message: string,
  status: number,
  cors: Record<string, string>,
): Response {
  return jsonResp({ code, message }, status, cors)
}

// ── Handler principal (exportado para testes) ─────────────────────────────────

export async function processRequest(req: Request, sbOverride?: any): Promise<Response> {
  const origin = req.headers.get('origin')
  const rawOrigins = Deno.env.get('ALLOWED_ORIGINS') ?? ''
  const allowedOrigins = rawOrigins.split(',').map(s => s.trim()).filter(Boolean)
  const cors = resolveCorsHeaders(origin, allowedOrigins)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (req.method !== 'GET') {
    return apiError('method_not_allowed', 'Apenas GET é suportado.', 405, cors)
  }

  // ── Autenticação ────────────────────────────────────────────────────────────
  const apiKey = req.headers.get('x-api-key')?.trim()
  if (!apiKey) {
    return apiError('unauthorized', 'Header x-api-key é obrigatório.', 401, cors)
  }

  const sb = sbOverride ?? createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const keyHash = await sha256hex(apiKey)

  const { data: apiClient, error: clientErr } = await sb
    .from('api_clients')
    .select('id, tenant_id')
    .eq('key_hash', keyHash)
    .eq('ativo', true)
    .maybeSingle()

  if (clientErr) {
    console.error('[api-eventos] auth error:', clientErr.message)
    return apiError('internal_error', 'Erro interno.', 500, cors)
  }

  if (!apiClient) {
    return apiError('unauthorized', 'Chave de API inválida ou inativa.', 401, cors)
  }

  // Atualiza last_used_at sem bloquear resposta
  sb.from('api_clients')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', apiClient.id)
    .then(() => {}, (e: Error) => console.warn('[api-eventos] last_used_at update failed:', e?.message))

  const tenantId: string = apiClient.tenant_id

  // ── Roteamento ──────────────────────────────────────────────────────────────
  const url = new URL(req.url)
  const stripped = url.pathname.replace(/^\/functions\/v1\/api-eventos\/?/, '')
  const parts = stripped ? stripped.split('/').filter(Boolean) : []

  if (parts[0] !== 'eventos') {
    return apiError(
      'not_found',
      'Rota desconhecida. Endpoints disponíveis: GET /api-eventos/eventos e GET /api-eventos/eventos/:id',
      404,
      cors,
    )
  }

  if (parts.length === 2) {
    return handleDetail(url, sb, tenantId, parts[1], cors)
  }

  return handleList(url, sb, tenantId, cors)
}

// ── GET /api-eventos/eventos ─────────────────────────────────────────────────

async function handleList(
  url: URL,
  sb: any,
  tenantId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const deParam      = url.searchParams.get('de')
  const ateParam     = url.searchParams.get('ate')
  const statusParam  = url.searchParams.get('status')
  const incluirParam = url.searchParams.get('incluir') // 'escala'
  const limitParam   = url.searchParams.get('limit')
  const pageParam    = url.searchParams.get('page')

  if (deParam && !isValidDate(deParam)) {
    return apiError('invalid_param', 'Parâmetro "de" deve ser YYYY-MM-DD.', 400, cors)
  }
  if (ateParam && !isValidDate(ateParam)) {
    return apiError('invalid_param', 'Parâmetro "ate" deve ser YYYY-MM-DD.', 400, cors)
  }

  const today = todayBRT()
  const de    = deParam  ?? today
  const ate   = ateParam ?? addDays(today, 60)

  if (de > ate) {
    return apiError('invalid_param', '"de" deve ser anterior ou igual a "ate".', 400, cors)
  }

  const diffDays =
    (new Date(ate + 'T12:00:00Z').getTime() - new Date(de + 'T12:00:00Z').getTime()) /
    86_400_000

  if (diffDays > 365) {
    return apiError('invalid_param', 'Janela máxima é 365 dias.', 400, cors)
  }

  let limit = 50
  let page  = 1

  if (limitParam !== null) {
    limit = parseInt(limitParam, 10)
    if (isNaN(limit) || limit < 1 || limit > 200) {
      return apiError('invalid_param', '"limit" deve ser inteiro entre 1 e 200.', 400, cors)
    }
  }
  if (pageParam !== null) {
    page = parseInt(pageParam, 10)
    if (isNaN(page) || page < 1) {
      return apiError('invalid_param', '"page" deve ser inteiro >= 1.', 400, cors)
    }
  }

  const offset = (page - 1) * limit

  // Contagem total (para paginação)
  let countQ: any = sb
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .gte('data', de)
    .lte('data', ate)
  if (statusParam) countQ = countQ.eq('status', statusParam)

  const { count, error: countErr } = await countQ
  if (countErr) {
    console.error('[api-eventos] count error:', countErr.message)
    return apiError('internal_error', 'Erro interno ao consultar eventos.', 500, cors)
  }

  // Página de eventos
  let evQ: any = sb
    .from('events')
    .select(
      'id, nome, tipo, status, data, hora_inicio, hora_fim, local, obs, ' +
      'cliente_nome, titulo_original, cliente, duracao_total_min',
    )
    .eq('tenant_id', tenantId)
    .gte('data', de)
    .lte('data', ate)
    .order('data', { ascending: true })
    .order('hora_inicio', { ascending: true, nullsFirst: true })
    .range(offset, offset + limit - 1)
  if (statusParam) evQ = evQ.eq('status', statusParam)

  const { data: evList, error: evErr } = await evQ
  if (evErr) {
    console.error('[api-eventos] list error:', evErr.message)
    return apiError('internal_error', 'Erro interno ao consultar eventos.', 500, cors)
  }

  const events   = evList ?? []
  const eventIds = events.map((e: any) => e.id)

  const [servicosMap, escalaMap] = await Promise.all([
    loadServicos(sb, eventIds),
    incluirParam === 'escala' && eventIds.length > 0
      ? loadEscala(sb, tenantId, events, eventIds)
      : Promise.resolve(null),
  ])

  const data = events.map((ev: any) =>
    formatEvento(ev, servicosMap, escalaMap?.get(ev.id) ?? null),
  )

  return jsonResp(
    {
      data,
      total:   count ?? 0,
      page,
      limit,
      pages:   Math.ceil((count ?? 0) / limit),
      periodo: { de, ate },
    },
    200,
    cors,
  )
}

// ── GET /api-eventos/eventos/:id ─────────────────────────────────────────────

async function handleDetail(
  _url: URL,
  sb: any,
  tenantId: string,
  eventId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
    return apiError('invalid_param', 'ID de evento deve ser um UUID válido.', 400, cors)
  }

  const { data: ev, error: evErr } = await sb
    .from('events')
    .select(
      'id, nome, tipo, status, data, hora_inicio, hora_fim, local, obs, ' +
      'cliente_nome, titulo_original, cliente, duracao_total_min',
    )
    .eq('id', eventId)
    .eq('tenant_id', tenantId)   // isola tenant → null se for de outro tenant
    .maybeSingle()

  if (evErr) {
    console.error('[api-eventos] detail error:', evErr.message)
    return apiError('internal_error', 'Erro interno ao consultar evento.', 500, cors)
  }

  if (!ev) {
    return apiError('not_found', 'Evento não encontrado.', 404, cors)
  }

  const [servicosMap, escalaMap] = await Promise.all([
    loadServicos(sb, [ev.id]),
    loadEscala(sb, tenantId, [ev], [ev.id]),
  ])

  return jsonResp(
    { data: formatEvento(ev, servicosMap, escalaMap.get(ev.id) ?? null) },
    200,
    cors,
  )
}

// ── Loaders ──────────────────────────────────────────────────────────────────

async function loadServicos(
  sb: any,
  eventIds: string[],
): Promise<Map<string, Array<{ nome: string; duracao_min: number | null }>>> {
  if (eventIds.length === 0) return new Map()

  const { data, error } = await sb
    .from('event_services')
    .select('event_id, nome_bruto, duracao_min, services(nome)')
    .in('event_id', eventIds)
    .order('ordem', { ascending: true })

  if (error) {
    console.warn('[api-eventos] event_services error:', error.message)
    return new Map()
  }

  const map = new Map<string, Array<{ nome: string; duracao_min: number | null }>>()
  for (const row of (data ?? []) as any[]) {
    const nome = (row.services as any)?.nome ?? row.nome_bruto
    if (!map.has(row.event_id)) map.set(row.event_id, [])
    map.get(row.event_id)!.push({ nome, duracao_min: row.duracao_min ?? null })
  }
  return map
}

async function loadEscala(
  sb: any,
  tenantId: string,
  events: any[],
  eventIds: string[],
): Promise<Map<string, any[]>> {
  if (eventIds.length === 0) return new Map()

  const { data: teamRows, error: teamErr } = await sb
    .from('event_team')
    .select('event_id, freelancer_id, funcao')
    .in('event_id', eventIds)

  if (teamErr) {
    console.warn('[api-eventos] event_team error:', teamErr.message)
    return new Map()
  }

  const flIds = [...new Set((teamRows ?? []).map((r: any) => String(r.freelancer_id)))]
  if (flIds.length === 0) return new Map()

  const { data: flRow, error: flErr } = await sb
    .from('sf_dados')
    .select('dados')
    .eq('user_id', tenantId)
    .eq('tipo', 'freelancers')
    .maybeSingle()

  if (flErr) console.warn('[api-eventos] freelancers error:', flErr.message)

  const allFl: any[] = flRow?.dados ?? []
  const flById = new Map(allFl.map((f: any) => [String(f.id), f]))

  const userIds = [
    ...new Set(
      allFl
        .filter((f: any) => f.userId && flIds.includes(String(f.id)))
        .map((f: any) => f.userId as string),
    ),
  ]

  const confByUserId = new Map<string, any>()
  if (userIds.length > 0) {
    const { data: confRows, error: confErr } = await sb
      .from('sf_dados')
      .select('user_id, dados')
      .in('user_id', userIds)
      .eq('tipo', 'confirmacoes')

    if (confErr) console.warn('[api-eventos] confirmacoes error:', confErr.message)

    for (const row of (confRows ?? []) as any[]) {
      confByUserId.set(row.user_id, row.dados ?? {})
    }
  }

  const evById = new Map(events.map((e: any) => [e.id, e]))
  const result = new Map<string, any[]>()

  for (const row of (teamRows ?? []) as any[]) {
    const fl = flById.get(String(row.freelancer_id))
    if (!fl) continue

    let confirmacao: 'confirmado' | 'recusou' | 'pendente' = 'pendente'
    if (fl.userId) {
      const cfms = confByUserId.get(fl.userId)
      if (cfms) {
        const ev = evById.get(row.event_id)
        const confEntry = cfms[row.event_id] ?? (ev?.legacy_id ? cfms[ev.legacy_id] : undefined)
        confirmacao = getConfStatus(confEntry)
      }
    }

    if (!result.has(row.event_id)) result.set(row.event_id, [])
    result.get(row.event_id)!.push({
      nome:        fl.nome        ?? null,
      funcao:      row.funcao     ?? null,
      confirmacao,
    })
  }

  return result
}

// ── Formatação ────────────────────────────────────────────────────────────────

function formatEvento(
  ev: any,
  servicosMap: Map<string, Array<{ nome: string; duracao_min: number | null }>>,
  escala: any[] | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id:          ev.id,
    nome:        ev.titulo_original ?? ev.nome,
    status:      ev.status      ?? null,
    data:        ev.data,
    hora_inicio: ev.hora_inicio ?? null,
    hora_fim:    ev.hora_fim    ?? null,
    local:       ev.local       ?? null,
    obs:         ev.obs         ?? null,
    cliente:     ev.cliente     ?? ev.cliente_nome ?? null,
    servicos:    servicosMap.get(ev.id) ?? [],
  }
  if (escala !== null) out.escala = escala
  return out
}

// ── Entry point ───────────────────────────────────────────────────────────────
// import.meta.main é true somente quando este arquivo é o entry point
// (deno run index.ts / Edge Function runtime).
// Quando importado por index.test.ts, é false — serve() não é chamado.

if (import.meta.main) {
  serve(processRequest)
}
