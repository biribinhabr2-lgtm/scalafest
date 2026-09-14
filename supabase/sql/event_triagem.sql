-- ═══════════════════════════════════════════════════════════════════
-- event_triagem.sql — Triagem automática de serviços por evento
-- Pré-requisitos: events_table.sql, services.sql, is_gestao(), get_tenant_id()
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Função auxiliar (inclui secretaria no gate de escrita) ────────────────
CREATE OR REPLACE FUNCTION is_gestao_or_secretaria()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM sf_perfis
    WHERE id = auth.uid()
      AND (role = 'admin' OR nivel_acesso = 'gestao' OR role = 'secretario')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── 2. Colunas novas em events ───────────────────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS titulo_original   TEXT,
  ADD COLUMN IF NOT EXISTS cliente           TEXT,
  ADD COLUMN IF NOT EXISTS triagem_status    TEXT NOT NULL DEFAULT 'pendente'
    CHECK (triagem_status IN ('pendente','reconhecido','nao_identificado','confirmado')),
  ADD COLUMN IF NOT EXISTS duracao_total_min INT;

CREATE INDEX IF NOT EXISTS events_triagem_idx ON events(tenant_id, triagem_status);

-- Permite secretaria confirmar eventos (UPDATE qualquer campo no próprio tenant)
-- A escrita de triagem_status = 'confirmado' é a única operação que secretaria fará em events.
DROP POLICY IF EXISTS "events_secretaria_update" ON events;
CREATE POLICY "events_secretaria_update" ON events
  FOR UPDATE
  USING (
    tenant_id = get_tenant_id()
    AND EXISTS (SELECT 1 FROM sf_perfis WHERE id = auth.uid() AND role = 'secretario')
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND EXISTS (SELECT 1 FROM sf_perfis WHERE id = auth.uid() AND role = 'secretario')
  );

-- ── 3. Tabela event_services ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_services (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  service_id  UUID REFERENCES services(id) ON DELETE SET NULL,
  nome_bruto  TEXT NOT NULL,
  duracao_min INT,
  ordem       INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS event_services_event_idx   ON event_services(event_id);
CREATE INDEX IF NOT EXISTS event_services_service_idx ON event_services(service_id);

-- ── 4. RLS em event_services ─────────────────────────────────────────────────
ALTER TABLE event_services ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer usuário do tenant pode ver
DROP POLICY IF EXISTS "event_services_select" ON event_services;
CREATE POLICY "event_services_select" ON event_services
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND e.tenant_id = get_tenant_id())
  );

-- Escrita: gestão + secretaria (is_gestao_or_secretaria inclui admin/gestao/secretario)
DROP POLICY IF EXISTS "event_services_insert" ON event_services;
CREATE POLICY "event_services_insert" ON event_services
  FOR INSERT WITH CHECK (
    is_gestao_or_secretaria()
    AND EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND e.tenant_id = get_tenant_id())
  );

DROP POLICY IF EXISTS "event_services_update" ON event_services;
CREATE POLICY "event_services_update" ON event_services
  FOR UPDATE USING (
    is_gestao_or_secretaria()
    AND EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND e.tenant_id = get_tenant_id())
  );

DROP POLICY IF EXISTS "event_services_delete" ON event_services;
CREATE POLICY "event_services_delete" ON event_services
  FOR DELETE USING (
    is_gestao_or_secretaria()
    AND EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND e.tenant_id = get_tenant_id())
  );
