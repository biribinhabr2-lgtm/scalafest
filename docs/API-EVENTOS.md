# API de Eventos — EscalaFest

API REST somente-leitura para consulta de eventos, equipe escalada e checklist.
Destinada ao uso interno entre setores da empresa.

## URL Base

```
https://ybnqjvucyutpdjfpkgzg.supabase.co/functions/v1/api-eventos
```

---

## Autenticação

Todas as requisições (exceto `OPTIONS`) exigem o header:

```
x-api-key: SUA_CHAVE
```

A chave é gerada uma única vez e entregue ao setor consumidor. Se vazar, basta trocar o secret `EVENTOS_API_KEY` no Supabase e redeployar — sem alterar código.

**Sem a chave ou com chave errada:**
```json
HTTP 401
{ "error": "unauthorized" }
```

---

## Endpoints

### `GET /api-eventos` — Lista de eventos

Retorna eventos dentro de um período. Todos os parâmetros são opcionais.

| Parâmetro | Tipo | Padrão | Descrição |
|-----------|------|--------|-----------|
| `from` | `YYYY-MM-DD` | Hoje | Início do período |
| `to` | `YYYY-MM-DD` | Hoje + 30 dias | Fim do período |
| `status` | string | — | Filtra por status (ex: `Confirmado`, `Em Negociação`) |

**Restrição:** janela máxima de 90 dias. Janelas maiores retornam `400`.

---

### `GET /api-eventos?id=<uuid>` — Evento específico

Retorna um único evento pelo ID. Ignora `from`, `to` e `status`.

**Evento não encontrado:**
```json
HTTP 404
{ "error": "not_found" }
```

---

## Formato de Resposta

```json
{
  "eventos": [
    {
      "id": "abc123",
      "nome": "Cinderela 1h",
      "tipo": "Aniversário Infantil",
      "status": "Confirmado",
      "data": "2026-07-25",
      "inicio": "21:10",
      "fim": "22:10",
      "local": "Chicaboom",
      "observacoes": "Tema azul e branco",
      "logistica": {
        "horario_quintal": "19:30",
        "horario_galpao": null,
        "obs": "Levar fantasia X"
      },
      "equipe": [
        {
          "nome": "Giovana Ferreira Assunção",
          "funcao": "Líder - 4h",
          "turnos": 1,
          "confirmacao": "confirmado"
        },
        {
          "nome": "Thiago Costa",
          "funcao": "Auxiliar",
          "turnos": 2,
          "confirmacao": "pendente"
        }
      ],
      "checklist": {
        "checklist": [
          { "descricao": "Confirmar equipe", "obs": null, "concluido": true }
        ],
        "material": [
          { "descricao": "Caixa de som", "obs": "JBL do galpão", "concluido": false }
        ],
        "figurino": [
          { "descricao": "Fantasia Cinderela", "obs": "Galpão Araruama, prateleira 3", "concluido": true }
        ]
      }
    }
  ],
  "total": 1,
  "periodo": { "from": "2026-07-22", "to": "2026-08-21" }
}
```

> **Nota:** `periodo` é omitido quando `id` é usado.

### Campos do evento

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string | Identificador único do evento |
| `nome` | string | Nome do evento |
| `tipo` | string\|null | Tipo (ex: "Aniversário Infantil") |
| `status` | string\|null | Status (ex: "Confirmado", "Em Negociação") |
| `data` | `YYYY-MM-DD` | Data do evento |
| `inicio` | `HH:MM`\|null | Hora de início |
| `fim` | `HH:MM`\|null | Hora de término |
| `local` | string\|null | Local do evento |
| `observacoes` | string\|null | Observações gerais |
| `logistica` | objeto\|null | Horários de saída dos pontos de encontro; `null` se não preenchido |
| `equipe` | array | Membros escalados (ver abaixo) |
| `checklist` | objeto | Itens por categoria (ver abaixo) |

