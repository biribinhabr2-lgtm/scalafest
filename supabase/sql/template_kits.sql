-- ═══════════════════════════════════════════════════════════════
-- TEMPLATE KITS — Biblioteca de kits reutilizáveis (pai/filho)
-- Rodar no Supabase SQL Editor (1 vez)
-- Requer: is_gestao() e get_tenant_id() (gestao_tenant_fix.sql)
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Tabela pai: kit ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS template_kits (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  categoria        TEXT NOT NULL CHECK (categoria IN ('checklist','material','figurino')),
  nome             TEXT NOT NULL,
  descricao        TEXT,
  capa_image_path  TEXT,   -- path no bucket catalog-images, nullable
  created_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE template_kits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gestao_all_kits" ON template_kits
  FOR ALL
  USING  (is_gestao() AND tenant_id = get_tenant_id())
  WITH CHECK (is_gestao() AND tenant_id = get_tenant_id());

CREATE POLICY "equipe_le_kits" ON template_kits
  FOR SELECT
  USING (tenant_id = get_tenant_id());

-- ── 2. Tabela filha: itens do kit ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS template_kit_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id      UUID NOT NULL REFERENCES template_kits(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL,
  nome        TEXT NOT NULL,
  obs         TEXT,
  image_path  TEXT,   -- path no bucket catalog-images, nullable
  ordem       INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE template_kit_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gestao_all_kit_items" ON template_kit_items
  FOR ALL
  USING  (is_gestao() AND tenant_id = get_tenant_id())
  WITH CHECK (is_gestao() AND tenant_id = get_tenant_id());

CREATE POLICY "equipe_le_kit_items" ON template_kit_items
  FOR SELECT
  USING (tenant_id = get_tenant_id());

-- ── 3. Vincular event_items ao item do kit ───────────────────────────────────

ALTER TABLE event_items
  ADD COLUMN IF NOT EXISTS kit_item_id UUID
    REFERENCES template_kit_items(id) ON DELETE SET NULL;

-- (mantém template_id antigo por compatibilidade até limpeza futura)

-- ── 4. Storage: policies para capa de kit e foto de item ─────────────────────
-- Paths:
--   capa do kit  → {tenant_id}/kits/{kit_id}.webp
--   foto do item → {tenant_id}/items/{item_id}.webp
-- A 1ª pasta sempre é tenant_id, então (storage.foldername(name))[1]
-- continua funcionando nos checks existentes.
-- Se ainda não criou o bucket catalog-images, crie agora no Storage UI:
--   Nome: catalog-images | Public: false | Máx: 5MB | Tipos: image/*

DROP POLICY IF EXISTS "catalog_insert" ON storage.objects;
CREATE POLICY "catalog_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'catalog-images'
    AND is_gestao()
    AND get_tenant_id()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "catalog_select" ON storage.objects;
CREATE POLICY "catalog_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'catalog-images'
    AND get_tenant_id()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "catalog_delete" ON storage.objects;
CREATE POLICY "catalog_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'catalog-images'
    AND is_gestao()
    AND get_tenant_id()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "catalog_update" ON storage.objects;
CREATE POLICY "catalog_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'catalog-images'
    AND is_gestao()
    AND get_tenant_id()::text = (storage.foldername(name))[1]
  );

-- ── 5. Migração dos dados existentes em item_templates ───────────────────────
-- Cria um kit por (tenant_id, categoria) com nome "Itens avulsos — X"
-- e move todos os registros para template_kit_items, preservando image_path.
-- Execute apenas se houver dados em item_templates; seguro rodar mesmo vazio.

DO $$
DECLARE
  r        RECORD;
  new_kit  UUID;
BEGIN
  FOR r IN (
    SELECT DISTINCT tenant_id, categoria
    FROM item_templates
    ORDER BY tenant_id, categoria
  ) LOOP
    INSERT INTO template_kits (tenant_id, categoria, nome)
    VALUES (
      r.tenant_id,
      r.categoria,
      CASE r.categoria
        WHEN 'material'  THEN 'Itens avulsos — Material'
        WHEN 'figurino'  THEN 'Itens avulsos — Figurino'
        WHEN 'checklist' THEN 'Itens avulsos — Checklist'
        ELSE 'Itens avulsos'
      END
    )
    RETURNING id INTO new_kit;

    INSERT INTO template_kit_items (kit_id, tenant_id, nome, obs, image_path, ordem)
    SELECT new_kit, tenant_id, nome, obs, image_path, ordem
    FROM item_templates
    WHERE tenant_id = r.tenant_id AND categoria = r.categoria
    ORDER BY ordem, created_at;
  END LOOP;
END $$;
