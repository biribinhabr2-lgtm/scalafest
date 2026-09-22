// supabase/functions/api-eventos/index.test.ts
//
// Testes unitários e de integração local para a Edge Function api-eventos.
//
// Executar:
//   deno test --allow-env supabase/functions/api-eventos/index.test.ts

import {
  assertEquals,
  assertFalse,
  assertNotEquals,
} from 'https://deno.land/std@0.168.0/testing/asserts.ts'

import {
  sha256hex,
  isValidDate,
  getConfStatus,
  resolveCorsHeaders,
  processRequest,
} from './_handler.ts'

// ── Mock do Supabase client ───────────────────────────────────────────────────
//
// makeSB recebe um mapa { tableName: resultado | [resultado, ...] }.
// Cada chamada a .from(table) consome o próximo resultado da fila.
// Quando a fila se esgota, o último item é reutilizado.
// Suporta .maybeSingle(), .single() e await direto (thenable).

class MockChain implements PromiseLike<any> {
  private result: any
  constructor(result: any) { this.result = result }

  // Todos os métodos de encadeamento retornam this
  select(_cols?: any, _opts?: any) { return this }
  eq(_col?: any, _val?: any)       { return this }
  gte(_col?: any, _val?: any)      { return this }
  lte(_col?: any, _val?: any)      { return this }
  in(_col?: any, _vals?: any)      { return this }
  order(_col?: any, _opts?: any)   { return this }
  range(_from?: any, _to?: any)    { return this }
  update(_data?: any)              { return this }
  insert(_data?: any)              { return this }

  maybeSingle() { return Promise.resolve(this.result) }
  single()      { return Promise.resolve(this.result) }

  then<T>(onfulfilled: (v: any) => T, onrejected?: (e: any) => T) {
    return Promise.resolve(this.result).then(onfulfilled, onrejected)
  }
}

function makeSB(tables: Record<string, any | any[]>) {
  const queues: Record<string, any[]>  = {}
  const cursors: Record<string, number> = {}
  for (const [k, v] of Object.entries(tables)) {
    queues[k] = Array.isArray(v) ? v : [v]
  }
  return {
    from(table: string) {
      if (!(table in cursors)) cursors[table] = 0
      const q   = queues[table] ?? [{ data: null, error: null }]
      const idx = cursors[table]
      cursors[table] = Math.min(idx + 1, q.length - 1) + (idx < q.length - 1 ? 0 : 1)
      return new MockChain(q[Math.min(idx, q.length - 1)])
    },
  }
}

// Chave de teste (32 bytes zero → sha256 conhecido)
const TEST_KEY      = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
const TENANT_ID     = '11111111-1111-1111-1111-111111111111'
const CLIENT_ID     = '22222222-2222-2222-2222-222222222222'
const EVENT_UUID    = '33333333-3333-3333-3333-333333333333'
const OTHER_TENANT  = '44444444-4444-4444-4444-444444444444'

const AUTH_OK   = { data: { id: CLIENT_ID, tenant_id: TENANT_ID }, error: null }
const AUTH_FAIL = { data: null, error: null }

function makeReq(path: string, headers: Record<string, string> = {}): Request {
  return new Request(
    `https://example.com/functions/v1/api-eventos${path}`,
    { headers: { 'x-api-key': TEST_KEY, ...headers } },
  )
}

// ── Testes de helpers puros ───────────────────────────────────────────────────

