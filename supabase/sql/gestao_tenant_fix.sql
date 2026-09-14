-- ═══════════════════════════════════════════════════════════════
-- GESTÃO TENANT FIX
-- Rodar no Supabase SQL Editor (1 vez)
-- Habilita funcionários com nivel_acesso='gestao' a:
--   • ver/editar event_items (checklist/material/figurino) do tenant
--   • ver/editar event_attachments do tenant
--   • escrever em sf_dados do admin (salvar eventos)
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Resolver tenant: admin → próprio ID; gestão → admin_id ────────────────

CREATE OR REPLACE FUNCTION get_tenant_id()
RETURNS UUID AS $$
  SELECT COALESCE(
    -- funcionário vinculado: retorna o admin_id do seu perfil
    (SELECT admin_id FROM sf_perfis
     WHERE id = auth.uid() AND admin_id IS NOT NULL AND admin_id <> id
     LIMIT 1),
    -- caso contrário (admin ou usuário autônomo): próprio ID
    auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── 2. event_items: trocar policies is_gestao() sem tenant por versão isolada ─

DROP POLICY IF EXISTS "gestao_select"        ON event_items;
DROP POLICY IF EXISTS "gestao_insert"        ON event_items;
DROP POLICY IF EXISTS "gestao_update"        ON event_items;
DROP POLICY IF EXISTS "gestao_delete"        ON event_items;
DROP POLICY IF EXISTS "gestao_all_event_items" ON event_items;

CREATE POLICY "gestao_all_event_items" ON event_items
  FOR ALL
  USING  (is_gestao() AND tenant_id = get_tenant_id())
  WITH CHECK (is_gestao() AND tenant_id = get_tenant_id());

-- ── 3. event_attachments: adicionar policy para gestão ───────────────────────
-- (policy existente 'tenant_attachments_all' só cobre admin com tenant_id = auth.uid())

DROP POLICY IF EXISTS "gestao_all_event_attachments" ON event_attachments;

CREATE POLICY "gestao_all_event_attachments" ON event_attachments
  FOR ALL
  USING  (is_gestao() AND tenant_id = get_tenant_id())
  WITH CHECK (is_gestao() AND tenant_id = get_tenant_id());

-- ── 4. Storage: permitir gestão fazer upload/leitura no prefixo do admin ─────
-- As policies de storage usam (storage.foldername(name))[1] = auth.uid()::text
-- Precisamos ampliar para aceitar o tenant resolvido.

DROP POLICY IF EXISTS "tenant_storage_insert" ON storage.objects;
CREATE POLICY "tenant_storage_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'event-attachments'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR (is_gestao() AND get_tenant_id()::text = (storage.foldername(name))[1])
    )
  );

DROP POLICY IF EXISTS "tenant_storage_select" ON storage.objects;
CREATE POLICY "tenant_storage_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'event-attachments'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR (is_gestao() AND get_tenant_id()::text = (storage.foldername(name))[1])
    )
  );

DROP POLICY IF EXISTS "tenant_storage_delete" ON storage.objects;
CREATE POLICY "tenant_storage_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'event-attachments'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR (is_gestao() AND get_tenant_id()::text = (storage.foldername(name))[1])
    )
  );

-- ── 5. sf_dados: permitir gestão escrever nos dados do admin ─────────────────
-- ATENÇÃO: só adicionar estas policies se sf_dados JÁ tiver RLS habilitado.
-- Se a tabela não tem RLS, pule esta seção (não é necessário).
-- Para verificar: SELECT relrowsecurity FROM pg_class WHERE relname='sf_dados';
--
-- DROP POLICY IF EXISTS "gestao_sf_dados" ON sf_dados;
-- CREATE POLICY "gestao_sf_dados" ON sf_dados
--   FOR ALL
--   USING  (is_gestao() AND user_id = get_tenant_id())
--   WITH CHECK (is_gestao() AND user_id = get_tenant_id());
