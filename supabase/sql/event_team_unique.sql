-- ─────────────────────────────────────────────────────────────────────────────
-- event_team_unique.sql
-- Adiciona UNIQUE(event_id, freelancer_id) em event_team para:
--   1. Evitar duplicatas (e.g., escalar o mesmo freelancer duas vezes)
--   2. Habilitar upsert com onConflict no frontend
--
-- ⚠️  Executar APÓS verificar/remover duplicatas com a query abaixo.
--
-- Diagnóstico — rodar primeiro para ver se há duplicatas:
--   SELECT event_id, freelancer_id, COUNT(*) AS qtd
--   FROM event_team
--   GROUP BY event_id, freelancer_id
--   HAVING COUNT(*) > 1;
--
-- Remoção de duplicatas (mantém a linha mais recente):
--   DELETE FROM event_team
--   WHERE id NOT IN (
--     SELECT DISTINCT ON (event_id, freelancer_id) id
--     FROM event_team
--     ORDER BY event_id, freelancer_id, created_at DESC
--   );
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE event_team
  ADD CONSTRAINT event_team_uniq_member UNIQUE (event_id, freelancer_id);
