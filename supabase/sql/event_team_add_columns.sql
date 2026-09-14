-- ─────────────────────────────────────────────────────────────────────────────
-- event_team_add_columns.sql
-- Adiciona colunas faltantes à event_team (tabela criada sem o schema completo).
-- Seguro rodar mesmo que algumas colunas já existam (IF NOT EXISTS).
--
-- Executar no Supabase SQL Editor, depois:
--   Database → API → "Reload Schema" (ou aguardar ~1 min)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE event_team
  ADD COLUMN IF NOT EXISTS cache_base        NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS obs               TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS pago              BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS turnos            SMALLINT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS bonus_mult_turnos BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS bonus_nivel       TEXT,
  ADD COLUMN IF NOT EXISTS bonus_ativo       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_at        TIMESTAMPTZ DEFAULT NOW();

-- Confirmar resultado:
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'event_team'
ORDER BY ordinal_position;
