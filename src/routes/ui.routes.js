'use strict';

const { Router } = require('express');
const waClient   = require('../whatsapp/client');

const router = Router();

/**
 * GET /
 * Página HTML com QR code ao vivo — abre no navegador após npm start
 */
router.get('/', (_req, res) => {
  const connected = waClient.connected();
  const qr        = waClient.getQR();

  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>EscalaFest — WhatsApp</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .card{background:#fff;border-radius:16px;padding:40px 32px;max-width:420px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.1)}
    .logo{font-size:28px;font-weight:800;color:#128C7E;margin-bottom:6px}
    .sub{color:#666;font-size:14px;margin-bottom:28px}
    .status{display:inline-flex;align-items:center;gap:8px;padding:8px 18px;border-radius:20px;font-size:13px;font-weight:600;margin-bottom:24px}
    .status.ok{background:#e8fdf0;color:#128C7E;border:1px solid #b2dfdb}
    .status.wait{background:#fff8e1;color:#f57f17;border:1px solid #ffe082}
    .status.load{background:#e3f2fd;color:#1565c0;border:1px solid #90caf9}
    .dot{width:8px;height:8px;border-radius:50%;background:currentColor}
    img.qr{width:240px;height:240px;border:3px solid #128C7E;border-radius:12px;margin-bottom:16px}
    .hint{font-size:12px;color:#888;line-height:1.6;margin-bottom:20px}
    .refresh-bar{height:3px;background:#e0e0e0;border-radius:2px;overflow:hidden;margin-top:20px}
    .refresh-bar-inner{height:100%;background:#128C7E;width:100%;transform-origin:left;animation:shrink var(--t,5s) linear forwards}
    @keyframes shrink{from{transform:scaleX(1)}to{transform:scaleX(0)}}
    .btn{display:inline-block;margin-top:16px;padding:10px 24px;background:#128C7E;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;text-decoration:none}
    .btn:hover{background:#0e7065}
  </style>
</head>
<body>
<div class="card">
  <div class="logo">📲 EscalaFest</div>
  <div class="sub">Servidor WhatsApp</div>

  ${connected ? `
    <div class="status ok"><div class="dot"></div> Conectado ao WhatsApp</div>
    <p style="color:#555;font-size:14px;line-height:1.6">
      O servidor está pronto.<br>
      Volte ao Dashboard e use o botão <strong>📲 Enviar Escala</strong>.
    </p>
    <a class="btn" href="/">↺ Atualizar status</a>
  ` : qr ? `
    <div class="status wait"><div class="dot"></div> Aguardando leitura do QR</div>
    <img class="qr" src="${qr}" alt="QR Code WhatsApp"/>
    <p class="hint">
      1. Abra o WhatsApp no celular<br>
      2. Toque em <strong>⋮ → Aparelhos conectados</strong><br>
      3. Toque em <strong>Conectar aparelho</strong><br>
      4. Aponte a câmera para o QR acima
    </p>
    <div class="refresh-bar"><div class="refresh-bar-inner" style="--t:8s"></div></div>
  ` : `
    <div class="status load"><div class="dot"></div> Iniciando conexão…</div>
    <p style="color:#888;font-size:13px;margin-bottom:16px">
      Aguarde alguns segundos enquanto o servidor inicializa.
    </p>
    <div class="refresh-bar"><div class="refresh-bar-inner" style="--t:3s"></div></div>
  `}
</div>

<script>
  // Auto-reload: 8s se tem QR, 3s se ainda carregando, nenhum se conectado
  const connected = ${connected};
  const hasQr     = ${Boolean(qr)};
  if (!connected) {
    const delay = hasQr ? 8000 : 3000;
    setTimeout(() => location.reload(), delay);
  }
</script>
</body>
</html>`);
});

module.exports = router;
