-- ─────────────────────────────────────────────────────────────────────────────
-- events_table.sql
-- Cria tabelas events + event_team, função get_tenant_id(), RLS, índices.
-- Pré-requisito: is_gestao() já deve existir (ver gestao_tenant_fix.sql).
-- Executar no Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- Resolve tenant_id para admin (próprio uid) ou funcionário (admin_id do admin)
CREATE OR REPLACE FUNCTION get_tenant_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT admin_id FROM sf_perfis WHERE id = auth.uid() AND admin_id IS NOT NULL),
    auth.uid()
  );
$$;

-- ── TABELA events ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id              TEXT UNIQUE,             -- antigo id (numérico ou UUID) do sf_dados
  tenant_id              UUID NOT NULL,
  nome                   TEXT NOT NULL,
  tipo                   TEXT DEFAULT 'Outro',
  status                 TEXT DEFAULT 'Em negociação',
  data                   DATE NOT NULL,
  hora_inicio            TEXT,
  hora_fim               TEXT,
  local                  TEXT DEFAULT '',
  obs                    TEXT DEFAULT '',
  cliente_nome           TEXT DEFAULT '',
  cliente_telefone       TEXT DEFAULT '',
  horario_quintal        TEXT,
  horario_galpao         TEXT,
  obs_logistica          TEXT,
  google_event_id        TEXT UNIQUE,             -- null para eventos sem GCal
  google_calendar_synced BOOLEAN DEFAULT FALSE,
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

-- ── TABELA event_team ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_team (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL,
  freelancer_id     TEXT NOT NULL,             -- numérico como string (compat legado)
  funcao            TEXT DEFAULT '',
  cache_base        NUMERIC(10,2) DEFAULT 0,
  obs               TEXT DEFAULT '',
  pago              BOOLEAN DEFAULT FALSE,
  turnos            SMALLINT DEFAULT 1,
  bonus_mult_turnos BOOLEAN DEFAULT FALSE,
  bonus_nivel       TEXT,                       -- 'junior'|'senior'|'master'|null
  bonus_ativo       BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── ÍNDICES ────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS events_tenant_idx    ON events(tenant_id);
CREATE INDEX IF NOT EXISTS events_data_idx      ON events(data);
CREATE INDEX IF NOT EXISTS events_legacy_idx    ON events(legacy_id);
CREATE INDEX IF NOT EXISTS events_gcal_idx      ON events(google_event_id);
CREATE INDEX IF NOT EXISTS event_team_event_idx      ON event_team(event_id);
CREATE INDEX IF NOT EXISTS event_team_tenant_idx     ON event_team(tenant_id);
CREATE INDEX IF NOT EXISTS event_team_freelancer_idx ON event_team(freelancer_id);

-- ── TRIGGER updated_at ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _sf_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS events_updated_at ON events;
CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION _sf_set_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────────
ALTER TABLE events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_team ENABLE ROW LEVEL SECURITY;

-- events: leitura — qualquer usuário cujo tenant coincida (admin, gestão, freelancer)
DROP POLICY IF EXISTS "events_select" ON events;
CREATE POLICY "events_select" ON events
  FOR SELECT USING (tenant_id = get_tenant_id());

-- events: escrita — somente admin ou gestão (is_gestao() cobre ambos)
DROP POLICY IF EXISTS "events_insert" ON events;
CREATE POLICY "events_insert" ON events
  FOR INSERT WITH CHECK (is_gestao() AND tenant_id = get_tenant_id());

DROP POLICY IF EXISTS "events_update" ON events;
CREATE POLICY "events_update" ON events
  FOR UPDATE USING (is_gestao() AND tenant_id = get_tenant_id());

DROP POLICY IF EXISTS "events_delete" ON events;
CREATE POLICY "events_delete" ON events
  FOR DELETE USING (is_gestao() AND tenant_id = get_tenant_id());

-- event_team: mesmas regras
DROP POLICY IF EXISTS "event_team_select" ON event_team;
CREATE POLICY "event_team_select" ON event_team
  FOR SELECT USING (tenant_id = get_tenant_id());

DROP POLICY IF EXISTS "event_team_insert" ON event_team;
CREATE POLICY "event_team_insert" ON event_team
  FOR INSERT WITH CHECK (is_gestao() AND tenant_id = get_tenant_id());

DROP POLICY IF EXISTS "event_team_update" ON event_team;
CREATE POLICY "event_team_update" ON event_team
  FOR UPDATE USING (is_gestao() AND tenant_id = get_tenant_id());

DROP POLICY IF EXISTS "event_team_delete" ON event_team;
CREATE POLICY "event_team_delete" ON event_team
  FOR DELETE USING (is_gestao() AND tenant_id = get_tenant_id());
