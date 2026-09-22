#!/usr/bin/env node
/**
 * generate-api-key.js
 *
 * Gera uma nova chave de API para um cliente externo e registra o hash
 * SHA-256 na tabela api_clients do Supabase.
 *
 * A chave em texto é exibida UMA ÚNICA VEZ no terminal e nunca é gravada
 * em arquivo ou banco de dados.
 *
 * Uso:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_KEY=eyJ... \
 *   node scripts/generate-api-key.js --tenant-id <UUID> --nome "Nome do cliente"
 *
 * Ou com variáveis em .env na pasta scripts/:
 *   node scripts/generate-api-key.js --tenant-id <UUID> --nome "Nome do cliente"
 *
 * Opções:
 *   --tenant-id   UUID do admin dono dos dados (obrigatório)
 *   --nome        Nome identificador do cliente (obrigatório)
 *   --desativar   ID de um cliente existente a desativar (opcional, independente)
 *   --listar      Lista todos os clientes do tenant e encerra
 */

'use strict';

const crypto                = require('crypto');
const path                  = require('path');
const { createClient }      = require('@supabase/supabase-js');

// ── Carrega .env se existir ───────────────────────────────────────────────────
try {
  const fs      = require('fs');
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !process.env[key]) process.env[key] = val;
    }
  }
} catch (_) {}

// ── Parse de argumentos ───────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
  }
  return args;
}

function abort(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);

  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL) abort('Variável SUPABASE_URL não definida.');
  if (!SERVICE_KEY)  abort('Variável SUPABASE_SERVICE_KEY não definida.');

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── Listar clientes ─────────────────────────────────────────────────────────
  if (args['listar']) {
    const tenantId = args['tenant-id'];
    let query = sb.from('api_clients').select('id, nome, tenant_id, ativo, created_at, last_used_at').order('created_at');
    if (tenantId) query = query.eq('tenant_id', tenantId);
    const { data, error } = await query;
    if (error) abort('Erro ao listar clientes: ' + error.message);
    if (!data || data.length === 0) {
      console.log('\nNenhum cliente cadastrado.\n');
      return;
    }
    console.log('\nClientes cadastrados:');
    console.log('─'.repeat(80));
    for (const c of data) {
      const usado = c.last_used_at
        ? new Date(c.last_used_at).toLocaleString('pt-BR')
        : '(nunca usado)';
      const status = c.ativo ? '✅ ativo' : '❌ inativo';
      console.log(`  ID:        ${c.id}`);
      console.log(`  Nome:      ${c.nome}`);
      console.log(`  Tenant:    ${c.tenant_id}`);
      console.log(`  Status:    ${status}`);
      console.log(`  Criado:    ${new Date(c.created_at).toLocaleString('pt-BR')}`);
      console.log(`  Usado em:  ${usado}`);
      console.log('─'.repeat(80));
    }
    return;
  }

  // ── Desativar cliente ───────────────────────────────────────────────────────
  if (args['desativar']) {
    const clientId = args['desativar'];
    const { error } = await sb
      .from('api_clients')
      .update({ ativo: false })
      .eq('id', clientId);
    if (error) abort('Erro ao desativar: ' + error.message);
    console.log(`\n✅ Cliente ${clientId} desativado.\n`);
    return;
  }

  // ── Criar nova chave ────────────────────────────────────────────────────────
  const tenantId = args['tenant-id'];
  const nome     = args['nome'];

  if (!tenantId) abort('--tenant-id é obrigatório.');
  if (!nome)     abort('--nome é obrigatório.');

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
    abort('--tenant-id deve ser um UUID válido (ex: 550e8400-e29b-41d4-a716-446655440000).');
  }

  // Gera 32 bytes aleatórios → base64url (44 chars, URL-safe)
  const rawKey  = crypto.randomBytes(32).toString('base64url');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  const { data, error } = await sb
    .from('api_clients')
    .insert({ tenant_id: tenantId, nome, key_hash: keyHash })
    .select('id, created_at')
    .single();

  if (error) abort('Erro ao salvar no banco: ' + error.message);

  console.log('\n' + '═'.repeat(60));
  console.log('  ✅ Chave criada com sucesso!');
  console.log('═'.repeat(60));
  console.log(`  ID do cliente:  ${data.id}`);
  console.log(`  Nome:           ${nome}`);
  console.log(`  Tenant ID:      ${tenantId}`);
  console.log(`  Criado em:      ${new Date(data.created_at).toLocaleString('pt-BR')}`);
  console.log('═'.repeat(60));
  console.log('\n  🔑 CHAVE DE API (copie agora — não será exibida novamente):');
  console.log('\n  ' + rawKey + '\n');
  console.log('  ⚠️  Envie esta chave ao consumidor pelo canal seguro combinado.');
  console.log('     Ela NÃO está salva no banco, apenas o hash SHA-256.\n');
}

main().catch(err => {
  console.error('\n❌ Erro inesperado:', err.message);
  process.exit(1);
});
