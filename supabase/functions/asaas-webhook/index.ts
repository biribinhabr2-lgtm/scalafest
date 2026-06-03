// supabase/functions/asaas-webhook/index.ts
// Recebe eventos de pagamento do Asaas e ativa o plano do usuário no Supabase.
//
// Configure no painel do Asaas (Configurações → Integrações → Webhooks):
//   URL: https://<seu-projeto>.supabase.co/functions/v1/asaas-webhook?token=SEU_SEGREDO
//   Eventos: PAYMENT_CONFIRMED, PAYMENT_RECEIVED
//
// Variáveis de ambiente necessárias:
//   SUPABASE_URL              — preenchida automaticamente pelo Supabase
//   SUPABASE_SERVICE_ROLE_KEY — preenchida automaticamente pelo Supabase
//   ASAAS_WEBHOOK_SECRET      — segredo para validar requisições (qualquer string aleatória)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  // ── Valida token de segurança ───────────────────────────────────────────
  const WEBHOOK_SECRET = Deno.env.get('ASAAS_WEBHOOK_SECRET')
  if (WEBHOOK_SECRET) {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    if (token !== WEBHOOK_SECRET) {
      console.warn('[asaas-webhook] Token inválido — requisição rejeitada.')
      return new Response('Unauthorized', { status: 401 })
    }
  }

  try {
    const body = await req.json()
    const { event, payment } = body

    console.log(`[asaas-webhook] event=${event} ref=${payment?.externalReference}`)

    // Processa apenas pagamentos confirmados/recebidos
    if (!['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'].includes(event)) {
      return new Response('OK', { status: 200 })
    }

    const externalRef: string = payment?.externalReference ?? ''
    if (!externalRef) {
      console.warn('[asaas-webhook] Pagamento sem externalReference — ignorado.')
      return new Response('OK', { status: 200 })
    }

    // Formato: "userId|planoId|periodo"  (criado em asaas-checkout)
    const [userId, planoId, period] = externalRef.split('|')
    if (!userId || !planoId) {
      console.warn('[asaas-webhook] externalReference inválido:', externalRef)
      return new Response('OK', { status: 200 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Calcula data de vencimento
    const now = new Date()
    const vencimento = new Date(now)
    if (period === 'anual') {
      vencimento.setFullYear(vencimento.getFullYear() + 1)
    } else {
      vencimento.setMonth(vencimento.getMonth() + 1)
    }

    const { error } = await supabase
      .from('sf_perfis')
      .update({
        plano: planoId,
        plano_vencimento: vencimento.toISOString(),
        plano_ativado_em: now.toISOString(),
      })
      .eq('id', userId)

    if (error) throw error

    console.log(
      `[asaas-webhook] ✅ Plano "${planoId}" ativado para user ${userId} até ${vencimento.toISOString()}`
    )
    return new Response('OK', { status: 200 })

  } catch (err) {
    console.error('[asaas-webhook] Erro:', err)
    // Retorna 200 para o Asaas não tentar reenviar em erros de lógica interna
    return new Response('Internal Error', { status: 500 })
  }
})
