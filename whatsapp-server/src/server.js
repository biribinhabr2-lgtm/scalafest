'use strict';

require('dotenv').config();

const app        = require('./app');
const sessionMgr = require('./whatsapp/sessionManager');
const localtunnel = require('localtunnel');

const PORT = process.env.PORT || 3001;

// ─── Validação mínima de variáveis de ambiente ─────────────────────────────
const REQUIRED_VARS = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
const missing = REQUIRED_VARS.filter(v => !process.env[v]);
if (missing.length) {
  console.error(`[server] Variáveis de ambiente ausentes: ${missing.join(', ')}`);
  console.error('[server] Copie .env.example para .env e preencha os valores.');
  process.exit(1);
}

// ─── Inicia o servidor HTTP ────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🟢 Servidor local: http://localhost:${PORT}`);
  console.log(`   QR code:         http://localhost:${PORT}\n`);

  // Túnel local — só ativo quando não estiver rodando em produção na nuvem
  if (process.env.DISABLE_TUNNEL !== 'true') {
    try {
      const subdomain = process.env.TUNNEL_SUBDOMAIN || null;
      const tunnel = await localtunnel({ port: PORT, ...(subdomain && { subdomain }) });
      const url = tunnel.url;

      console.log('━'.repeat(60));
      console.log(`🌐  URL PÚBLICA (HTTPS): ${url}`);
      console.log('━'.repeat(60));

      app.locals.tunnelUrl = url;

      tunnel.on('close', () => {
        console.warn('[tunnel] Túnel encerrado. Reinicie o servidor para gerar nova URL.');
      });
    } catch (err) {
      console.warn(`[tunnel] Não foi possível criar túnel: ${err.message}`);
      console.warn('[tunnel] Use http://localhost:3001 se acessando localmente.\n');
    }
  } else {
    const publicUrl = process.env.PUBLIC_URL || '';
    if (publicUrl) {
      console.log('━'.repeat(60));
      console.log(`🌐  URL PÚBLICA: ${publicUrl}`);
      console.log('━'.repeat(60));
      app.locals.tunnelUrl = publicUrl;
    }
  }
});

// ─── Restaura sessões WhatsApp existentes (multi-session) ─────────────────────
sessionMgr.restoreExistingSessions().catch(err => {
  console.error('[WhatsApp] Erro ao restaurar sessões:', err.message);
});

// ─── Graceful shutdown ─────────────────────────────────────────────────────
process.on('SIGINT',  () => { console.log('\n[server] Encerrando...'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\n[server] Encerrando...'); process.exit(0); });