Deno.test('sha256hex — hash correto para string vazia', async () => {
  const h = await sha256hex('')
  assertEquals(h, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
})

Deno.test('sha256hex — produz string hex de 64 caracteres', async () => {
  const h = await sha256hex('hello world')
  assertEquals(h.length, 64)
  assertEquals(/^[0-9a-f]+$/.test(h), true)
})

Deno.test('isValidDate — aceita datas válidas', () => {
  assertEquals(isValidDate('2025-01-15'), true)
  assertEquals(isValidDate('2026-12-31'), true)
})

Deno.test('isValidDate — rejeita formatos inválidos', () => {
  assertFalse(isValidDate('2025-1-5'))
  assertFalse(isValidDate('15/01/2025'))
  assertFalse(isValidDate('not-a-date'))
  assertFalse(isValidDate('2025-13-01'))
})

Deno.test('getConfStatus — confirmado por status "confirmed"', () => {
  assertEquals(getConfStatus({ status: 'confirmed' }), 'confirmado')
})

Deno.test('getConfStatus — recusou por status "declined"', () => {
  assertEquals(getConfStatus({ status: 'declined' }), 'recusou')
})

Deno.test('getConfStatus — confirmado por campo legado "confirmado: true"', () => {
  assertEquals(getConfStatus({ confirmado: true }), 'confirmado')
})

Deno.test('getConfStatus — pendente para null, undefined, objeto vazio', () => {
  assertEquals(getConfStatus(null), 'pendente')
  assertEquals(getConfStatus(undefined), 'pendente')
  assertEquals(getConfStatus({}), 'pendente')
})

Deno.test('resolveCorsHeaders — sem Origin → sem cabeçalho ACAO', () => {
  const h = resolveCorsHeaders(null, ['https://app.exemplo.com'])
  assertEquals(h['Access-Control-Allow-Origin'], undefined)
})

Deno.test('resolveCorsHeaders — origem permitida → retorna a origem', () => {
  const h = resolveCorsHeaders('https://app.exemplo.com', ['https://app.exemplo.com'])
  assertEquals(h['Access-Control-Allow-Origin'], 'https://app.exemplo.com')
})

Deno.test('resolveCorsHeaders — origem não permitida → sem cabeçalho ACAO', () => {
  const h = resolveCorsHeaders('https://outro.com', ['https://app.exemplo.com'])
  assertEquals(h['Access-Control-Allow-Origin'], undefined)
})

Deno.test('resolveCorsHeaders — lista vazia → bloqueia browser', () => {
  const h = resolveCorsHeaders('https://qualquer.com', [])
  assertEquals(h['Access-Control-Allow-Origin'], undefined)
})

// ── Testes do handler ─────────────────────────────────────────────────────────

Deno.test('chave ausente → 401', async () => {
  const sb  = makeSB({ api_clients: AUTH_FAIL })
  const req = new Request(
    'https://example.com/functions/v1/api-eventos/eventos',
    // Sem header x-api-key
  )
  const res  = await processRequest(req, sb)
  assertEquals(res.status, 401)
  const body = await res.json()
  assertEquals(body.code, 'unauthorized')
})

Deno.test('chave inválida → 401', async () => {
  const sb  = makeSB({ api_clients: AUTH_FAIL })
  const req = makeReq('/eventos', { 'x-api-key': 'chave-invalida-qualquer' })
  const res  = await processRequest(req, sb)
  assertEquals(res.status, 401)
  const body = await res.json()
  assertEquals(body.code, 'unauthorized')
})

Deno.test('método não permitido → 405', async () => {
  const sb  = makeSB({ api_clients: AUTH_OK })
  const req = new Request(
    'https://example.com/functions/v1/api-eventos/eventos',
    { method: 'POST', headers: { 'x-api-key': TEST_KEY } },
  )
  const res = await processRequest(req, sb)
  assertEquals(res.status, 405)
})

Deno.test('preflight OPTIONS → 204 sem body', async () => {
  const sb  = makeSB({})
  const req = new Request(
    'https://example.com/functions/v1/api-eventos/eventos',
    { method: 'OPTIONS', headers: { origin: 'https://app.parceiro.com' } },
  )
  const res = await processRequest(req, sb)
  assertEquals(res.status, 204)
  assertEquals(await res.text(), '')
})

Deno.test('evento de outro tenant retorna 404', async () => {
  // Mock: auth OK (tenant A), mas busca do evento retorna null
  // (como se fosse de outro tenant ou não existisse)
  const sb = makeSB({
    api_clients:    AUTH_OK,
    events:         { data: null, error: null },
    event_services: { data: [],   error: null },
  })
  const req = makeReq(`/eventos/${EVENT_UUID}`)
  const res  = await processRequest(req, sb)
  assertEquals(res.status, 404)
  const body = await res.json()
  assertEquals(body.code, 'not_found')
})

Deno.test('detalhe de evento não expõe campos financeiros', async () => {
  const mockEvent = {
    id:          EVENT_UUID,
    nome:        'Festa Junina',
    tipo:        'Animação',
    status:      'Confirmado',
    data:        '2026-06-15',
    hora_inicio: '14:00',
    hora_fim:    '18:00',
    local:       'Salão das Palmeiras',
    obs:         null,
    cliente_nome:     'Família Silva',
    titulo_original:  null,
    cliente:          null,
    duracao_total_min: 240,
    // Campos financeiros NÃO devem aparecer na resposta
    cache_base:   500,
    pago:         false,
    bonus_ativo:  true,
    bonus_nivel:  'senior',
  }

  const sb = makeSB({
    api_clients:    AUTH_OK,
    events:         { data: mockEvent,                error: null },
    event_services: { data: [],                       error: null },
    event_team:     { data: [],                       error: null },
    sf_dados:       { data: { dados: [] },            error: null },
  })

  const req = makeReq(`/eventos/${EVENT_UUID}`)
  const res  = await processRequest(req, sb)
  assertEquals(res.status, 200)

  const body = await res.json()
  const ev   = body.data

  // Campos esperados
  assertEquals(ev.id,          EVENT_UUID)
  assertEquals(ev.nome,        'Festa Junina')
  assertEquals(ev.data,        '2026-06-15')
  assertEquals(ev.hora_inicio, '14:00')
  assertEquals(ev.local,       'Salão das Palmeiras')

  // Campos financeiros ausentes
  assertEquals(ev.cache_base,       undefined)
  assertEquals(ev.pago,             undefined)
  assertEquals(ev.bonus_ativo,      undefined)
  assertEquals(ev.bonus_nivel,      undefined)
  assertEquals(ev.bonus_mult_turnos,undefined)
  assertEquals(ev.cache,            undefined)
})

Deno.test('filtro de período — "de" inválido retorna 400', async () => {
  const sb  = makeSB({ api_clients: AUTH_OK })
  const req = makeReq('/eventos?de=15-06-2026')
  const res  = await processRequest(req, sb)
  assertEquals(res.status, 400)
  const body = await res.json()
  assertEquals(body.code, 'invalid_param')
})

Deno.test('filtro de período — "ate" < "de" retorna 400', async () => {
  const sb  = makeSB({ api_clients: AUTH_OK })
  const req = makeReq('/eventos?de=2026-06-15&ate=2026-06-01')
  const res  = await processRequest(req, sb)
  assertEquals(res.status, 400)
  const body = await res.json()
  assertEquals(body.code, 'invalid_param')
})

Deno.test('filtro de período — janela acima de 365 dias retorna 400', async () => {
  const sb  = makeSB({ api_clients: AUTH_OK })
  const req = makeReq('/eventos?de=2025-01-01&ate=2026-12-31')
  const res  = await processRequest(req, sb)
  assertEquals(res.status, 400)
  const body = await res.json()
  assertEquals(body.code, 'invalid_param')
})

Deno.test('paginação — resposta contém total, page, limit, pages', async () => {
  const sb = makeSB({
    api_clients: AUTH_OK,
    events: [
      { count: 120, error: null },            // contagem
      { data: [], error: null },              // lista vazia (página 3 além dos dados)
    ],
  })
  const req = makeReq('/eventos?de=2026-01-01&ate=2026-03-31&limit=25&page=3')
  const res  = await processRequest(req, sb)
  assertEquals(res.status, 200)

  const body = await res.json()
  assertEquals(body.page,  3)
  assertEquals(body.limit, 25)
  assertEquals(body.total, 120)
  assertEquals(body.pages, 5)          // ceil(120/25) = 5
  assertEquals(Array.isArray(body.data), true)
  assertNotEquals(body.periodo, undefined)
})

Deno.test('paginação — limit acima de 200 retorna 400', async () => {
  const sb  = makeSB({ api_clients: AUTH_OK })
  const req = makeReq('/eventos?limit=201')
  const res  = await processRequest(req, sb)
  assertEquals(res.status, 400)
})

Deno.test('?incluir=escala na lista traz campo escala em cada evento', async () => {
  const mockEv = {
    id: EVENT_UUID, nome: 'Show', tipo: 'Show', status: 'Confirmado',
    data: '2026-07-10', hora_inicio: '20:00', hora_fim: '23:00',
    local: 'Teatro', obs: null, cliente_nome: 'Promotora X',
    titulo_original: null, cliente: null, duracao_total_min: 180,
  }
  const sb = makeSB({
    api_clients:    AUTH_OK,
    events: [
      { count: 1, error: null },
      { data: [mockEv], error: null },
    ],
    event_services: { data: [], error: null },
    event_team: {
      data: [{ event_id: EVENT_UUID, freelancer_id: '42', funcao: 'Animador' }],
      error: null,
    },
    sf_dados: [
      { data: { dados: [{ id: 42, nome: 'Ana Lima', userId: null }] }, error: null },
    ],
  })

  const req = makeReq('/eventos?de=2026-07-01&ate=2026-07-31&incluir=escala')
  const res  = await processRequest(req, sb)
  assertEquals(res.status, 200)

  const body = await res.json()
  assertEquals(body.data.length, 1)
  assertEquals(Array.isArray(body.data[0].escala), true)
  assertEquals(body.data[0].escala[0].nome,   'Ana Lima')
  assertEquals(body.data[0].escala[0].funcao, 'Animador')
  // Campos financeiros ausentes na escala
  assertEquals(body.data[0].escala[0].cache_base, undefined)
  assertEquals(body.data[0].escala[0].pago,       undefined)
})

Deno.test('UUID inválido no detalhe retorna 400', async () => {
  const sb  = makeSB({ api_clients: AUTH_OK })
  const req = makeReq('/eventos/nao-e-um-uuid')
  const res  = await processRequest(req, sb)
  assertEquals(res.status, 400)
  const body = await res.json()
  assertEquals(body.code, 'invalid_param')
})

Deno.test('rota inexistente retorna 404', async () => {
  const sb  = makeSB({ api_clients: AUTH_OK })
  const req = makeReq('/outra-rota')
  const res  = await processRequest(req, sb)
  assertEquals(res.status, 404)
})

Deno.test('detalhe com escala — confirmação via legado', async () => {
  const LEGACY_ID = 'legado-123'
  const mockEv = {
    id: EVENT_UUID, legacy_id: LEGACY_ID,
    nome: 'Aniversário', tipo: 'Festa', status: 'Confirmado',
    data: '2026-08-20', hora_inicio: '15:00', hora_fim: '19:00',
    local: 'Casa', obs: null, cliente_nome: 'Sr. Pedro',
    titulo_original: null, cliente: null, duracao_total_min: 240,
  }
  const sb = makeSB({
    api_clients: AUTH_OK,
    events:      { data: mockEv, error: null },
    event_services: { data: [], error: null },
    event_team: {
      data: [{ event_id: EVENT_UUID, freelancer_id: '7', funcao: 'DJ' }],
      error: null,
    },
    sf_dados: [
      // freelancers
      { data: { dados: [{ id: 7, nome: 'Carlos DJ', userId: 'user-7' }] }, error: null },
      // confirmações (indexadas pelo legacy_id)
      { data: [{ user_id: 'user-7', dados: { [LEGACY_ID]: { confirmado: true } } }], error: null },
    ],
  })

  const req = makeReq(`/eventos/${EVENT_UUID}`)
  const res  = await processRequest(req, sb)
  assertEquals(res.status, 200)

  const body = await res.json()
  assertEquals(body.data.escala[0].confirmacao, 'confirmado')
})
