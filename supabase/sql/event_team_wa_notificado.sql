-- Adiciona coluna para rastrear quando o funcionário foi notificado via WhatsApp
-- Pré-requisito: event_team já existe (events_table.sql rodado)

ALTER TABLE event_team
  ADD COLUMN IF NOT EXISTS wa_notificado_em TIMESTAMPTZ;

COMMENT ON COLUMN event_team.wa_notificado_em IS
  'Timestamp do último envio de escala WA que incluiu este membro. NULL = nunca notificado.';
