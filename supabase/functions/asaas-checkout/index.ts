// supabase/functions/asaas-checkout/index.ts
// Cria um link de pagamento no Asaas e retorna a URL de checkout.
// Variáveis de ambiente necessárias (Supabase → Settings → Edge Functions):
//   ASAAS_API_KEY      — chave da API Asaas (começa com $aact_...)
//   ASAAS_SANDBOX      — "true" para ambiente de testes, omita em produção

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS })
  }

  try {
    const {
      plano_id,
      plano_nome,
      plano_preco,
      plano_desc,
      user_id,
      anual,
    } = await req.json()

    const ASAAS_KEY = Deno.env.get('ASAAS_API_KEY')
    if (!ASAAS_KEY) throw new Error('ASAAS_API_KEY não configurada nas variáveis de ambiente.')

    const ASAAS_API =
      Deno.env.get('ASAAS_SANDBOX') === 'true'
        ? 'https://sandbox.asaas.com/api/v3'
        : 'https://api.asaas.com/v3'

    // externalReference permite que o webhook identifique qual usuário e plano pagou
    const externalReference = `${user_id}|${plano_id}|${anual ? 'anual' : 'mensal'}`

    const payload = {
      name: `EscalaFest — ${plano_nome}`,
      description: plano_desc || `Plano ${plano_nome} — ${anual ? 'Assinatura anual' : 'Assinatura mensal'}`,
      endDate: '2030-12-31',
      value: plano_preco,
      billingType: 'UNDEFINED',       // aceita PIX e cartão de crédito
      chargeType: 'RECURRENT',
      subscriptionCycle: anual ? 'YEARLY' : 'MONTHLY',
      maxInstallmentCount: 1,
      notificationEnabled: true,
      externalReference,
    }

    const res = await fetch(`${ASAAS_API}/paymentLinks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'access_token': ASAAS_KEY,
        'User-Agent': 'EscalaFest/1.0',
      },
      body: JSON.stringify(payload),
    })

    const data = await res.json()

    if (!res.ok) {
      const msg =
        data?.errors?.[0]?.description ||
        data?.description ||
        JSON.stringify(data)
      throw new Error(`Asaas: ${msg}`)
    }

    if (!data.url) throw new Error('Asaas não retornou URL de checkout.')

    return new Response(
      JSON.stringify({ checkout_url: data.url, link_id: data.id }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[asaas-checkout]', err)
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
