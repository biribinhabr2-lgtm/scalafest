'use strict';

// Claude API fallback for event triage.
// Gated by TRIAGEM_CLAUDE_ENABLED=true (default: disabled).
// Result is a SUGGESTION only — never auto-confirms anything.

const ENABLED = process.env.TRIAGEM_CLAUDE_ENABLED === 'true';
const CLAUDE_KEY = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-6';

// claudeAssist(titulo, services) → { blocos:[{nomeBruto, serviceId|null}], cliente } | null
//
// services: [{ id, nome }]  — the full service catalog for this tenant
// Returns null if disabled, no key, or API error.
async function claudeAssist(titulo, services) {
  if (!ENABLED || !CLAUDE_KEY) return null;
  if (!titulo || !services || services.length === 0) return null;

  const catalogText = services.map(s => `- id:${s.id}  nome:"${s.nome}"`).join('\n');

  const prompt = `Você é um assistente de triagem de eventos de festa infantil.
Dado o título de um evento e o catálogo de serviços, identifique:
1. O cliente (texto após o último traço "-", "–" ou "—")
2. Os blocos de serviço (separados por "+")
3. Para cada bloco, o service_id mais provável do catálogo (ou null se não encontrado)

Título: "${titulo}"

Catálogo de serviços:
${catalogText}

Responda APENAS com JSON no formato:
{"cliente":"string ou null","blocos":[{"nomeBruto":"string","serviceId":"uuid ou null"}]}

Não confirme nada automaticamente. Seja conservador: prefira null a uma correspondência incerta.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error('[claude-assist] API error:', res.status, await res.text());
      return null;
    }

    const data = await res.json();
    const text = data?.content?.[0]?.text || '';

    // Extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.blocos || !Array.isArray(parsed.blocos)) return null;

    return {
      cliente: parsed.cliente || null,
      blocos: parsed.blocos.map(b => ({
        nomeBruto: b.nomeBruto || '',
        serviceId: b.serviceId || null,
      })),
    };
  } catch (e) {
    console.error('[claude-assist] Error:', e.message);
    return null;
  }
}

module.exports = { claudeAssist, ENABLED };
