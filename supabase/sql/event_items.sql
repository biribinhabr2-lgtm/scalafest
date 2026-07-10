-- Checklist / Material / Figurino por evento
-- Rodar no Supabase SQL Editor

CREATE TABLE IF NOT EXISTS event_items (
  id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID      NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id    TEXT      NOT NULL,   -- UUID do evento em sf_dados (sem FK real)
  categoria   TEXT      NOT NULL CHECK (categoria IN ('checklist','material','figurino')),
  descricao   TEXT      NOT NULL,
  concluido   BOOLEAN   DEFAULT false,
  obs         TEXT,
  ordem       INTEGER   DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_items_event_idx ON event_items (event_id);
CREATE INDEX IF NOT EXISTS event_items_tenant_idx ON event_items (tenant_id);

ALTER TABLE event_items ENABLE ROW LEVEL SECURITY;

-- Gestão (admin + funcionário com nivel_acesso='gestao') — CRUD completo
CREATE POLICY "gestao_select" ON event_items FOR SELECT USING (is_gestao());
CREATE POLICY "gestao_insert" ON event_items FOR INSERT WITH CHECK (is_gestao());
CREATE POLICY "gestao_update" ON event_items FOR UPDATE USING (is_gestao());
CREATE POLICY "gestao_delete" ON event_items FOR DELETE USING (is_gestao());

-- Freelancers comuns — podem ver e marcar concluido apenas em material e figurino
CREATE POLICY "freelancer_ve_material_figurino" ON event_items
  FOR SELECT USING (
    categoria IN ('material', 'figurino')
    AND tenant_id IN (SELECT admin_id FROM sf_perfis WHERE id = auth.uid())
  );

CREATE POLICY "freelancer_toggle_concluido" ON event_items
  FOR UPDATE USING (
    categoria IN ('material', 'figurino')
    AND tenant_id IN (SELECT admin_id FROM sf_perfis WHERE id = auth.uid())
  ) WITH CHECK (
    categoria IN ('material', 'figurino')
    AND tenant_id IN (SELECT admin_id FROM sf_perfis WHERE id = auth.uid())
  );
