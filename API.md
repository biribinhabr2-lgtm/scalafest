# API de Eventos — Documentação para Integração

**Versão:** 2.0  
**Protocolo:** HTTPS — REST — somente leitura (GET)  
**Autenticação:** chave de API proprietária via header

---

## URL base

```
https://ybnqjvucyutpdjfpkgzg.supabase.co/functions/v1/api-eventos
```

---

## Autenticação

Todas as requisições devem incluir o header:

```
x-api-key: <sua-chave-de-api>
```

A chave é fornecida pelo administrador do sistema. Requisições sem chave ou com chave inválida recebem `401 Unauthorized`.

**Importante:** a chave identifica o cliente e o tenant (conjunto de dados). Não é necessário informar tenant ID separadamente.

---

## Endpoints

### `GET /api-eventos/eventos`

Lista eventos do tenant no período especificado.

#### Parâmetros de query

| Parâmetro | Tipo   | Padrão            | Descrição                                          |
|-----------|--------|-------------------|----------------------------------------------------|
| `de`      | string | hoje (horário SP) | Data de início do período — `YYYY-MM-DD`           |
| `ate`     | string | hoje + 60 dias    | Data de fim do período — `YYYY-MM-DD`              |
| `status`  | string | —                 | Filtro de status (ex: `Confirmado`, `Cancelado`)   |
| `incluir` | string | —                 | Passe `escala` para incluir a equipe em cada evento |
| `limit`   | int    | 50                | Itens por página (1–200)                           |
| `page`    | int    | 1                 | Número da página (começa em 1)                     |

A janela máxima entre `de` e `ate` é 365 dias.

#### Resposta (200 OK)

```json
{
  "data": [ <evento>, ... ],
  "total": 38,
  "page": 1,
  "limit": 50,
  "pages": 1,
  "periodo": {
    "de": "2026-09-22",
    "ate": "2026-11-21"
  }
}
```

---

### `GET /api-eventos/eventos/:id`

Retorna um evento com a escala completa.

`:id` deve ser um UUID no formato `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.

#### Resposta (200 OK)

```json
{
  "data": <evento-com-escala>
}
```

Retorna `404 Not Found` se o evento não existir ou pertencer a outro tenant.

---

## Objeto `evento`

| Campo        | Tipo            | Descrição                                              |
|--------------|-----------------|--------------------------------------------------------|
| `id`         | UUID            | Identificador único do evento                          |
| `nome`       | string          | Título do evento (título original quando disponível)   |
| `status`     | string \| null  | Ex: `"Confirmado"`, `"Em negociação"`, `"Cancelado"`   |
| `data`       | string          | Data do evento — `YYYY-MM-DD` no fuso America/Sao_Paulo|
| `hora_inicio`| string \| null  | Horário de início — `HH:MM`                            |
| `hora_fim`   | string \| null  | Horário de término — `HH:MM`                           |
| `local`      | string \| null  | Endereço ou nome do local                              |
| `obs`        | string \| null  | Observações gerais                                     |
| `cliente`    | string \| null  | Nome do cliente / contratante                          |
| `servicos`   | array           | Serviços reconhecidos (ver abaixo)                     |
| `escala`     | array \| —      | Equipe escalada — presente no detalhe e na lista com `?incluir=escala` |

### Objeto `servico` (dentro de `servicos`)

| Campo        | Tipo           | Descrição                          |
|--------------|----------------|------------------------------------|
| `nome`       | string         | Nome do serviço                    |
| `duracao_min`| int \| null    | Duração estimada em minutos        |

### Objeto `membro` (dentro de `escala`)

| Campo         | Tipo                                    | Descrição             |
|---------------|-----------------------------------------|-----------------------|
| `nome`        | string \| null                          | Nome do profissional  |
| `funcao`      | string \| null                          | Função no evento      |
| `confirmacao` | `"confirmado"` \| `"recusou"` \| `"pendente"` | Status de confirmação |

**Campos não expostos:** cachê, bônus, status de pagamento, telefone, e-mail ou qualquer dado financeiro.

---

## Paginação

```
GET /api-eventos/eventos?limit=20&page=2
```

```json
{
  "data": [...],
  "total": 85,
  "page": 2,
  "limit": 20,
  "pages": 5
}
```

---

## CORS

Se o seu app faz requisições diretamente do browser, informe ao administrador do sistema a(s) origem(ns) que precisam de acesso. O header `x-api-key` é suficiente para chamadas servidor-a-servidor (sem restrições de CORS).

---

## Erros

Todos os erros retornam JSON com os campos `code` e `message`:

```json
{
  "code": "unauthorized",
  "message": "Chave de API inválida ou inativa."
}
```

| Status HTTP | `code`              | Quando ocorre                              |
|-------------|---------------------|--------------------------------------------|
| 400         | `invalid_param`     | Parâmetro inválido (data, limit, etc.)     |
| 401         | `unauthorized`      | Chave ausente, inválida ou inativa         |
| 404         | `not_found`         | Evento não encontrado ou de outro tenant   |
| 405         | `method_not_allowed`| Método diferente de GET                    |
| 500         | `internal_error`    | Erro interno (sem detalhes expostos)       |

---

## Exemplos cURL

### Listar eventos dos próximos 30 dias

```bash
curl -H "x-api-key: SUA_CHAVE_AQUI" \
  "https://ybnqjvucyutpdjfpkgzg.supabase.co/functions/v1/api-eventos/eventos?de=2026-09-22&ate=2026-10-22"
```

### Listar eventos confirmados com a escala

```bash
curl -H "x-api-key: SUA_CHAVE_AQUI" \
  "https://ybnqjvucyutpdjfpkgzg.supabase.co/functions/v1/api-eventos/eventos?status=Confirmado&incluir=escala"
```

### Detalhe de um evento específico

```bash
curl -H "x-api-key: SUA_CHAVE_AQUI" \
  "https://ybnqjvucyutpdjfpkgzg.supabase.co/functions/v1/api-eventos/eventos/550e8400-e29b-41d4-a716-446655440000"
```

### Paginação

```bash
curl -H "x-api-key: SUA_CHAVE_AQUI" \
  "https://ybnqjvucyutpdjfpkgzg.supabase.co/functions/v1/api-eventos/eventos?limit=20&page=2"
```

---

## Exemplo de resposta completa

```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "nome": "Aniversário 10 anos Mariana",
      "status": "Confirmado",
      "data": "2026-10-05",
      "hora_inicio": "14:00",
      "hora_fim": "18:00",
      "local": "Espaço Girassol — Rua das Flores, 120",
      "obs": null,
      "cliente": "Ana Paula Souza",
      "servicos": [
        { "nome": "Cinderela", "duracao_min": 30 },
        { "nome": "Recreação Infantil", "duracao_min": 120 }
      ],
      "escala": [
        { "nome": "Juliana Mendes", "funcao": "Personagem", "confirmacao": "confirmado" },
        { "nome": "Rafael Costa",  "funcao": "Recreador",  "confirmacao": "pendente"   }
      ]
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 50,
  "pages": 1,
  "periodo": { "de": "2026-10-01", "ate": "2026-10-31" }
}
```

---

## Limites e boas práticas

- **Janela máxima:** 365 dias por requisição
- **Itens por página:** máximo 200
- **Rate limit:** definido pela infra Supabase Edge Functions
- Recomendamos fazer polling com intervalo mínimo de 60 segundos; para sincronização em tempo real, solicite um webhook

---

## Suporte e provisionamento de chaves

Para obter uma chave de API, renovar uma chave existente ou revogar acesso, entre em contato com o administrador do sistema.