### Campos de `equipe[]`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `nome` | string | Nome do membro |
| `funcao` | string\|null | Função no evento |
| `turnos` | number | Quantidade de turnos (padrão 1) |
| `confirmacao` | string | `"pendente"`, `"confirmado"` ou `"recusou"` |

> Membros sem conta de acesso ao app sempre aparecem como `"pendente"`.

### Campos de `checklist`

Cada categoria (`checklist`, `material`, `figurino`) é um array de itens:

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `descricao` | string | Descrição do item |
| `obs` | string\|null | Observação adicional |
| `concluido` | boolean | Se o item foi marcado como concluído |

---

## Erros

Todos os erros retornam JSON.

| Status | `error` | Situação |
|--------|---------|----------|
| `400` | `invalid_param` | Datas malformadas ou janela > 90 dias |
| `401` | `unauthorized` | Header `x-api-key` ausente ou inválido |
| `404` | `not_found` | ID inexistente |
| `405` | `method_not_allowed` | Método diferente de `GET` |
| `500` | `db_error` | Erro interno de banco |
| `500` | `server_misconfigured` | Secret `EVENTOS_API_TENANT_ID` não configurado |

---

## Exemplos

### curl

```bash
# Eventos dos próximos 30 dias (padrão)
curl "https://ybnqjvucyutpdjfpkgzg.supabase.co/functions/v1/api-eventos" \
  -H "x-api-key: SUA_CHAVE"

# Período específico
curl "https://ybnqjvucyutpdjfpkgzg.supabase.co/functions/v1/api-eventos?from=2026-07-22&to=2026-07-31" \
  -H "x-api-key: SUA_CHAVE"

# Apenas confirmados
curl "https://ybnqjvucyutpdjfpkgzg.supabase.co/functions/v1/api-eventos?from=2026-08-01&to=2026-08-31&status=Confirmado" \
  -H "x-api-key: SUA_CHAVE"

# Evento específico por ID
curl "https://ybnqjvucyutpdjfpkgzg.supabase.co/functions/v1/api-eventos?id=abc123" \
  -H "x-api-key: SUA_CHAVE"
```

### JavaScript (fetch)

```js
const BASE = 'https://ybnqjvucyutpdjfpkgzg.supabase.co/functions/v1/api-eventos'
const KEY  = 'SUA_CHAVE'

// Próximos 30 dias
const res = await fetch(BASE, { headers: { 'x-api-key': KEY } })
const { eventos, total, periodo } = await res.json()

// Semana específica
const semana = await fetch(`${BASE}?from=2026-07-28&to=2026-08-03`, {
  headers: { 'x-api-key': KEY },
}).then(r => r.json())

// Evento por ID
const evento = await fetch(`${BASE}?id=abc123`, {
  headers: { 'x-api-key': KEY },
}).then(r => r.json())
```

---

## Deploy e Configuração

### 1. Gerar a API key

```bash
# Gera uma chave aleatória de 32 bytes em hex
openssl rand -hex 32
```

### 2. Configurar os secrets

```bash
supabase secrets set EVENTOS_API_KEY="chave_gerada_acima"
supabase secrets set EVENTOS_API_TENANT_ID="uuid-do-admin"
```

O `EVENTOS_API_TENANT_ID` é o `auth.uid()` do admin no Supabase (visível em **Authentication → Users**).

### 3. Fazer o deploy

```bash
supabase functions deploy api-eventos --no-verify-jwt
```

`--no-verify-jwt` é obrigatório: a autenticação é feita pela `x-api-key`, não pelo JWT do Supabase.

### 4. Entregar a chave ao consumidor

Passe **apenas** a chave gerada no passo 1. A URL base e o header `x-api-key` são suficientes para começar a usar.

---

## O que a API não expõe

- Cachês e valores financeiros
- Bônus e pagamentos
- Telefones e e-mails da equipe
- Dados de clientes (telefone, etc.)
- Informações de outros tenants (isolamento garantido por `EVENTOS_API_TENANT_ID`)
