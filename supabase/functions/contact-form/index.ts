// supabase/functions/contact-form/index.ts
// Recebe mensagem do formulário de contato e envia e-mail via Resend.
// Variáveis de ambiente necessárias (Supabase → Settings → Edge Functions):
//   RESEND_API_KEY  — chave da API Resend (https://resend.com)
//   CONTACT_EMAIL   — e-mail de destino (padrão: biribinhabr2@gmail.com)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const { nome, email, assunto, mensagem } = await req.json()

    if (!nome || !email || !mensagem) {
      return new Response(JSON.stringify({ error: 'Campos obrigatórios faltando' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const destino = Deno.env.get('CONTACT_EMAIL') ?? 'biribinhabr2@gmail.com'
    const resendKey = Deno.env.get('RESEND_API_KEY')

    const assuntoLabel: Record<string, string> = {
      duvida: 'Dúvida sobre o produto',
      suporte: 'Suporte técnico',
      sugestao: 'Sugestão de melhoria',
      parceria: 'Parceria / comercial',
      lgpd: 'Privacidade / LGPD',
      outro: 'Outro',
    }

    const assuntoTexto = assuntoLabel[assunto] ?? assunto ?? 'Contato via site'

    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1e293b">
        <div style="background:linear-gradient(135deg,#14B8A6,#0D9488);padding:24px 32px;border-radius:12px 12px 0 0">
          <h1 style="color:#fff;margin:0;font-size:20px">📩 Nova mensagem de contato — EscalaFest</h1>
        </div>
        <div style="background:#f8fafc;padding:24px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:100px">Nome</td><td style="padding:8px 0;font-weight:600">${escHtml(nome)}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b;font-size:13px">E-mail</td><td style="padding:8px 0"><a href="mailto:${escHtml(email)}" style="color:#0D9488">${escHtml(email)}</a></td></tr>
            <tr><td style="padding:8px 0;color:#64748b;font-size:13px">Assunto</td><td style="padding:8px 0">${escHtml(assuntoTexto)}</td></tr>
          </table>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0"/>
          <p style="color:#64748b;font-size:13px;margin:0 0 8px">Mensagem:</p>
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;white-space:pre-wrap;font-size:14px;line-height:1.6">${escHtml(mensagem)}</div>
          <p style="color:#94a3b8;font-size:11px;margin-top:16px">Enviado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} via escalafest.netlify.app/contato</p>
        </div>
      </div>
    `

    if (!resendKey) {
      console.warn('RESEND_API_KEY não configurada — e-mail não enviado. Configure em Supabase → Settings → Edge Functions.')
      return new Response(JSON.stringify({ ok: true, warn: 'email_not_sent_no_key' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'EscalaFest <noreply@escalafest.com.br>',
        to: destino,
        reply_to: email,
        subject: `[EscalaFest] ${assuntoTexto} — ${nome}`,
        html,
      }),
    })

    if (!resendRes.ok) {
      const err = await resendRes.text()
      console.error('Resend error:', err)
      return new Response(JSON.stringify({ error: 'Falha ao enviar e-mail' }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: 'Erro interno' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
