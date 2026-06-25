# EscalaFest v2 — Contexto do Projeto

## Visão Geral

Sistema de gestão de eventos e equipe para animadores/freelancers. Três apps:
- **Dashboard** (`Dashboard/index.html`) — painel admin, gestão de eventos, equipe, finanças, ranking
- **Logística** (`Logistica/index.html`) — despacho de motoristas, rotas, veículos
- **Motorista** (`Logistica/motorista.html`) — app do motorista para acompanhar rotas em tempo real

Todo o frontend é um único arquivo HTML com React via CDN (`@babel/standalone`). Sem bundler.

---

## Infraestrutura

| Serviço | Uso | URL |
|---|---|---|
| **Netlify** | Hospedagem do frontend | `escalafesta.netlify.app` |
| **Supabase** | Banco de dados + Auth + Edge Functions | Variável `SUPA_URL` no código |
| **Railway** | Backend Node.js (WhatsApp + Logística) | `https://scalafest-production.up.railway.app` |
| **Asaas** | Pagamentos (PIX ~1%, cartão ~1,99%) | Substitui Mercado Pago |

### Variáveis de ambiente (Railway)
```
SUPABASE_SERVICE_KEY=...   # NUNCA no frontend
ASAAS_API_KEY=...
ASAAS_WEBHOOK_SECRET=...
GOOGLE_MAPS_KEY=...
```

### Variáveis de ambiente (Supabase Edge Functions)
```
ASAAS_API_KEY=...
ASAAS_SANDBOX=true         # mudar para false em produção
ASAAS_WEBHOOK_SECRET=...
```

---

## Regras de Segurança (NUNCA violar)

1. `SUPABASE_SERVICE_KEY` — NUNCA no frontend. Somente em `.env` e Railway Variables.
2. `whatsapp-server/` — NUNCA fazer upload para o Netlify.
3. `.env` — NUNCA commitar no GitHub.

---

## Estrutura de Arquivos

```
EscalaFest v2/
├── Dashboard/
│   └── index.html          # App principal do admin
├── Logistica/
│   ├── index.html           # Painel de logística
│   └── motorista.html       # App do motorista
├── Principal/               # Landing page
├── whatsapp-server/         # Backend Node.js (Railway) — NÃO vai ao Netlify
│   └── src/
│       └── logistics/
│           └── modules/
│               └── dispatch/
│                   ├── dispatch.service.js  # Lógica de rotas/dashboard
│                   └── dispatch.repo.js     # Queries Supabase
├── supabase/
│   └── functions/
│       ├── asaas-checkout/index.ts   # Cria link de pagamento Asaas
│       └── asaas-webhook/index.ts    # Recebe confirmação de pagamento
├── netlify.toml             # Cache headers + redirects
└── CLAUDE.md                # Este arquivo
```

---

## localStorage — URL do servidor

Todos os arquivos HTML fazem migration automática de `localhost` para Railway:

```js
const WA_RAILWAY = "https://scalafest-production.up.railway.app";
const WA_SERVER_URL = (()=>{
  try {
    const saved = localStorage.getItem("wa_server_url");
    if (!saved || saved.includes("localhost") || saved.includes("127.0.0.1")) {
      localStorage.setItem("wa_server_url", WA_RAILWAY);
      return WA_RAILWAY;
    }
    return saved;
  } catch(e) { return WA_RAILWAY; }
})();
```

---

## Carregamento Mobile (`@babel/standalone`)

O `@babel/standalone` (~7MB) demora >12s em mobile. Solução implementada:
- Spinner no `#root` enquanto carrega
- Timeout de **40 segundos** (não 12s)
- Flag `window._sfAppReady = true` definida ANTES do `ReactDOM.createRoot(...).render(...)` — impede que handlers de erro/timeout disparem após o React renderizar

```js
window._sfAppReady = false;
// timeout de 40s verifica: if (!window._sfAppReady) mostrarErro(...)
window._sfAppReady = true;
ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
```

---

## Pagamentos — Asaas

### Edge Function `asaas-checkout`
- `POST /v3/paymentLinks` com `billingType: "UNDEFINED"`, `chargeType: "RECURRENT"`
- `externalReference`: `"${user_id}|${plano_id}|${anual?'anual':'mensal'}"`
- Retorna `{ checkout_url, link_id }`

### Edge Function `asaas-webhook`
- Recebe eventos `PAYMENT_CONFIRMED` / `PAYMENT_RECEIVED`
- Valida `?token=SEU_SEGREDO` contra `ASAAS_WEBHOOK_SECRET`
- Atualiza `sf_perfis`: `{ plano, plano_vencimento, plano_ativado_em }`

### Frontend — aguardarAtivacao
Após abrir o checkout, polling a cada 3s (máx 40 tentativas) na tabela `sf_perfis` até `plano === planoId`.

---

## Tabelas Supabase Relevantes

| Tabela | Uso |
|---|---|
| `sf_perfis` | Perfil do usuário, plano ativo, datas |
| `sf_pontos_encontro` | Pontos de encontro (compartilhado Dashboard ↔ Logística) |
| `sf_veiculos` | Veículos (inclui `consumo_medio` km/L) |
| `wa_sessions` | Sessões WhatsApp (SQL precisa ser rodado) |

---

## Funcionalidades Implementadas (histórico desta sessão)

