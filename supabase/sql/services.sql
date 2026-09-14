-- ═══════════════════════════════════════════════════════════════════
-- services.sql — Catálogo de serviços (schema + RLS)
-- Pré-requisitos: is_gestao(), get_tenant_id(), _sf_set_updated_at()
--   (já criados por events_table.sql / gestao_tenant_fix.sql)
-- ═══════════════════════════════════════════════════════════════════

-- _sf_set_updated_at pode já existir (events_table.sql); recriamos com OR REPLACE para ser idempotente
CREATE OR REPLACE FUNCTION _sf_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

-- ── 1. services ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS services (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  nome                TEXT NOT NULL,
  categoria           TEXT CHECK (categoria IN ('personagem','recreacao','oficina','outro')),
  duracao_padrao_min  INT,
  template_kit_id     UUID REFERENCES template_kits(id) ON DELETE SET NULL,
  ativo               BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX  IF NOT EXISTS services_tenant_idx ON services(tenant_id, nome);
CREATE UNIQUE INDEX IF NOT EXISTS services_nome_uniq ON services(tenant_id, lower(nome));

DROP TRIGGER IF EXISTS services_updated_at ON services;
CREATE TRIGGER services_updated_at
  BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION _sf_set_updated_at();

-- ── 2. service_keywords ───────────────────────────────────────────────────────
-- keyword: armazenar sempre normalizada (lower + unaccent + trim)
CREATE TABLE IF NOT EXISTS service_keywords (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id  UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  keyword     TEXT NOT NULL,
  origem      TEXT NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual','aprendido')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS service_keywords_uniq ON service_keywords(service_id, keyword);

-- ── 3. service_roles ─────────────────────────────────────────────────────────
-- funcao: mesmos valores usados em event_team.funcao
CREATE TABLE IF NOT EXISTS service_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id  UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  funcao      TEXT NOT NULL,
  quantidade  INT NOT NULL DEFAULT 1,
  obrigatorio BOOLEAN DEFAULT TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS service_roles_uniq ON service_roles(service_id, funcao);

-- ── 4. RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE services         ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_roles    ENABLE ROW LEVEL SECURITY;

-- services: leitura para todos do tenant, escrita apenas para gestão
DROP POLICY IF EXISTS "services_select" ON services;
CREATE POLICY "services_select" ON services
  FOR SELECT USING (tenant_id = get_tenant_id());

DROP POLICY IF EXISTS "services_insert" ON services;
CREATE POLICY "services_insert" ON services
  FOR INSERT WITH CHECK (is_gestao() AND tenant_id = get_tenant_id());

DROP POLICY IF EXISTS "services_update" ON services;
CREATE POLICY "services_update" ON services
  FOR UPDATE USING (is_gestao() AND tenant_id = get_tenant_id());

DROP POLICY IF EXISTS "services_delete" ON services;
CREATE POLICY "services_delete" ON services
  FOR DELETE USING (is_gestao() AND tenant_id = get_tenant_id());

-- service_keywords: isolamento via join com services
DROP POLICY IF EXISTS "service_keywords_select" ON service_keywords;
CREATE POLICY "service_keywords_select" ON service_keywords
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM services s WHERE s.id = service_id AND s.tenant_id = get_tenant_id())
  );

DROP POLICY IF EXISTS "service_keywords_insert" ON service_keywords;
CREATE POLICY "service_keywords_insert" ON service_keywords
  FOR INSERT WITH CHECK (
    is_gestao()
    AND EXISTS (SELECT 1 FROM services s WHERE s.id = service_id AND s.tenant_id = get_tenant_id())
  );

DROP POLICY IF EXISTS "service_keywords_update" ON service_keywords;
CREATE POLICY "service_keywords_update" ON service_keywords
  FOR UPDATE USING (
    is_gestao()
    AND EXISTS (SELECT 1 FROM services s WHERE s.id = service_id AND s.tenant_id = get_tenant_id())
  );

DROP POLICY IF EXISTS "service_keywords_delete" ON service_keywords;
CREATE POLICY "service_keywords_delete" ON service_keywords
  FOR DELETE USING (
    is_gestao()
    AND EXISTS (SELECT 1 FROM services s WHERE s.id = service_id AND s.tenant_id = get_tenant_id())
  );

-- service_roles: mesmo padrão
DROP POLICY IF EXISTS "service_roles_select" ON service_roles;
CREATE POLICY "service_roles_select" ON service_roles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM services s WHERE s.id = service_id AND s.tenant_id = get_tenant_id())
  );

DROP POLICY IF EXISTS "service_roles_insert" ON service_roles;
CREATE POLICY "service_roles_insert" ON service_roles
  FOR INSERT WITH CHECK (
    is_gestao()
    AND EXISTS (SELECT 1 FROM services s WHERE s.id = service_id AND s.tenant_id = get_tenant_id())
  );

DROP POLICY IF EXISTS "service_roles_update" ON service_roles;
CREATE POLICY "service_roles_update" ON service_roles
  FOR UPDATE USING (
    is_gestao()
    AND EXISTS (SELECT 1 FROM services s WHERE s.id = service_id AND s.tenant_id = get_tenant_id())
  );

DROP POLICY IF EXISTS "service_roles_delete" ON service_roles;
CREATE POLICY "service_roles_delete" ON service_roles
  FOR DELETE USING (
    is_gestao()
    AND EXISTS (SELECT 1 FROM services s WHERE s.id = service_id AND s.tenant_id = get_tenant_id())
  );
