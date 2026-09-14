-- ─────────────────────────────────────────────────────────────────────────────
-- events_add_columns.sql
-- Adiciona colunas faltantes à tabela events (criada sem o schema completo).
-- Seguro rodar mesmo que algumas já existam (IF NOT EXISTS).
-- Após rodar: PostgREST recarrega o schema automaticamente via NOTIFY.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS cliente_nome       TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS cliente_telefone   TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS horario_quintal    TEXT,
  ADD COLUMN IF NOT EXISTS horario_galpao     TEXT,
  ADD COLUMN IF NOT EXISTS obs_logistica      TEXT,
  ADD COLUMN IF NOT EXISTS hora_inicio        TEXT,
  ADD COLUMN IF NOT EXISTS hora_fim           TEXT,
  ADD COLUMN IF NOT EXISTS google_event_id    TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS google_calendar_synced BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ DEFAULT NOW();

-- Recarrega o schema cache do PostgREST imediatamente
NOTIFY pgrst, 'reload schema';

-- Confirmar resultado:
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'events'
ORDER BY ordinal_position;
