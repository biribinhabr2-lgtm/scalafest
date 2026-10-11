-- ═══════════════════════════════════════════════════════════════════
-- event_team_service_id.sql
-- Pré-requisito: event_triagem.sql (event_services), services.sql (service_roles)
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Coluna event_service_id em event_team ─────────────────────────────────
ALTER TABLE event_team
  ADD COLUMN IF NOT EXISTS event_service_id UUID REFERENCES event_services(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS event_team_service_idx ON event_team(event_service_id);

-- ── 2. Campo unico_por_evento em service_roles ───────────────────────────────
ALTER TABLE service_roles
  ADD COLUMN IF NOT EXISTS unico_por_evento BOOLEAN NOT NULL DEFAULT FALSE;

-- Líder é único por evento independentemente de quantos serviços exigirem um
UPDATE service_roles SET unico_por_evento = TRUE WHERE lower(funcao) = 'líder';

-- ── 3. Auto-fill: eventos com exatamente 1 serviço ──────────────────────────
-- Preenche event_service_id para todos os membros de eventos que têm
-- exatamente um registro em event_services.
UPDATE event_team et
SET event_service_id = es.id
FROM event_services es
WHERE es.event_id = et.event_id
  AND et.event_service_id IS NULL
  AND (
    SELECT count(*) FROM event_services x WHERE x.event_id = et.event_id
  ) = 1;

-- ── 4. Diagnóstico: eventos com >1 serviço e membros sem vínculo ────────────
-- Execute esta query separadamente para ver os eventos que precisam de
-- resolução manual:
--
-- SELECT
--   e.id,
--   e.nome,
--   e.data,
--   count(DISTINCT es.id) AS qtd_servicos,
--   count(et.id)          AS membros_sem_servico
-- FROM events e
-- JOIN event_services es ON es.event_id = e.id
-- JOIN event_team et     ON et.event_id = e.id AND et.event_service_id IS NULL
-- GROUP BY e.id, e.nome, e.data
-- HAVING count(DISTINCT es.id) > 1
-- ORDER BY e.data DESC;
