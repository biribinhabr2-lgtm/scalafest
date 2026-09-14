-- ============================================================
-- RESTAURAÇÃO DE EVENTOS — 11/09/2026
-- Mescla eventos históricos (backup) com os atuais no sf_dados
--
-- INSTRUÇÕES:
--   1. Rode o bloco de VERIFICAÇÃO primeiro — confirme os números
--   2. Se ok, rode o bloco de RESTAURAÇÃO
--   3. Rode a VERIFICAÇÃO FINAL para confirmar o resultado
--
-- Tenant principal: 0dca36f1-d897-402b-b794-55fece2a6ef2
-- NÃO alterar nem apagar sf_dados_backup_20260911
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. VERIFICAÇÃO PRÉVIA
-- ──────────────────────────────────────────────────────────────
SELECT
  (
    SELECT jsonb_array_length(dados)
    FROM sf_dados_backup_20260911
    WHERE user_id = '0dca36f1-d897-402b-b794-55fece2a6ef2'
      AND tipo = 'eventos'
  ) AS backup_total,
  (
    SELECT COUNT(*)::int
    FROM sf_dados_backup_20260911 b,
         jsonb_array_elements(b.dados) ev
    WHERE b.user_id = '0dca36f1-d897-402b-b794-55fece2a6ef2'
      AND b.tipo    = 'eventos'
      AND (ev->>'data') < '2026-09-11'
  ) AS historicos_no_backup,
  (
    SELECT COUNT(*)::int
    FROM sf_dados_backup_20260911 b,
         jsonb_array_elements(b.dados) ev
    WHERE b.user_id = '0dca36f1-d897-402b-b794-55fece2a6ef2'
      AND b.tipo    = 'eventos'
      AND (ev->>'data') >= '2026-09-11'
  ) AS recentes_no_backup,
  (
    SELECT jsonb_array_length(dados)
    FROM sf_dados
    WHERE user_id = '0dca36f1-d897-402b-b794-55fece2a6ef2'
      AND tipo = 'eventos'
  ) AS current_total;

-- Resultado esperado antes da restauração:
--   backup_total      > 109   (backup tem eventos históricos + recentes)
--   historicos_no_backup > 0  (eventos anteriores a 11/09 existem no backup)
--   current_total     = 109   (apenas os eventos pós-incidente)

-- ──────────────────────────────────────────────────────────────
-- 2. RESTAURAÇÃO
--    Lógica:
--      - Eventos atuais (>= 11/09) são mantidos como estão (prioridade)
--      - Eventos históricos (< 11/09) vêm do backup
--      - IDs duplicados: versão atual tem preferência
-- ──────────────────────────────────────────────────────────────
UPDATE sf_dados
SET
  dados = (
    WITH
      atuais AS (
        SELECT ev
        FROM sf_dados c,
             jsonb_array_elements(c.dados) ev
        WHERE c.user_id = '0dca36f1-d897-402b-b794-55fece2a6ef2'
          AND c.tipo    = 'eventos'
      ),
      historicos AS (
        SELECT ev
        FROM sf_dados_backup_20260911 b,
             jsonb_array_elements(b.dados) ev
        WHERE b.user_id = '0dca36f1-d897-402b-b794-55fece2a6ef2'
          AND b.tipo    = 'eventos'
          AND (ev->>'data') < '2026-09-11'
          -- Não adicionar se um evento com mesmo ID já existe nos atuais
          AND NOT EXISTS (
            SELECT 1 FROM atuais a
            WHERE a.ev->>'id' = ev->>'id'
          )
      )
    SELECT jsonb_agg(ev)
    FROM (
      SELECT ev FROM atuais
      UNION ALL
      SELECT ev FROM historicos
    ) combined
  ),
  updated_at = now()
WHERE user_id = '0dca36f1-d897-402b-b794-55fece2a6ef2'
  AND tipo    = 'eventos';

-- ──────────────────────────────────────────────────────────────
-- 3. VERIFICAÇÃO FINAL
-- ──────────────────────────────────────────────────────────────
SELECT
  jsonb_array_length(dados) AS total_apos_restore,
  (
    SELECT COUNT(*)::int
    FROM sf_dados c,
         jsonb_array_elements(c.dados) ev
    WHERE c.user_id = '0dca36f1-d897-402b-b794-55fece2a6ef2'
      AND c.tipo    = 'eventos'
      AND (ev->>'data') < '2026-09-11'
  ) AS historicos_restaurados,
  (
    SELECT COUNT(*)::int
    FROM sf_dados c,
         jsonb_array_elements(c.dados) ev
    WHERE c.user_id = '0dca36f1-d897-402b-b794-55fece2a6ef2'
      AND c.tipo    = 'eventos'
      AND (ev->>'data') >= '2026-09-11'
  ) AS recentes_mantidos,
  updated_at
FROM sf_dados
WHERE user_id = '0dca36f1-d897-402b-b794-55fece2a6ef2'
  AND tipo    = 'eventos';

-- Resultado esperado após restauração:
--   total_apos_restore = historicos_restaurados + 109
--   historicos_restaurados > 0
--   recentes_mantidos = 109
