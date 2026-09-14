-- ============================================================
-- MIGRATION: Events relational schema
-- 2026-09-12
--
-- Cria as tabelas relacionais para substituir o blob JSON
-- de eventos em sf_dados (tipo='eventos').
--
-- ESTA MIGRATION É APENAS SCHEMA — nenhum dado é migrado aqui.
-- A migração de dados (sf_dados → events + event_team) é um
-- script separado a ser executado após validar este schema.
--
-- PREREQUISITOS (devem existir antes de rodar):
--   • is_gestao()     — função criada em event_items.sql
--   • get_tenant_id() — função criada em gestao_tenant_fix.sql
--   • sf_perfis       — tabela de perfis de usuário
--   • event_items     — tabela de checklist/material/figurino
--   • event_attachments — tabela de anexos
-- ============================================================


-- ── 1. Tabela events ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS events (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant isolamento: aponta para o admin dono do evento
  tenant_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- IDs legados: o JSON usa Date.now() ("1777917259625") para eventos antigos
  -- e crypto.randomUUID() para os mais recentes.
  -- legacy_id preserva o valor original para que event_items.event_id e
  -- event_attachments.event_id (TEXT) continuem casando após a migração.
  legacy_id          TEXT        UNIQUE,

  -- Campos do evento
  nome               TEXT        NOT NULL,
  tipo               TEXT
                       CHECK (tipo IN (
                         'Aniversário Infantil',
                         'Aniversário Adulto',
                         'Corporativo',
                         'Escolar',
                         'Casamento',
                         'Formatura',
                         'Outro'
                       )),
  data               DATE        NOT NULL,
  hora_inicio        TIME,
  hora_fim           TIME,
  local              TEXT,
  obs                TEXT,
  status             TEXT        NOT NULL DEFAULT 'Confirmado'
                       CHECK (status IN ('Confirmado', 'Em negociação', 'Cancelado')),

  -- Integração Google Calendar
  google_event_id    TEXT,
  google_calendar_id TEXT,    -- reservado para integração multi-calendário (não existe ainda no app)

  -- Campos do JSON sem coluna própria:
  --   google_calendar_synced  boolean   → dados_extras->>'google_calendar_synced'
  -- (updatedAt do JSON → updated_at; equipe[] → event_team)
  dados_extras       JSONB,

  -- true = evento reconstruído a partir de backup histórico (restore_eventos)
  recuperado         BOOLEAN     NOT NULL DEFAULT false,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices principais
CREATE INDEX IF NOT EXISTS idx_events_tenant_data
  ON events (tenant_id, data);

CREATE INDEX IF NOT EXISTS idx_events_tenant_status
  ON events (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_events_google_event_id
  ON events (google_event_id)
  WHERE google_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_legacy_id
  ON events (legacy_id)
  WHERE legacy_id IS NOT NULL;


-- ── 2. Tabela event_team ─────────────────────────────────────
-- Corresponde ao array `equipe` dentro de cada evento JSON.

CREATE TABLE IF NOT EXISTS event_team (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,

  -- ID numérico do freelancer no JSON (ex: "1634789012345").
  -- Os freelancers ainda vivem em sf_dados com IDs numéricos gerados por
  -- Date.now(). Manter TEXT por enquanto; uma migration futura adicionará
  -- freelancer_uuid UUID referenciando a tabela de freelancers quando ela
  -- for extraída do blob.
  freelancer_id      TEXT        NOT NULL,

  funcao             TEXT,
  cache              NUMERIC(10, 2),          -- cachê base por turno (R$)

  -- Bônus: o JSON guarda { nivel: "junior"|"senior"|"master", ativo: boolean }
  -- ou null (sem bônus configurado). Desmembrado em duas colunas.
  bonus_nivel        TEXT
                       CHECK (bonus_nivel IN ('junior', 'senior', 'master')),
  bonus_ativo        BOOLEAN     NOT NULL DEFAULT false,

  -- Multiplicação do bônus por número de turnos
  bonus_mult_turnos  BOOLEAN     NOT NULL DEFAULT false,

  -- Número de turnos trabalhados no evento (padrão 1)
  turnos             INTEGER     NOT NULL DEFAULT 1
                       CHECK (turnos BETWEEN 1 AND 10),

  obs                TEXT,
  pago               BOOLEAN     NOT NULL DEFAULT false,

  -- Reserva para campos futuros sem impacto de schema
  dados_extras       JSONB,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_team_event_id
  ON event_team (event_id);

CREATE INDEX IF NOT EXISTS idx_event_team_freelancer_id
  ON event_team (freelancer_id);


-- ── 3. Trigger updated_at em events ──────────────────────────

CREATE OR REPLACE FUNCTION update_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS events_updated_at_trigger ON events;
CREATE TRIGGER events_updated_at_trigger
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE PROCEDURE update_events_updated_at();


-- ── 4. RLS ────────────────────────────────────────────────────

ALTER TABLE events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_team ENABLE ROW LEVEL SECURITY;


-- ── events: Admin (CRUD total nos próprios eventos) ───────────

CREATE POLICY "events_admin" ON events
  FOR ALL
  USING    (tenant_id = auth.uid())
  WITH CHECK (tenant_id = auth.uid());


-- ── events: Gestão (CRUD total nos eventos do admin vinculado) ─

CREATE POLICY "events_gestao_select" ON events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM sf_perfis
      WHERE sf_perfis.id       = auth.uid()
        AND sf_perfis.admin_id = events.tenant_id
        AND sf_perfis.nivel_acesso = 'gestao'
    )
  );

CREATE POLICY "events_gestao_insert" ON events
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sf_perfis
      WHERE sf_perfis.id       = auth.uid()
        AND sf_perfis.admin_id = events.tenant_id
        AND sf_perfis.nivel_acesso = 'gestao'
    )
  );

