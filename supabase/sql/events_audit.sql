-- ─────────────────────────────────────────────────────────────────────────────
-- events_audit — trilha de auditoria para events e event_team
-- Rodar no Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Tabela de auditoria ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events_audit (
  id          BIGSERIAL PRIMARY KEY,
  table_name  TEXT        NOT NULL,          -- 'events' | 'event_team'
  operation   TEXT        NOT NULL,          -- 'INSERT' | 'UPDATE' | 'DELETE'
  record_id   TEXT        NOT NULL,          -- PK do registro afetado
  old_data    JSONB,                         -- estado antes (null em INSERT)
  new_data    JSONB,                         -- estado depois (null em DELETE)
  changed_by  UUID,                          -- auth.uid() no momento da operação
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS events_audit_table_op_idx
  ON events_audit (table_name, operation, changed_at DESC);

CREATE INDEX IF NOT EXISTS events_audit_record_idx
  ON events_audit (table_name, record_id, changed_at DESC);

-- 2. RLS — só admin/gestão lê; trigger usa SECURITY DEFINER ──────────────────
ALTER TABLE events_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_select" ON events_audit
  FOR SELECT USING (is_gestao());

-- Nenhuma policy de INSERT/UPDATE/DELETE no client: apenas o trigger escreve.

-- 3. Função do trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_events_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER   -- roda como dono da função, ignora RLS para escrever
AS $$
DECLARE
  v_id TEXT;
BEGIN
  -- Determina o PK do registro
  IF TG_OP = 'DELETE' THEN
    v_id := OLD.id::TEXT;
  ELSE
    v_id := NEW.id::TEXT;
  END IF;

  INSERT INTO events_audit (table_name, operation, record_id, old_data, new_data, changed_by)
  VALUES (
    TG_TABLE_NAME,
    TG_OP,
    v_id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
    auth.uid()
  );

  RETURN NULL;  -- AFTER trigger: valor de retorno é ignorado
END;
$$;

-- 4. Triggers em events ───────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_events_audit ON events;

CREATE TRIGGER trg_events_audit
  AFTER INSERT OR UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION fn_events_audit();

-- 5. Triggers em event_team ───────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_event_team_audit ON event_team;

CREATE TRIGGER trg_event_team_audit
  AFTER INSERT OR UPDATE OR DELETE ON event_team
  FOR EACH ROW EXECUTE FUNCTION fn_events_audit();

-- ─────────────────────────────────────────────────────────────────────────────
-- SCRIPTS DE REVERSÃO
-- ─────────────────────────────────────────────────────────────────────────────

-- Função auxiliar: reverte um DELETE a partir do ID do registro de auditoria.
-- Uso: SELECT revert_audit_delete(123);
CREATE OR REPLACE FUNCTION revert_audit_delete(p_audit_id BIGINT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row   events_audit%ROWTYPE;
  v_sql   TEXT;
  v_cols  TEXT;
  v_vals  TEXT;
BEGIN
  SELECT * INTO v_row FROM events_audit WHERE id = p_audit_id;

  IF NOT FOUND THEN
    RETURN 'Registro de auditoria não encontrado: ' || p_audit_id;
  END IF;

  IF v_row.operation <> 'DELETE' THEN
    RETURN 'Operação não é DELETE (é ' || v_row.operation || '). Nada foi revertido.';
  END IF;

  IF v_row.old_data IS NULL THEN
    RETURN 'old_data é NULL neste registro — não é possível reconstruir o dado.';
  END IF;

  -- Monta INSERT dinâmico a partir do JSONB
  SELECT
    string_agg(quote_ident(key), ', '),
    string_agg(quote_literal(value #>> '{}'), ', ')
  INTO v_cols, v_vals
  FROM jsonb_each(v_row.old_data);

  v_sql := format(
    'INSERT INTO %I (%s) VALUES (%s) ON CONFLICT (id) DO NOTHING',
    v_row.table_name,
    v_cols,
    v_vals
  );

  EXECUTE v_sql;

  RETURN format(
    'Registro %s restaurado em %I a partir da auditoria #%s.',
    v_row.record_id, v_row.table_name, p_audit_id
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- CONSULTAS ÚTEIS
-- ─────────────────────────────────────────────────────────────────────────────

-- Últimas 20 exclusões de eventos:
--
-- SELECT id, record_id, old_data->>'nome' AS nome_evento,
--        old_data->>'data' AS data_evento, changed_by, changed_at
-- FROM events_audit
-- WHERE operation = 'DELETE' AND table_name = 'events'
-- ORDER BY changed_at DESC
-- LIMIT 20;

-- Histórico completo de um evento específico (substitua o UUID):
--
-- SELECT operation, old_data, new_data, changed_by, changed_at
-- FROM events_audit
-- WHERE table_name = 'events' AND record_id = '<uuid-do-evento>'
-- ORDER BY changed_at;

-- Reverter exclusão acidental (substitua o ID da linha de auditoria):
--
-- SELECT revert_audit_delete(<audit_id>);
