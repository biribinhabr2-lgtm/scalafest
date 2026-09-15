-- message_templates: mensagens WhatsApp editáveis por tenant
-- Rodar no Supabase SQL Editor.
-- Pré-requisito: is_gestao() já deve existir.

CREATE TABLE IF NOT EXISTS message_templates (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL,
  chave                 TEXT        NOT NULL,
  nome                  TEXT        NOT NULL,
  corpo                 TEXT        NOT NULL,
  variaveis_disponiveis TEXT[]      NOT NULL DEFAULT '{}',
  ativo                 BOOLEAN     NOT NULL DEFAULT true,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            UUID,
  UNIQUE (tenant_id, chave)
);

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

-- Gestão e admin leem
CREATE POLICY "gestao_select" ON message_templates
  FOR SELECT USING (is_gestao());

-- Apenas admin e gestão inserem/editam/excluem
CREATE POLICY "gestao_insert" ON message_templates
  FOR INSERT WITH CHECK (is_gestao());

CREATE POLICY "gestao_update" ON message_templates
  FOR UPDATE USING (is_gestao());

CREATE POLICY "gestao_delete" ON message_templates
  FOR DELETE USING (is_gestao());
