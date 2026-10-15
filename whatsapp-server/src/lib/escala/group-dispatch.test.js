'use strict';
/**
 * Testa o envio de escala com discriminação de participantes do grupo.
 *
 * Cenário: 3 freelancers escalados para o mesmo evento:
 *   - Ana Lima    → está no grupo   → @mencionada pelo nome do cadastro
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
  calcDuracao,
  tituloFuncao,
  sortFuncoes,
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
  obs:        '',
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

test('calcDuracao — retorna duração legível', () => {
  assert.equal(calcDuracao('09:00', '11:00'), '2h');
  assert.equal(calcDuracao('09:00', '10:30'), '1h30');
  assert.equal(calcDuracao('10:00', '13:00'), '3h');
  assert.equal(calcDuracao('10:00', '10:00'), '');   // mesmo horário
  assert.equal(calcDuracao('', '13:00'),      '');   // inválido
});

test('tituloFuncao — singular/plural', () => {
  assert.equal(tituloFuncao('Líder',      1), 'Líder');
  assert.equal(tituloFuncao('Líder',      2), 'Líderes');
  assert.equal(tituloFuncao('Personagem', 3), 'Personagens');
  assert.equal(tituloFuncao('Animador',   2), 'Animadores');
  assert.equal(tituloFuncao('Palhaço',    2), 'Palhaços');  // fallback +s
});

test('sortFuncoes — prioridade Líder/Auxiliar/Personagem, resto alfabético', () => {
  const ordered = sortFuncoes(['Recreador', 'Personagem', 'Animador', 'Líder', 'Auxiliar']);
  assert.equal(ordered[0], 'Líder');
  assert.equal(ordered[1], 'Auxiliar');
  assert.equal(ordered[2], 'Personagem');
  // Animador e Recreador em ordem alfabética depois
  assert.equal(ordered[3], 'Animador');
  assert.equal(ordered[4], 'Recreador');
});

test('buildEscalaDiariaGrupo — formato do cabeçalho do evento', () => {
  const { texto } = buildEscalaDiariaGrupo(
    '2026-10-20', [EVENTO], flById, undefined, PARTICIPANTES_MAP
  );

  assert.ok(texto.includes('*Festa Infantil*'),         'nome do evento em negrito');
  assert.ok(texto.includes('10:00 às 13:00 · 3h'),      'horário e duração no header');
  assert.ok(texto.includes('_Salão Azul_'),              'local em itálico');
  assert.ok(texto.includes('TERÇA-FEIRA — 20/10'),       'data com em-dash');
});

test('buildEscalaDiariaGrupo — Ana mencionada pelo número JID, Bruno e Carlos sem @', () => {
  const { texto, mentions, foraDaGrupo, semTelefone } = buildEscalaDiariaGrupo(
    '2026-10-20', [EVENTO], flById, undefined, PARTICIPANTES_MAP
  );

  // Ana está no grupo → @<número> no texto + nome visível ao lado
  assert.ok(texto.includes('@5511987654321'),       'Ana mencionada pelo número JID');
  assert.ok(texto.includes('Ana Lima'),             'nome de Ana visível no texto');
  assert.ok(!texto.includes('@Ana Lima'),           'sem @nome no texto (não funciona como menção)');

  // Bruno não está → apenas nome, sem @ de qualquer tipo
  assert.ok(texto.includes('Bruno Costa'),         'Bruno aparece no texto');
  assert.ok(!texto.includes('@Bruno Costa'),        'Bruno sem @ no texto');
  assert.ok(!texto.includes('@5511976543210'),      'Bruno sem @JID numérico');

  // Carlos sem telefone → apenas nome
  assert.ok(texto.includes('Carlos Melo'),         'Carlos aparece no texto');
  assert.ok(!texto.includes('@Carlos'),             'Carlos sem @');

  // mentions contém JID real de Ana (para notificação)
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

  // No fallback, Ana e Bruno são mencionados pelo número JID
  assert.ok(texto.includes('@5511987654321'), 'Ana mencionada pelo número no fallback');
  assert.ok(texto.includes('@5511976543210'), 'Bruno mencionado pelo número no fallback');
  assert.ok(texto.includes('Ana Lima'),       'nome de Ana visível no fallback');
  assert.ok(texto.includes('Bruno Costa'),    'nome de Bruno visível no fallback');

  // Ninguém vai para "fora do grupo" no fallback
  assert.equal(foraDaGrupo.length, 0, 'sem foraDaGrupo no fallback');
  assert.equal(mentions.length, 2, 'dois JIDs no fallback');

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
  assert.ok(msg.startsWith('Oi Bruno Costa'),      'template personalizado aplicado');
  assert.ok(msg.includes('TERÇA-FEIRA — 20/10'),   'data extenso com em-dash');
});
