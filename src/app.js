'use strict';

const express  = require('express');
const cors     = require('cors');
const routes   = require('./routes');
const uiRoutes = require('./routes/ui.routes');

const app = express();

// ─── CORS — aberto para qualquer origem ───────────────────────────────────────
// A segurança é feita pelo API_SECRET no header x-api-secret, não pelo CORS.
// Precisamos aceitar qualquer origem porque o túnel (localtunnel/ngrok) gera
// URLs dinâmicas e o Dashboard pode estar em qualquer domínio.
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-secret', 'x-admin-id', 'x-motorista-id', 'bypass-tunnel-reminder'],
}));

// Garante resposta a preflight OPTIONS em todas as rotas
app.options('*', cors());

// ─── Body parser ──────────────────────────────────────────────────────────────
app.use(express.json());

// ─── Página visual do QR code (pública, sem autenticação) ─────────────────────
app.use('/', uiRoutes);

// ─── Middleware de autenticação simples (API_SECRET) ──────────────────────────
// Rotas públicas (sem necessidade de x-api-secret):
//   GET  /          → página visual do QR
//   GET  /health    → health check
//   GET  /api/whatsapp/status  → status da conexão
//   GET  /api/whatsapp/qr     → QR code em JSON
// Rotas protegidas (exigem x-api-secret):
//   POST /api/escala/enviar   → dispara mensagens
//   POST /api/whatsapp/desconectar
const ROTAS_PUBLICAS = [
  { method: 'GET',  path: '/' },
  { method: 'GET',  path: '/health' },
  { method: 'GET',  path: '/api/tunnel-url' },
  { method: 'POST', path: '/api/whatsapp/conectar' },
  { method: 'GET',  path: '/api/whatsapp/status' },
  { method: 'GET',  path: '/api/whatsapp/qr' },
  { method: 'POST', path: '/api/logistics/drivers/auth/login' },
];

app.use((req, res, next) => {
  const publica = ROTAS_PUBLICAS.some(
    r => r.method === req.method && r.path === req.path
  );
  if (publica) return next();

  const secret = process.env.API_SECRET;
  if (secret && req.headers['x-api-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// ─── Rotas da API ─────────────────────────────────────────────────────────────
app.use('/api', routes);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ─── URL do túnel (para o Dashboard configurar automaticamente) ────────────────
app.get('/api/tunnel-url', (_req, res) => {
  res.json({ url: app.locals.tunnelUrl || null });
});

// ─── 404 catch-all ────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// ─── Error handler ────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[app] Erro não tratado:', err.message);
  res.status(500).json({ error: err.message });
});

module.exports = app;
