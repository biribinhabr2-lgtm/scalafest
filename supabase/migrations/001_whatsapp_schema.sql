-- ─────────────────────────────────────────────────────────────────────────────
--  EscalaFest — Histórico de envios via WhatsApp
--  Execute este script UMA VEZ no Supabase SQL Editor do seu projeto.
--  Caminho: Supabase Dashboard → SQL Editor → New query → cole e execute.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sf_envios_wa (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id         uuid        NOT NULL,          -- UUID do admin (auth.users.id)
  evento_id        bigint      NOT NULL,           -- ID numérico do evento no JSON
  evento_nome      text        NOT NULL,
  freelancer_id    bigint,                         -- ID numérico do freelancer
  freelancer_nome  text,
  telefone         text,                           -- Número como cadastrado no sistema
  mensagem         text,                           -- Texto completo enviado
  status           text        NOT NULL DEFAULT 'pendente',
    -- Valores: 'enviado' | 'erro' | 'sem_telefone'
  erro             text,                           -- Descrição do erro, se houver
  enviado_em       timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Índice para buscas por admin (listagem do histórico)
CREATE INDEX IF NOT EXISTS idx_sf_envios_wa_admin
  ON public.sf_envios_wa (admin_id, enviado_em DESC);

-- Índice para buscas por evento
CREATE INDEX IF NOT EXISTS idx_sf_envios_wa_evento
  ON public.sf_envios_wa (admin_id, evento_id);

-- ─── Row Level Security ────────────────────────────────────────────────────────
-- O backend usa a service_role key (bypass total de RLS).
-- Se quiser que o admin veja seu próprio histórico via chave pública, habilite:

-- ALTER TABLE public.sf_envios_wa ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "admin vê seus envios"
--   ON public.sf_envios_wa
--   FOR SELECT
--   USING (admin_id = auth.uid());

-- ─── Comentário da tabela ──────────────────────────────────────────────────────
COMMENT ON TABLE public.sf_envios_wa IS
  'Registros de envios de escalas via WhatsApp pelo servidor Baileys.';
