-- ═══════════════════════════════════════════════════════════════════
-- roster_decisions.sql — Histórico de decisões de escala automática
-- Pré-requisitos: events_table.sql, is_gestao(), get_tenant_id()
--
-- Propósito: registrar qual freelancer foi sugerido pelo motor e qual
-- foi efetivamente escolhido pelo admin, para aprendizado futuro.
-- Por enquanto só persiste; a influência no score fica para depois.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS roster_decisions (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  event_id                  UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  funcao                    TEXT        NOT NULL,

  -- ID do freelancer sugerido pelo motor (TEXT = legacy numeric ID ou UUID)
  sugerido_freelancer_id    TEXT,

  -- ID do freelancer efetivamente escolhido pelo admin
  -- null = admin manteve o sugerido sem informar explicitamente
  escolhido_freelancer_id   TEXT,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roster_decisions_event_id
  ON roster_decisions (event_id);

CREATE INDEX IF NOT EXISTS idx_roster_decisions_freelancer
  ON roster_decisions (escolhido_freelancer_id)
  WHERE escolhido_freelancer_id IS NOT NULL;

ALTER TABLE roster_decisions ENABLE ROW LEVEL SECURITY;

-- Apenas gestão pode ler e gravar decisões de roster
DROP POLICY IF EXISTS "roster_decisions_gestao" ON roster_decisions;
CREATE POLICY "roster_decisions_gestao" ON roster_decisions
  FOR ALL
  USING (
    is_gestao()
    AND EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_id
        AND e.tenant_id = get_tenant_id()
    )
  )
  WITH CHECK (
    is_gestao()
    AND EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_id
        AND e.tenant_id = get_tenant_id()
    )
  );
