-- ── NOTIFICATIONS ──────────────────────────────────────────────────────────────
-- Notificações in-app para a equipe (alterações de evento, novas escalas, etc.)
-- Rodar no Supabase SQL Editor.
--
-- DEPENDE DE: is_gestao() (já criada), sf_perfis (já existe)
-- ────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL,
  event_id        TEXT,                   -- ID do evento (Date.now() como string)
  destinatario_id UUID,                   -- null = broadcast para todo o tenant
  tipo            TEXT        NOT NULL CHECK (tipo IN (
                    'alteracao_evento','novo_evento','escala',
                    'reuniao','tarefa','geral'
                  )),
  titulo          TEXT        NOT NULL,
  mensagem        TEXT        NOT NULL,
  lida            BOOLEAN     DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- SELECT: usuário vê suas próprias + broadcasts do seu tenant
CREATE POLICY "notif_select" ON notifications FOR SELECT USING (
  destinatario_id = auth.uid()
  OR (
    destinatario_id IS NULL
    AND tenant_id = (
      SELECT COALESCE(admin_id, id) FROM sf_perfis WHERE id = auth.uid()
    )
  )
);

-- INSERT: apenas admin e gestão criam notificações
CREATE POLICY "notif_insert" ON notifications FOR INSERT WITH CHECK (is_gestao());

-- UPDATE: destinatário pode marcar como lida; gestão pode alterar qualquer uma
CREATE POLICY "notif_update" ON notifications FOR UPDATE USING (
  destinatario_id = auth.uid() OR is_gestao()
);

-- DELETE: apenas gestão
CREATE POLICY "notif_delete" ON notifications FOR DELETE USING (is_gestao());

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_notif_destinatario
  ON notifications(destinatario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_tenant
  ON notifications(tenant_id, created_at DESC);
