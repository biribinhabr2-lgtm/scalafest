-- ── TABELA: event_attachments ─────────────────────────────────────────────────
-- Controla metadados dos anexos de imagem por evento.
-- Os arquivos ficam no bucket "event-attachments" no Supabase Storage.
-- event_id é TEXT pois os IDs de evento são timestamps gerados pelo frontend (Date.now()).
-- event_date permite a edge function cleanup-event-attachments deletar por data sem
-- precisar ler os eventos do blob JSON em sf_dados.

CREATE TABLE IF NOT EXISTS event_attachments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id     TEXT        NOT NULL,
  event_date   DATE        NOT NULL,
  storage_path TEXT        NOT NULL,
  file_name    TEXT        NOT NULL,
  uploaded_by  TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_attachments_event_id_idx ON event_attachments(event_id);
CREATE INDEX IF NOT EXISTS event_attachments_event_date_idx ON event_attachments(event_date);

ALTER TABLE event_attachments ENABLE ROW LEVEL SECURITY;

-- Apenas o próprio admin (tenant) acessa seus anexos
CREATE POLICY "tenant_attachments_all" ON event_attachments
  FOR ALL USING (tenant_id = auth.uid())
  WITH CHECK (tenant_id = auth.uid());


-- ── STORAGE: bucket "event-attachments" ───────────────────────────────────────
-- Crie o bucket manualmente no Dashboard: Storage → New bucket
--   Nome: event-attachments
--   Público: false (Private)
--   Allowed MIME types: image/jpeg, image/png, image/webp
--   Max file size: 5242880 (5 MB)
--
-- Depois rode as policies abaixo:

-- Permite upload apenas no próprio prefixo de tenant
CREATE POLICY "tenant_storage_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'event-attachments'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Permite leitura somente dos próprios arquivos
CREATE POLICY "tenant_storage_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'event-attachments'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Permite exclusão somente dos próprios arquivos
CREATE POLICY "tenant_storage_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'event-attachments'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
