'use strict';

const { Router }  = require('express');
const sessionMgr  = require('../whatsapp/sessionManager');

const router = Router();

/**
 * GET /?adminId=xxx
 * Página HTML com status/QR da sessão de um admin específico.
 * Abrir em http://localhost:3001/?adminId=SEU_ADMIN_ID
 */
router.get('/', (req, res) => {
  const adminId  = req.query.adminId || '';
  const sess     = adminId ? sessionMgr.getSession(adminId) : null;
  const connected = sess?.connected  || false;
  const qr        = sess?.qrDataUrl  || null;
  const phone     = sess?.phone      || null;
  const connecting = sess?.connecting || false;

  const noAdmin = !adminId;

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
    .status.info{background:#f3f4f6;color:#374151;border:1px solid #e5e7eb}
    .dot{width:8px;height:8px;border-radius:50%;background:currentColor}
    img.qr{width:240px;height:240px;border:3px solid #128C7E;border-radius:12px;margin-bottom:16px}
    .hint{font-size:12px;color:#888;line-height:1.6;margin-bottom:20px}
    .refresh-bar{height:3px;background:#e0e0e0;border-radius:2px;overflow:hidden;margin-top:20px}
    .refresh-bar-inner{height:100%;background:#128C7E;width:100%;transform-origin:left;animation:shrink var(--t,5s) linear forwards}
    @keyframes shrink{from{transform:scaleX(1)}to{transform:scaleX(0)}}
    .btn{display:inline-block;margin-top:16px;padding:10px 24px;background:#128C7E;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;text-decoration:none}
    .btn:hover{background:#0e7065}
    code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:13px}
  </style>
</head>
<body>
<div class="card">
  <div class="logo">📲 EscalaFest</div>
  <div class="sub">Servidor WhatsApp Multi-Sessão</div>

  ${noAdmin ? `
    <div class="status info"><div class="dot"></div> Nenhum admin selecionado</div>
    <p style="color:#555;font-size:13px;line-height:1.7;margin-bottom:16px">
      Para ver o QR de um admin específico, acesse:<br>
      <code>/?adminId=SEU_ADMIN_ID</code>
    </p>
    <p style="color:#888;font-size:12px;line-height:1.6">
      Use o painel de Logística (aba Config → WhatsApp) para conectar diretamente.
    </p>
  ` : connected ? `
    <div class="status ok"><div class="dot"></div> Conectado${phone ? ' — +' + phone : ''}</div>
    <p style="color:#555;font-size:14px;line-height:1.6">
      Admin: <code>${adminId}</code><br>
      O servidor está pronto para enviar mensagens.
    </p>
    <a class="btn" href="/?adminId=${adminId}">↺ Atualizar status</a>
  ` : qr ? `
    <div class="status wait"><div class="dot"></div> Aguardando leitura do QR</div>
    <p style="color:#888;font-size:12px;margin-bottom:12px">Admin: <code>${adminId}</code></p>
    <img class="qr" src="${qr}" alt="QR Code WhatsApp"/>
    <p class="hint">
      1. Abra o WhatsApp no celular<br>
      2. Toque em <strong>⋮ → Aparelhos conectados</strong><br>
      3. Toque em <strong>Conectar aparelho</strong><br>
      4. Aponte a câmera para o QR acima
    </p>
    <div class="refresh-bar"><div class="refresh-bar-inner" style="--t:8s"></div></div>
  ` : connecting ? `
    <div class="status load"><div class="dot"></div> Conectando…</div>
    <p style="color:#888;font-size:13px;margin-bottom:16px">
      Admin: <code>${adminId}</code><br>Aguarde o QR ser gerado.
    </p>
    <div class="refresh-bar"><div class="refresh-bar-inner" style="--t:3s"></div></div>
  ` : `
    <div class="status info"><div class="dot"></div> Sessão não iniciada</div>
    <p style="color:#555;font-size:13px;line-height:1.7;margin-bottom:16px">
      Admin: <code>${adminId}</code><br>
      Inicie a conexão pelo painel de Logística (aba Config → WhatsApp → Conectar).
    </p>
  `}
</div>

<script>
  const connected  = ${connected};
  const hasQr      = ${Boolean(qr)};
  const connecting = ${connecting};
  if (!connected && (hasQr || connecting)) {
    const delay = hasQr ? 8000 : 3000;
    setTimeout(() => location.reload(), delay);
  }
</script>
</body>
</html>`);
});

module.exports = router;
