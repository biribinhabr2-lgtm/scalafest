-- ═══════════════════════════════════════════════════════════════
-- ITEM TEMPLATES — Biblioteca de modelos reutilizáveis
-- Rodar no Supabase SQL Editor (1 vez)
-- Requer: is_gestao() e get_tenant_id() já existentes
--         (criados em gestao_tenant_fix.sql)
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Tabela item_templates ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS item_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL,
  categoria  TEXT NOT NULL CHECK (categoria IN ('checklist','material','figurino')),
  nome       TEXT NOT NULL,
  obs        TEXT,
  image_path TEXT,           -- path no bucket catalog-images, nullable
  ordem      INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE item_templates ENABLE ROW LEVEL SECURITY;

-- Admin + gestão: CRUD completo (isolado por tenant)
DROP POLICY IF EXISTS "gestao_all_templates" ON item_templates;
CREATE POLICY "gestao_all_templates" ON item_templates
  FOR ALL
  USING  (is_gestao() AND tenant_id = get_tenant_id())
  WITH CHECK (is_gestao() AND tenant_id = get_tenant_id());

-- Qualquer membro autenticado do tenant: só leitura
-- (para freelancers verem imagens de figurino/material)
DROP POLICY IF EXISTS "equipe_le_templates" ON item_templates;
CREATE POLICY "equipe_le_templates" ON item_templates
  FOR SELECT
  USING (tenant_id = get_tenant_id());

-- ── 2. Vincular event_items ao template de origem ────────────────────────────

ALTER TABLE event_items
  ADD COLUMN IF NOT EXISTS template_id UUID
    REFERENCES item_templates(id) ON DELETE SET NULL;

-- ── 3. Storage: bucket catalog-images ───────────────────────────────────────
-- IMPORTANTE: o bucket deve ser criado manualmente no Supabase Storage:
--   Nome: catalog-images
--   Public: false
--   Tamanho máx.: 5MB
--   Tipos aceitos: image/jpeg, image/png, image/webp
--
-- Após criar o bucket, execute as policies abaixo:

-- Gestão faz upload no próprio tenant (path: {tenant_id}/{template_id}.webp)
DROP POLICY IF EXISTS "catalog_insert" ON storage.objects;
CREATE POLICY "catalog_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'catalog-images'
    AND is_gestao()
    AND get_tenant_id()::text = (storage.foldername(name))[1]
  );

-- Qualquer membro autenticado do tenant lê as imagens
DROP POLICY IF EXISTS "catalog_select" ON storage.objects;
CREATE POLICY "catalog_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'catalog-images'
    AND get_tenant_id()::text = (storage.foldername(name))[1]
  );

-- Gestão pode excluir imagens do próprio tenant
DROP POLICY IF EXISTS "catalog_delete" ON storage.objects;
CREATE POLICY "catalog_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'catalog-images'
    AND is_gestao()
    AND get_tenant_id()::text = (storage.foldername(name))[1]
  );

-- Gestão pode substituir (update/upsert) imagens do próprio tenant
DROP POLICY IF EXISTS "catalog_update" ON storage.objects;
CREATE POLICY "catalog_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'catalog-images'
    AND is_gestao()
    AND get_tenant_id()::text = (storage.foldername(name))[1]
  );
