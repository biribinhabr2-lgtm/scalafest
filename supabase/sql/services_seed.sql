-- ═══════════════════════════════════════════════════════════════════
-- services_seed.sql — Seed inicial a partir dos nomes dos eventos
--
-- Pré-requisito: services.sql já executado.
-- Estratégia de extração:
--   1. Divide nome do evento pelo separador "+"
--   2. Dentro de cada bloco, toma tudo antes do primeiro " - "
--      (descarta sufixos de local / duração inline)
--   3. Filtra tokens que sejam apenas dígitos ou duração ("3h", "45min")
--   4. Deduplica por tenant
--   5. Vincula template_kit_id se o nome de algum kit for substring do serviço
--
-- FLUXO:
--   PASSO 1 — rode o bloco PREVIEW (SELECT) e revise a lista no painel Results.
--   PASSO 2 — após revisar, rode o bloco INSERT (DO $$...$$).
--             Para excluir algum nome antes de inserir, adicione um filtro
--             AND lower(nome_servico) NOT IN ('nome indesejado', ...)
--             no CTE "deduped" do bloco INSERT.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 1 — PREVIEW (apenas SELECT; não insere nada)
-- Execute, revise a lista e anote quais linhas descartar antes do PASSO 2.
-- ─────────────────────────────────────────────────────────────────────────────

WITH splitted AS (
  SELECT
    tenant_id,
    trim(s) AS bloco
  FROM events,
    unnest(string_to_array(nome, '+')) AS s
  WHERE nome IS NOT NULL AND nome <> ''
),
por_bloco AS (
  SELECT
    tenant_id,
    -- descarta sufixo após o primeiro " - " dentro do bloco
    trim(split_part(bloco, ' - ', 1)) AS nome_servico
  FROM splitted
  WHERE trim(bloco) <> ''
),
deduped AS (
  SELECT DISTINCT
    tenant_id,
    nome_servico,
    lower(regexp_replace(trim(nome_servico), '\s+', ' ', 'g')) AS keyword_norm,
    count(*) OVER (PARTITION BY tenant_id, lower(trim(nome_servico))) AS n_eventos
  FROM por_bloco
  WHERE
    length(trim(nome_servico)) > 1
    -- filtra tokens de duração pura: "3h", "2h30", "45min", números soltos
    AND trim(nome_servico) !~ '^\d+\s*(h|min|hora|horas|:).*$'
    AND trim(nome_servico) !~ '^\d+$'
    -- filtra artigos e preposições soltos
    AND lower(trim(nome_servico)) NOT IN ('e','de','da','do','a','o','para','com','no','na')
),
com_kit AS (
  SELECT
    d.*,
    (
      SELECT tk.nome FROM template_kits tk
      WHERE tk.tenant_id = d.tenant_id
        AND (
          lower(tk.nome) ILIKE '%' || lower(d.nome_servico) || '%'
          OR lower(d.nome_servico) ILIKE '%' || lower(tk.nome) || '%'
        )
      ORDER BY length(tk.nome) DESC
      LIMIT 1
    ) AS kit_sugerido
  FROM deduped d
)
SELECT
  row_number() OVER (ORDER BY n_eventos DESC, nome_servico) AS "#",
  nome_servico                          AS "Serviço",
  keyword_norm                          AS "Keyword",
  n_eventos                             AS "# Eventos",
  COALESCE(kit_sugerido, '—')           AS "Kit sugerido"
FROM com_kit
ORDER BY n_eventos DESC, nome_servico;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 2 — INSERT (rode DEPOIS de revisar o PREVIEW acima)
--
-- Para excluir linhas indesejadas, adicione no CTE "deduped":
--   AND lower(nome_servico) NOT IN ('lixo aqui', 'outro lixo')
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r      RECORD;
  svc_id UUID;
BEGIN
  FOR r IN (
    WITH splitted AS (
      SELECT tenant_id, trim(s) AS bloco
      FROM events,
        unnest(string_to_array(nome, '+')) AS s
      WHERE nome IS NOT NULL AND nome <> ''
    ),
    por_bloco AS (
      SELECT tenant_id, trim(split_part(bloco, ' - ', 1)) AS nome_servico
      FROM splitted WHERE trim(bloco) <> ''
    ),
    deduped AS (
      SELECT DISTINCT
        tenant_id,
        nome_servico,
        lower(regexp_replace(trim(nome_servico), '\s+', ' ', 'g')) AS keyword_norm
      FROM por_bloco
      WHERE
        length(trim(nome_servico)) > 1
        AND trim(nome_servico) !~ '^\d+\s*(h|min|hora|horas|:).*$'
        AND trim(nome_servico) !~ '^\d+$'
        AND lower(trim(nome_servico)) NOT IN ('e','de','da','do','a','o','para','com','no','na')
        -- ↓ adicione exclusões aqui após revisar o PREVIEW
        -- AND lower(nome_servico) NOT IN ('nome indesejado', ...)
    )
    SELECT
      d.tenant_id,
      d.nome_servico,
      d.keyword_norm,
      (
        SELECT tk.id FROM template_kits tk
        WHERE tk.tenant_id = d.tenant_id
          AND (
            lower(tk.nome) ILIKE '%' || lower(d.nome_servico) || '%'
            OR lower(d.nome_servico) ILIKE '%' || lower(tk.nome) || '%'
          )
        ORDER BY length(tk.nome) DESC
        LIMIT 1
      ) AS template_kit_id
    FROM deduped d
    ORDER BY nome_servico
  )
  LOOP
    -- Pula se já existe (pelo nome)
    IF EXISTS (
      SELECT 1 FROM services s
      WHERE s.tenant_id = r.tenant_id
        AND lower(s.nome) = lower(r.nome_servico)
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO services (tenant_id, nome, template_kit_id)
    VALUES (r.tenant_id, r.nome_servico, r.template_kit_id)
    RETURNING id INTO svc_id;

    INSERT INTO service_keywords (service_id, keyword, origem)
    VALUES (svc_id, r.keyword_norm, 'manual');
  END LOOP;

  RAISE NOTICE 'Seed concluído.';
END $$;
