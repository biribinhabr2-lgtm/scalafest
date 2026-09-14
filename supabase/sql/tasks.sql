-- ── TASKS ───────────────────────────────────────────────────────────────────────
-- Módulo de Tarefas (visão semanal estilo Notion) + Reuniões com broadcast.
-- Rodar no Supabase SQL Editor.
--
-- DEPENDE DE: is_gestao() (já criada), sf_perfis (já existe)
-- ────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tasks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  titulo      TEXT        NOT NULL,
  observacao  TEXT,
  status      TEXT        NOT NULL DEFAULT 'nao_iniciado'
                CHECK (status IN ('nao_iniciado','iniciado','concluido','cancelado')),
  tipo        TEXT        NOT NULL DEFAULT 'tarefa'
                CHECK (tipo IN ('tarefa','reuniao')),
  data        DATE,
  hora        TIME,
  responsavel TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Admin: acesso total às suas próprias tarefas
CREATE POLICY "tasks_admin" ON tasks
  FOR ALL USING (tenant_id = auth.uid());

-- Gestão: SELECT nas tarefas do admin deles
CREATE POLICY "tasks_gestao_select" ON tasks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM sf_perfis
      WHERE sf_perfis.id = auth.uid()
        AND sf_perfis.admin_id = tasks.tenant_id
        AND sf_perfis.nivel_acesso = 'gestao'
    )
  );

-- Gestão: INSERT nas tarefas do admin deles
CREATE POLICY "tasks_gestao_insert" ON tasks
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM sf_perfis
      WHERE sf_perfis.id = auth.uid()
        AND sf_perfis.admin_id = tasks.tenant_id
        AND sf_perfis.nivel_acesso = 'gestao'
    )
  );

-- Gestão: UPDATE nas tarefas do admin deles
CREATE POLICY "tasks_gestao_update" ON tasks
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM sf_perfis
      WHERE sf_perfis.id = auth.uid()
        AND sf_perfis.admin_id = tasks.tenant_id
        AND sf_perfis.nivel_acesso = 'gestao'
    )
  );

-- Gestão: DELETE nas tarefas do admin deles
CREATE POLICY "tasks_gestao_delete" ON tasks
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM sf_perfis
      WHERE sf_perfis.id = auth.uid()
        AND sf_perfis.admin_id = tasks.tenant_id
        AND sf_perfis.nivel_acesso = 'gestao'
    )
  );

-- Trigger para manter updated_at atualizado
CREATE OR REPLACE FUNCTION update_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_updated_at_trigger ON tasks;
CREATE TRIGGER tasks_updated_at_trigger
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE PROCEDURE update_tasks_updated_at();

-- Índice de performance
CREATE INDEX IF NOT EXISTS idx_tasks_tenant ON tasks(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_data   ON tasks(tenant_id, data);