### Dashboard
- **Asaas** — pagamento via PIX/cartão com `asaas-checkout` + `asaas-webhook`
- **Ranking** — aba com "Mais trabalhou no mês" + "Mais feedback dado"
  - Admin: vê os dois rankings
  - Funcionário (`modoFuncionario=true`): vê SOMENTE "Mais feedback dado"
- **Relatórios** — botão "↩ Desfazer todos pagos" com confirmação
- **Bonificação** — campo `tempoMin` por nível (antes hardcoded 180min)
- **Pontos de Encontro** — aba no CRUD do Dashboard que lê/escreve em `sf_pontos_encontro` (mesma tabela que a Logística usa)
- **PDF Cachês Pendentes** — gerado pelo modal inline (não pela função `gerarPdfCaches`); agora inclui `🎭 Função` e `📝 Observação` por evento

### Logística
- **Railway URL** — padrão correto com migração de localhost
- **Taxa de atraso** — retorna `null` (exibe `—`) quando não há rotas finalizadas (evita "0% falso")
- **KMs** — rotas com retorno (`tipo_rota !== 'ida_fica'`) contam ida+volta
- **Combustível** — usa `consumo_medio` real do veículo (fallback 12 km/L)
- **Pontos de encontro** — mesma tabela do Dashboard via `sf_pontos_encontro`

---

## Componentes Principais (Dashboard)

### `AbaRanking`
```jsx
function AbaRanking({ freelancers, eventos, adminId, modoFuncionario=false })
```
- `modoFuncionario=false` (admin): mostra "Mais trabalhou" + seletor de mês + "Mais feedback"
- `modoFuncionario=true` (funcionário): mostra SOMENTE "Mais feedback dado"

### `BONUS_INIT` / `NIVEIS_BONUS`
```js
const BONUS_INIT = [
  { id:"junior", label:"Júnior", valor:5,  cor:"#3b82f6", tempoMin:180 },
  { id:"senior", label:"Sênior", valor:10, cor:"#a855f7", tempoMin:180 },
  { id:"master", label:"Master", valor:20, cor:"#f59e0b", tempoMin:180 },
];
```
`tempoMin` é configurável por nível na aba Bonificações.

### `buildMembro` — bônus automático
```js
const nivelObj = NIVEIS_BONUS.find(n => n.id === nivelBonus);
const bonusAuto = dur > (nivelObj?.tempoMin ?? 180) && !!nivelBonus;
```

### `todos` (array de cachês)
```js
const todos = eventos.flatMap(ev =>
  (ev.equipe||[]).map((m, idx) => ({
    eventoId: ev.id, eventoNome: ev.nome, data: ev.data,
    local: ev.local||"", horaInicio: ev.horaInicio||"", horaFim: ev.horaFim||"",
    freelancer: fl(m.freelancerId), funcao: m.funcao, obs: m.obs||"",
    cache: calcCache(m,ev), cacheBase: m.cache, bonus: m.bonus,
    pago: m.pago, idx, freelancerId: m.freelancerId
  }))
).filter(r => r.freelancer);
```
`obs` foi adicionado — era omitido antes, o que impedia aparecer no PDF.

---

## Backend (whatsapp-server) — dispatch.service.js

### `kmTotal` helper
```js
const kmTotal = (r) => (r.distancia_km || 0) * (r.tipo_rota !== 'ida_fica' ? 2 : 1);
```

### `taxa_atraso`
```js
const taxa_atraso = finalizadas.length > 0
  ? Math.round(atrasos.length / finalizadas.length * 100)
  : null;  // null = sem dados ainda (frontend exibe "—")
```

### Combustível por veículo
```js
const combustivelEstimado = finalizadas.reduce((s, r) => {
  const km = kmTotal(r);
  const consumo = r.veiculo?.consumo_medio || 12;
  return s + (km / consumo);
}, 0);
```

---

## Deploy

### Netlify
- Arrastar pasta raiz (sem `whatsapp-server/`)
- `netlify.toml` já configurado com cache + redirects
- Redirects: `/dashboard` → `Dashboard/index.html`, `/logistica` → `Logistica/index.html`, `/logistica/motorista` → `Logistica/motorista.html`

### Railway
- Qualquer mudança em `whatsapp-server/` requer redeploy manual no Railway
- Arquivos relevantes: `dispatch.service.js`, `dispatch.repo.js`

### Supabase Edge Functions
```bash
supabase functions deploy asaas-checkout
supabase functions deploy asaas-webhook
```
Configurar secrets:
```bash
supabase secrets set ASAAS_API_KEY=...
supabase secrets set ASAAS_WEBHOOK_SECRET=...
supabase secrets set ASAAS_SANDBOX=false
```

---

## Pendências

- [ ] **Asaas** — criar conta, obter API key, deploy das edge functions, configurar webhook no painel Asaas
- [ ] **Supabase SQL** — rodar `CREATE TABLE wa_sessions (...)` para persistência do WhatsApp
- [ ] **Railway redeploy** — `dispatch.service.js` e `dispatch.repo.js` alterados (KMs, combustível, taxa_atraso)
- [ ] **Mobile cold-start** — Railway free tier dorme; se demorar >40s na primeira requisição, ainda pode falhar. Possível solução: ping de aquecimento ao abrir o app.
