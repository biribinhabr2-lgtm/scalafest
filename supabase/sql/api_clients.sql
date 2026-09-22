-- api_clients.sql
-- Tabela de clientes autorizados a usar a API pública de eventos.
-- Guarda apenas o hash SHA-256 da chave, nunca a chave em texto.
-- Executar no Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS api_clients (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL,
  nome         TEXT        NOT NULL,
  key_hash     TEXT        NOT NULL UNIQUE,   -- SHA-256 hex da chave (nunca a chave em texto)
  ativo        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

COMMENT ON TABLE  api_clients IS 'Clientes autorizados a consumir a API pública de eventos.';
COMMENT ON COLUMN api_clients.key_hash IS 'SHA-256 hex da chave de API. A chave em texto nunca é armazenada.';

-- Índice parcial: usado apenas no hot path de autenticação (somente clientes ativos)
CREATE INDEX IF NOT EXISTS api_clients_active_hash_idx
  ON api_clients(key_hash) WHERE ativo;

CREATE INDEX IF NOT EXISTS api_clients_tenant_idx
  ON api_clients(tenant_id);

-- RLS habilitado, sem policies de usuário normal.
-- Somente service_role (Edge Function) acessa esta tabela.
ALTER TABLE api_clients ENABLE ROW LEVEL SECURITY;