CREATE POLICY "events_gestao_update" ON events
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM sf_perfis
      WHERE sf_perfis.id       = auth.uid()
        AND sf_perfis.admin_id = events.tenant_id
        AND sf_perfis.nivel_acesso = 'gestao'
    )
  );

CREATE POLICY "events_gestao_delete" ON events
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM sf_perfis
      WHERE sf_perfis.id       = auth.uid()
        AND sf_perfis.admin_id = events.tenant_id
        AND sf_perfis.nivel_acesso = 'gestao'
    )
  );


-- ── events: Secretaria (SELECT — vê a agenda, não edita) ──────

CREATE POLICY "events_secretaria_select" ON events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM sf_perfis
      WHERE sf_perfis.id       = auth.uid()
        AND sf_perfis.admin_id = events.tenant_id
        AND sf_perfis.role     = 'secretario'
    )
  );


-- ── events: Freelancer ────────────────────────────────────────
-- Freelancers precisam ver os eventos em que estão escalados.
-- O vínculo entre auth.uid() (UUID do usuário) e freelancer_id
-- (ID numérico em event_team) passa por uma coluna userId gravada
-- no blob de freelancers em sf_dados — não há mapeamento direto
-- via FK ainda.
--
-- Policy adiada para quando freelancers também forem extraídos
-- para tabela relacional com coluna user_id UUID.
-- Até lá, o AppFuncionario continua lendo via sf_dados.


-- ── event_team: Admin ─────────────────────────────────────────

CREATE POLICY "event_team_admin" ON event_team
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id        = event_team.event_id
        AND events.tenant_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id        = event_team.event_id
        AND events.tenant_id = auth.uid()
    )
  );


-- ── event_team: Gestão ────────────────────────────────────────

CREATE POLICY "event_team_gestao_select" ON event_team
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      JOIN sf_perfis p ON p.admin_id = e.tenant_id
      WHERE e.id    = event_team.event_id
        AND p.id    = auth.uid()
        AND p.nivel_acesso = 'gestao'
    )
  );

CREATE POLICY "event_team_gestao_insert" ON event_team
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      JOIN sf_perfis p ON p.admin_id = e.tenant_id
      WHERE e.id    = event_team.event_id
        AND p.id    = auth.uid()
        AND p.nivel_acesso = 'gestao'
    )
  );

CREATE POLICY "event_team_gestao_update" ON event_team
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM events e
      JOIN sf_perfis p ON p.admin_id = e.tenant_id
      WHERE e.id    = event_team.event_id
        AND p.id    = auth.uid()
        AND p.nivel_acesso = 'gestao'
    )
  );

CREATE POLICY "event_team_gestao_delete" ON event_team
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM events e
      JOIN sf_perfis p ON p.admin_id = e.tenant_id
      WHERE e.id    = event_team.event_id
        AND p.id    = auth.uid()
        AND p.nivel_acesso = 'gestao'
    )
  );


-- ── event_team: Secretaria (SELECT) ──────────────────────────

CREATE POLICY "event_team_secretaria_select" ON event_team
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      JOIN sf_perfis p ON p.admin_id = e.tenant_id
      WHERE e.id  = event_team.event_id
        AND p.id  = auth.uid()
        AND p.role = 'secretario'
    )
  );


-- ── 5. FK de event_items e event_attachments → events ────────
--
-- Contexto: ambas as tabelas usam event_id TEXT (sem FK real),
-- pois o app grava IDs numéricos de evento diretamente.
-- Adicionamos event_uuid UUID nullable para ser populado pelo
-- script de migração de dados; a coluna TEXT original fica intacta.
--
-- ⚠ DIAGNÓSTICO DE ÓRFÃOS — execute APÓS migrar dados em events:
--
--   -- Itens cujo event_id não casa com nenhum evento migrado:
--   SELECT COUNT(*) AS itens_orfaos
--   FROM event_items ei
--   WHERE NOT EXISTS (
--     SELECT 1 FROM events e
--     WHERE e.legacy_id = ei.event_id
--       OR  e.id::text  = ei.event_id
--   );
--
--   -- Anexos cujo event_id não casa com nenhum evento migrado:
--   SELECT COUNT(*) AS anexos_orfaos
--   FROM event_attachments ea
--   WHERE NOT EXISTS (
--     SELECT 1 FROM events e
--     WHERE e.legacy_id = ea.event_id
--       OR  e.id::text  = ea.event_id
--   );
--
-- Se o resultado for > 0, avise antes de prosseguir.
-- Nada é deletado automaticamente — a decisão é manual.

ALTER TABLE event_items
  ADD COLUMN IF NOT EXISTS event_uuid UUID REFERENCES events(id) ON DELETE CASCADE;

ALTER TABLE event_attachments
  ADD COLUMN IF NOT EXISTS event_uuid UUID REFERENCES events(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_event_items_event_uuid
  ON event_items (event_uuid)
  WHERE event_uuid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_attachments_event_uuid
  ON event_attachments (event_uuid)
  WHERE event_uuid IS NOT NULL;


-- ── FIM DA MIGRATION ─────────────────────────────────────────
-- Próximos passos (migrations separadas):
--   1. Script de migração de dados: sf_dados → events + event_team
--   2. Após validar dados: NOT NULL em event_uuid, DROP de event_id TEXT
--   3. Policy de freelancer em events (depende de tabela relacional de freelancers)
