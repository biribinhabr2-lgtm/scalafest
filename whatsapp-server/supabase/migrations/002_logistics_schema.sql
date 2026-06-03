-- ═══════════════════════════════════════════════════════════════════════════
--  EscalaFest — Módulo de Logística Operacional
--  Execute no Supabase SQL Editor: cole tudo e clique em Run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Veículos ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sf_veiculos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     uuid NOT NULL,
  nome         text NOT NULL,
  placa        text,
  capacidade   int  NOT NULL DEFAULT 4,
  consumo_medio numeric(5,2),           -- km/L
  observacoes  text,
  ativo        boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Pontos de Encontro ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sf_pontos_encontro (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   uuid NOT NULL,
  nome       text NOT NULL,
  endereco   text NOT NULL,
  lat        numeric(10,7),
  lng        numeric(10,7),
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Motoristas ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sf_motoristas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id         uuid NOT NULL,
  nome             text NOT NULL,
  telefone         text,
  pin              text,               -- PIN 6 dígitos para login do motorista
  veiculo_id       uuid REFERENCES public.sf_veiculos(id)        ON DELETE SET NULL,
  ponto_inicial_id uuid REFERENCES public.sf_pontos_encontro(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'disponivel',
    -- disponivel | em_rota | aguardando | retornando | preso_em_evento
  ativo            boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Configuração Logística (por admin) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sf_config_logistica (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id              uuid NOT NULL UNIQUE,
  tempo_seguranca_min   int  NOT NULL DEFAULT 30,
  tempo_carga_min       int  NOT NULL DEFAULT 20,
  tempo_desmontagem_min int  NOT NULL DEFAULT 20,
  google_maps_key       text,         -- chave do admin (opcional; usa .env como fallback)
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ── Rotas / Despachos ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sf_rotas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id         uuid NOT NULL,
  -- Vínculo opcional com evento existente em sf_dados
  evento_ref_id    text,
  -- Dados do evento logístico
  nome_evento      text NOT NULL,
  endereco_evento  text NOT NULL,
  lat_evento       numeric(10,7),
  lng_evento       numeric(10,7),
  data_evento      date NOT NULL,
  horario_inicio   time NOT NULL,
  horario_fim      time NOT NULL,
  prioridade       smallint NOT NULL DEFAULT 1,  -- 1 normal | 2 alta | 3 crítica
  qtd_equipe       int NOT NULL DEFAULT 1,
  min_motoristas   int NOT NULL DEFAULT 1,
  precisa_retorno  boolean NOT NULL DEFAULT true,
  obs_logistica    text,
  -- Despacho
  motorista_id     uuid REFERENCES public.sf_motoristas(id)      ON DELETE SET NULL,
  veiculo_id       uuid REFERENCES public.sf_veiculos(id)        ON DELETE SET NULL,
  ponto_saida_id   uuid REFERENCES public.sf_pontos_encontro(id) ON DELETE SET NULL,
  ponto_retorno_id uuid REFERENCES public.sf_pontos_encontro(id) ON DELETE SET NULL,
  -- Calculados pelo backend
  horario_saida_calculado   timestamptz,
  horario_chegada_calculado timestamptz,
  distancia_km              numeric(8,2),
  duracao_min               int,
  motorista_permanece       boolean NOT NULL DEFAULT false,
  -- Registrados em campo
  horario_saida_real    timestamptz,
  horario_chegada_real  timestamptz,
  horario_retorno_real  timestamptz,
  -- Status operacional
  status     text NOT NULL DEFAULT 'pendente',
    -- pendente | aguardando_saida | em_deslocamento | chegou
    -- em_evento | retornando | finalizado | cancelado
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Histórico de Status (log em tempo real) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sf_historico_status (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rota_id        uuid NOT NULL REFERENCES public.sf_rotas(id) ON DELETE CASCADE,
  status         text NOT NULL,
  lat            numeric(10,7),
  lng            numeric(10,7),
  observacao     text,
  registrado_por text NOT NULL DEFAULT 'motorista',   -- 'motorista' | 'admin'
  criado_em      timestamptz NOT NULL DEFAULT now()
);

-- ── Índices ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sf_veiculos_admin       ON public.sf_veiculos       (admin_id);
CREATE INDEX IF NOT EXISTS idx_sf_pontos_admin         ON public.sf_pontos_encontro(admin_id);
CREATE INDEX IF NOT EXISTS idx_sf_motoristas_admin     ON public.sf_motoristas     (admin_id);
CREATE INDEX IF NOT EXISTS idx_sf_motoristas_status    ON public.sf_motoristas     (admin_id, status);
CREATE INDEX IF NOT EXISTS idx_sf_rotas_admin_data     ON public.sf_rotas          (admin_id, data_evento DESC);
CREATE INDEX IF NOT EXISTS idx_sf_rotas_motorista      ON public.sf_rotas          (motorista_id);
CREATE INDEX IF NOT EXISTS idx_sf_rotas_status         ON public.sf_rotas          (admin_id, status);
CREATE INDEX IF NOT EXISTS idx_sf_historico_rota       ON public.sf_historico_status(rota_id, criado_em DESC);

COMMENT ON TABLE public.sf_veiculos          IS 'Frota de veículos por admin';
COMMENT ON TABLE public.sf_pontos_encontro   IS 'Pontos fixos (base, praça, galpão)';
COMMENT ON TABLE public.sf_motoristas        IS 'Motoristas cadastrados por admin';
COMMENT ON TABLE public.sf_config_logistica  IS 'Configurações de tempos e API por admin';
COMMENT ON TABLE public.sf_rotas             IS 'Despachos e rotas calculadas';
COMMENT ON TABLE public.sf_historico_status  IS 'Log de status em tempo real por rota';
