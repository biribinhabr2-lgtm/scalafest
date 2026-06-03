# Deploy das Edge Functions Asaas

## 1. Crie sua conta Asaas
- Acesse: https://www.asaas.com  
- Crie uma conta PJ (ou PF para testes)
- Vá em **Configurações → Integrações → API**  
- Copie sua **Chave de API** (começa com `$aact_...`)

## 2. Configure as variáveis de ambiente no Supabase

Acesse: **Supabase Dashboard → seu projeto → Settings → Edge Functions → Secrets**

Adicione:
| Nome                   | Valor                                    |
|------------------------|------------------------------------------|
| `ASAAS_API_KEY`        | `$aact_xxxxxxxxxxxx` (sua chave Asaas)   |
| `ASAAS_WEBHOOK_SECRET` | qualquer string aleatória (ex: `abc123`) |
| `ASAAS_SANDBOX`        | `true` para testes, apague em produção   |

## 3. Deploy das funções via Supabase CLI

```bash
# Instale o CLI (se ainda não tiver)
npm install -g supabase

# Login
supabase login

# Link ao projeto (substitua <project-ref> pelo ID do seu projeto)
supabase link --project-ref ybnqjvucyutpdjfpkgzg

# Deploy das duas funções
supabase functions deploy asaas-checkout
supabase functions deploy asaas-webhook
```

## 4. Configure o Webhook no painel do Asaas

Acesse: **Asaas → Configurações → Integrações → Webhooks**

- **URL**: `https://ybnqjvucyutpdjfpkgzg.supabase.co/functions/v1/asaas-webhook?token=SEU_SEGREDO`  
  _(substitua SEU_SEGREDO pelo valor de `ASAAS_WEBHOOK_SECRET`)_
- **Eventos a monitorar**: ✅ `PAYMENT_CONFIRMED` e ✅ `PAYMENT_RECEIVED`

## 5. Taxas do Asaas (referência)

| Método        | Taxa            |
|---------------|-----------------|
| Cartão crédito| ~1,99% (recorr.)|
| PIX           | ~1% (mín R$0,99)|
| Boleto        | R$ 2,99/boleto  |

> Comparativo: Mercado Pago cobra ~3,49% no cartão e ~1,99% no PIX.

## 6. Sandbox para testes

- Use `ASAAS_SANDBOX=true` durante o desenvolvimento
- A URL do sandbox é `https://sandbox.asaas.com/api/v3`
- Crie conta de sandbox em: https://sandbox.asaas.com
- A chave de sandbox começa com `$aact_` (diferente da produção)
