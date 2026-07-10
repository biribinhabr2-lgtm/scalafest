-- Migração: estender visibilidade de material → material + figurino em event_items
-- Rodar no Supabase SQL Editor

-- 1. Remover todas as policies de freelancer antigas (nomes possíveis após fix anterior)
DROP POLICY IF EXISTS "fl_read"                    ON event_items;
DROP POLICY IF EXISTS "fl_update"                  ON event_items;
DROP POLICY IF EXISTS "freelancer_ve_material"     ON event_items;
DROP POLICY IF EXISTS "freelancer_toggle_material" ON event_items;
DROP POLICY IF EXISTS "freelancer_toggle_concluido" ON event_items;
DROP POLICY IF EXISTS "freelancer_ve_material_figurino" ON event_items;

-- 2. SELECT: freelancer do mesmo tenant vê material e figurino
CREATE POLICY "freelancer_ve_material_figurino" ON event_items
  FOR SELECT USING (
    categoria IN ('material', 'figurino')
    AND tenant_id IN (SELECT admin_id FROM sf_perfis WHERE id = auth.uid())
  );

-- 3. UPDATE: freelancer do mesmo tenant pode marcar concluido em material e figurino
CREATE POLICY "freelancer_toggle_concluido" ON event_items
  FOR UPDATE USING (
    categoria IN ('material', 'figurino')
    AND tenant_id IN (SELECT admin_id FROM sf_perfis WHERE id = auth.uid())
  ) WITH CHECK (
    categoria IN ('material', 'figurino')
    AND tenant_id IN (SELECT admin_id FROM sf_perfis WHERE id = auth.uid())
  );
