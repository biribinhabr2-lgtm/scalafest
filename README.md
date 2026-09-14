# EscalaFest v2

Sistema de gestão de eventos e equipe para animadores/freelancers.

## Apps

| App | Arquivo | URL |
|---|---|---|
| Dashboard admin | `Dashboard/index.html` | `/dashboard` |
| Logística | `Logistica/index.html` | `/logistica` |
| Motorista | `Logistica/motorista.html` | `/logistica/motorista` |

---

## Backup automático do banco

O GitHub Action `.github/workflows/backup-supabase.yml` roda todo dia às **03:00 (Brasília)** e salva um dump comprimido como GitHub Artifact com retenção de **30 dias**.

### Configurar o secret `SUPABASE_DB_URL`

1. Acesse o painel do Supabase → **Project Settings → Database → Connection string → URI**.  
   O formato é:  
   ```
   postgresql://postgres.[ref]:[senha]@aws-0-[região].pooler.supabase.com:5432/postgres
   ```
2. No GitHub, vá em **Settings → Secrets and variables → Actions → New repository secret**.  
   - Nome: `SUPABASE_DB_URL`  
   - Valor: a connection string copiada acima.

### Baixar um backup

1. GitHub → aba **Actions** → selecione a run desejada.  
2. Na seção **Artifacts**, clique em `db-backup-YYYYMMDD_HHMMSS` para baixar o `.gz`.

### Restaurar um dump

> **Atenção:** restaurar sobrescreve os dados existentes. Faça isso em ambiente de testes antes de aplicar em produção.

```bash
# 1. Descompactar
gunzip escalafest_YYYYMMDD_HHMMSS.sql.gz

# 2. Restaurar (substitua <ref> e <senha> pelos valores do seu projeto)
psql "postgresql://postgres.<ref>:<senha>@db.<ref>.supabase.co:5432/postgres" \
  -f escalafest_YYYYMMDD_HHMMSS.sql
```

Se quiser restaurar apenas tabelas específicas, use `--table` no `pg_dump` original ou selecione manualmente as seções do arquivo `.sql`.

### Reverter uma exclusão acidental (events_audit)

Sem precisar de dump, use a tabela `events_audit` para reverter deleções:

```sql
-- Ver últimas exclusões de eventos
SELECT id, record_id, old_data, changed_at
FROM events_audit
WHERE operation = 'DELETE' AND table_name = 'events'
ORDER BY changed_at DESC
LIMIT 20;

-- Restaurar um evento específico (substitua <audit_id>)
SELECT revert_audit_delete(<audit_id>);
```

Ver `supabase/sql/events_audit.sql` para o SQL completo da tabela e da função de reversão.

---

## Deploy

### Netlify

Arrastar a pasta raiz (sem `whatsapp-server/`) para o painel do Netlify.  
O `netlify.toml` já configura cache e redirects.

### Railway (backend WhatsApp)

Qualquer mudança em `whatsapp-server/` requer redeploy manual no Railway.

### Supabase Edge Functions

```bash
supabase functions deploy asaas-checkout
supabase functions deploy asaas-webhook
```

---

## Segurança

- `SUPABASE_SERVICE_KEY` — **nunca** no frontend. Somente em `.env` e Railway Variables.
- `whatsapp-server/` — **nunca** fazer upload para o Netlify.
- `.env` — **nunca** commitar no GitHub.
