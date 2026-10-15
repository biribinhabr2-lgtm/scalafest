'use strict';
/**
 * Testa o envio de escala com discriminação de participantes do grupo.
 *
 * Cenário: 3 freelancers escalados para o mesmo evento:
 *   - Ana Lima    → está no grupo   → @mencionada
 *   - Bruno Costa → não está        → só nome na msg do grupo + recebe individual
 *   - Carlos Melo → sem telefone    → só nome, entra em semTelefone
 *
 * node --test src/lib/escala/group-dispatch.test.js
 */

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const {
  buildEscalaDiariaGrupo,
  buildEscalaIndividual,
  normalizarTelefone,
} = require('../../templates/escala.template');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FL_DENTRO = { id: '1', nome: 'Ana Lima',    telefone: '11987654321' };
const FL_FORA   = { id: '2', nome: 'Bruno Costa', telefone: '11976543210' };
const FL_SEMTEL = { id: '3', nome: 'Carlos Melo', telefone: ''            };

const flById = { '1': FL_DENTRO, '2': FL_FORA, '3': FL_SEMTEL };

const EVENTO = {
  id:         'ev-001',
  nome:       'Festa Infantil',
  local:      'Salão Azul',
  horaInicio: '10:00',
  horaFim:    '13:00',
  data:       '2026-10-20',
  equipe: [
    { freelancerId: '1', funcao: 'Animador',   obs: '' },
    { freelancerId: '2', funcao: 'Recreador',  obs: '' },
    { freelancerId: '3', funcao: 'Assistente', obs: '' },
  ],
};

// Grupo contém apenas Ana Lima.
// JID do WA inclui 9° dígito; número cadastrado pode não ter → normalização resolve.
const PARTICIPANTES_MAP = new Map([
  [normalizarTelefone('5511987654321'), '5511987654321@s.whatsapp.net'],
]);

// ── Testes ────────────────────────────────────────────────────────────────────

test('normalizarTelefone — 8 e 9 dígitos mapeiam para a mesma forma canônica', () => {
  assert.equal(normalizarTelefone('11987654321'),   '551187654321'); // com 9°
  assert.equal(normalizarTelefone('1187654321'),    '551187654321'); // sem 9°
  assert.equal(normalizarTelefone('5511987654321'), '551187654321'); // com 55 e 9°
  assert.equal(normalizarTelefone('551187654321'),  '551187654321'); // já canônico
  assert.equal(normalizarTelefone(''),   null);
  assert.equal(normalizarTelefone(null), null);
});

test('buildEscalaDiariaGrupo — Ana mencionada, Bruno e Carlos aparecem só com nome', () => {
  const { texto, mentions, foraDaGrupo, semTelefone } = buildEscalaDiariaGrupo(
    '2026-10-20', [EVENTO], flById, undefined, PARTICIPANTES_MAP
  );

  // Ana está no grupo → menção com JID
  assert.ok(texto.includes('@5511987654321 - Animador'), 'Ana deve ser @mencionada');

  // Bruno não está → apenas nome, sem @JID
  assert.ok(texto.includes('Bruno Costa - Recreador'),  'Bruno deve aparecer sem @');
  assert.ok(!texto.includes('@5511976543210'),           'Bruno não deve ter @JID');

  // Carlos sem telefone → apenas nome
  assert.ok(texto.includes('Carlos Melo - Assistente'), 'Carlos deve aparecer sem @');

  // mentions contém só Ana
  assert.deepEqual(mentions, ['5511987654321@s.whatsapp.net']);

  // foraDaGrupo contém Bruno com o evento correto
  assert.equal(foraDaGrupo.length, 1);
  assert.equal(foraDaGrupo[0].fl.nome, 'Bruno Costa');
  assert.equal(foraDaGrupo[0].eventosInfo.length, 1);
  assert.equal(foraDaGrupo[0].eventosInfo[0].ev.nome, 'Festa Infantil');
  assert.equal(foraDaGrupo[0].eventosInfo[0].funcao, 'Recreador');

  // semTelefone contém Carlos
  assert.deepEqual(semTelefone, ['Carlos Melo']);
});

test('buildEscalaDiariaGrupo — fallback (participantesMap null) menciona todos com telefone', () => {
  const { texto, mentions, foraDaGrupo, semTelefone } = buildEscalaDiariaGrupo(
    '2026-10-20', [EVENTO], flById, undefined, null
  );

  // No fallback, Ana e Bruno são mencionados (têm telefone)
  assert.ok(texto.includes('@5511987654321'), 'Ana mencionada no fallback');
  assert.ok(texto.includes('@5511976543210'), 'Bruno mencionado no fallback');

  // Ninguém vai para "fora do grupo" no fallback
  assert.equal(foraDaGrupo.length, 0, 'sem foraDaGrupo no fallback');
  assert.equal(mentions.length, 2, 'dois @JIDs no fallback');

  // Carlos ainda aparece em semTelefone
  assert.deepEqual(semTelefone, ['Carlos Melo']);
});

test('buildEscalaIndividual — gera mensagem personalizada para Bruno com dados do evento', () => {
  const { foraDaGrupo } = buildEscalaDiariaGrupo(
    '2026-10-20', [EVENTO], flById, undefined, PARTICIPANTES_MAP
  );
  const { fl, eventosInfo } = foraDaGrupo[0]; // Bruno
  const msg = buildEscalaIndividual('2026-10-20', fl, eventosInfo);

  assert.ok(msg.includes('Bruno Costa'),   'nome do freelancer na msg individual');
  assert.ok(msg.includes('Festa Infantil'),'nome do evento');
  assert.ok(msg.includes('Salão Azul'),    'local do evento');
  assert.ok(msg.includes('10:00 — 13:00'), 'horário do evento');
  assert.ok(msg.includes('Recreador'),     'função do freelancer');
});

test('buildEscalaIndividual — usa corpo do template personalizado', () => {
  const tplCorpo = 'Oi {{nome}}, você trabalha em {{data_extenso}}:\n{{blocos_eventos}}';
  const msg = buildEscalaIndividual(
    '2026-10-20', FL_FORA,
    [{ ev: EVENTO, funcao: 'Recreador', obs: '' }],
    tplCorpo
  );
  assert.ok(msg.startsWith('Oi Bruno Costa'),     'template personalizado aplicado');
  assert.ok(msg.includes('TERÇA-FEIRA (20/10)'),  'data extenso no template');
});
