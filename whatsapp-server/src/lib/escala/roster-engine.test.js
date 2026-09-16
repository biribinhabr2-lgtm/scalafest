'use strict';

/**
 * roster-engine.test.js
 *
 * node --test src/lib/escala/roster-engine.test.js
 */

const { test }   = require('node:test');
const assert     = require('node:assert/strict');

const {
  sugerirEscala,
  rankCandidatos,
  calcScore,
  DEFAULT_WEIGHTS,
  ROTATION_CONFIG,
  _checkDisponibilidade,
} = require('./roster-engine');

// ─── Fábrica de contexto ──────────────────────────────────────────────────────

function makeCtx(overrides = {}) {
  return {
    event: {
      id:         'ev-001',
      data:       '2026-10-10',
      horaInicio: '10:00',
      horaFim:    '13:00',
    },
    requiredRoles: [
      { funcao: 'Líder',      quantidade: 1, obrigatorio: true },
      { funcao: 'Personagem', quantidade: 2, obrigatorio: true },
    ],
    freelancers: [
      { id: '1', nome: 'Ana',   funcoes: ['Líder', 'Personagem'], ativo: true  },
      { id: '2', nome: 'Bia',   funcoes: ['Personagem'],          ativo: true  },
      { id: '3', nome: 'Carol', funcoes: ['Líder'],               ativo: true  },
      { id: '4', nome: 'Dani',  funcoes: ['Personagem'],          ativo: false },
      { id: '5', nome: 'Elena', funcoes: ['Personagem'],          ativo: true  },
    ],
    disponibilidade: {},
    historico:       {},
    conflitos:       new Set(),
    jaEscalados:     new Set(),
    eventServiceIds:   ['svc-001'],
    eventServiceNames: ['Bluey e Bingo'],
    _now: new Date('2026-10-10T12:00:00Z'),
    ...overrides,
  };
}

// ─── 1. História vazia: seleciona por função ─────────────────────────────────

test('história vazia: seleciona por função e disponibilidade', () => {
  const ctx  = makeCtx();
  const { vagas } = sugerirEscala(ctx);

  const vagaLider     = vagas.find(v => v.funcao === 'Líder');
  const vagaPersonagem = vagas.find(v => v.funcao === 'Personagem');

  assert.ok(vagaLider,      'Deve haver vaga de Líder');
  assert.ok(vagaPersonagem, 'Deve haver vaga de Personagem');

  // Dani está inativa → não deve aparecer
  const todosCandidatos = vagaPersonagem.candidatos.map(c => c.nome);
  assert.ok(!todosCandidatos.includes('Dani'), 'Freelancer inativo não deve aparecer');

  assert.equal(vagaLider.sugeridos.length,     1, 'Deve sugerir 1 líder');
  assert.equal(vagaPersonagem.sugeridos.length, 2, 'Deve sugerir 2 personagens');

  // Sem repetição cross-função
  const liderId      = vagaLider.sugeridos[0]?.freelancerId;
  const personagemIds = vagaPersonagem.sugeridos.map(c => c.freelancerId);
  assert.ok(!personagemIds.includes(liderId), 'Freelancer não deve aparecer em duas funções');
});

// ─── 2. Indisponível: excluído ───────────────────────────────────────────────

test('freelancer indisponível na data: excluído', () => {
  const ctx = makeCtx({
    disponibilidade: { '1': { '2026-10-10': 'indisponivel' } },
  });

  const { vagas } = sugerirEscala(ctx);
  const vagaLider = vagas.find(v => v.funcao === 'Líder');

  assert.equal(vagaLider.sugeridos[0].nome, 'Carol', 'Deve sugerir Carol, não Ana (indisponível)');

  const ana = vagaLider.candidatos.find(c => c.freelancerId === '1');
  assert.ok(ana?.eliminado, 'Ana deve estar marcada como eliminada');
  assert.match(ana.motivos[0], /indispon/i);
});

// ─── 3. Conflito de horário: excluído ────────────────────────────────────────

test('conflito de horário: excluído', () => {
  const ctx = makeCtx({ conflitos: new Set(['2']) });

  const { vagas }      = sugerirEscala(ctx);
  const vagaPersonagem  = vagas.find(v => v.funcao === 'Personagem');

  const bia = vagaPersonagem.candidatos.find(c => c.freelancerId === '2');
  assert.ok(bia?.eliminado, 'Bia deve estar marcada como eliminada');
  assert.match(bia.motivos[0], /conflito/i);

  const sugeridosIds = vagaPersonagem.sugeridos.map(c => c.freelancerId);
  assert.ok(!sugeridosIds.includes('2'), 'Bia não deve ser sugerida');
});

// ─── 4. Dois serviços no mesmo evento: soma experiência ──────────────────────

test('dois serviços: experiência somada para score de serviço', () => {
  const ctx = makeCtx({
    eventServiceIds: ['svc-001', 'svc-002'],
    historico: {
      '1': { serviceCounts: { 'svc-001': 3, 'svc-002': 4 }, funcaoCounts: {}, lastEventDate: null },
      '3': { serviceCounts: { 'svc-001': 1              }, funcaoCounts: {}, lastEventDate: null },
    },
  });

  const { score: scoreAna }  = calcScore('1', 'Líder', ctx);
  const { score: scoreCarol } = calcScore('3', 'Líder', ctx);

  assert.ok(scoreAna > scoreCarol, 'Ana deve ter score maior por mais experiência nos serviços');
});

// ─── 5. Empate: candidato com mais tempo parado tem maior score ───────────────

test('empate: candidato com mais tempo sem trabalhar tem maior score', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const ctx = makeCtx({
    historico: {
      '1': { serviceCounts: {}, funcaoCounts: { 'Personagem': 5 }, lastEventDate: '2026-09-01' }, // 39 dias
      '2': { serviceCounts: {}, funcaoCounts: { 'Personagem': 5 }, lastEventDate: '2026-09-20' }, // 20 dias
    },
    _now: now,
  });

  const { score: scoreAna } = calcScore('1', 'Personagem', ctx);
  const { score: scoreBia } = calcScore('2', 'Personagem', ctx);

  assert.ok(scoreAna > scoreBia, 'Ana (mais tempo parada) deve ter score maior');
});

// ─── 6. Sem candidato para função obrigatória ────────────────────────────────

test('sem candidato para função: semSugestao preenchido', () => {
  const ctx = makeCtx({
    freelancers: [{ id: '2', nome: 'Bia', funcoes: ['Personagem'], ativo: true }],
  });

  const { vagas }  = sugerirEscala(ctx);
  const vagaLider = vagas.find(v => v.funcao === 'Líder');

  assert.equal(vagaLider.sugeridos.length, 0, 'Nenhum sugerido para Líder');
  assert.ok(vagaLider.semSugestao, 'semSugestao deve estar preenchido');
  assert.match(vagaLider.semSugestao, /nenhum candidato/i);
});

// ─── 7. Estrelas: candidato com mais estrelas supera quem tem menos ──────────

test('estrelas: candidato com mais estrelas supera (mesma experiência de função)', () => {
  const ctx = makeCtx({
    freelancers: [
      { id: '1', nome: 'Ana',  funcoes: ['Líder', 'Personagem'], ativo: true, estrelas: 5 },
      { id: '3', nome: 'Carol', funcoes: ['Líder'],              ativo: true, estrelas: 2 },
    ],
    historico: {}, // sem histórico → funcaoExp = 0 para ambas
  });

  const { score: scoreAna }  = calcScore('1', 'Líder', ctx);
  const { score: scoreCarol } = calcScore('3', 'Líder', ctx);

  assert.ok(scoreAna > scoreCarol, 'Ana (5 estrelas) deve ter score maior que Carol (2 estrelas)');
});

// ─── 8. Já escalado no evento: não aparece como elegível ─────────────────────

test('já escalado no evento: não aparece como candidato elegível', () => {
  const ctx = makeCtx({ jaEscalados: new Set(['1']) });

  const candidatos = rankCandidatos('Líder', ctx);
  const ana        = candidatos.find(c => c.freelancerId === '1');

  assert.ok(ana?.eliminado, 'Ana já escalada deve ser marcada como eliminada');
});

// ─── 9. Disponibilidade parcial "apos" não cobre evento → eliminado ──────────

test('parcial "apos" que não cobre o evento: eliminado', () => {
  // Evento: 10h–13h. Ana disponível apenas a partir de 11h → NÃO cobre (10h < 11h)
  const ctx = makeCtx({
    disponibilidade: {
      '1': { '2026-10-10': { status: 'parcial', tipo: 'apos', hora: '11:00' } },
    },
  });

  const candidatos = rankCandidatos('Líder', ctx);
  const ana        = candidatos.find(c => c.freelancerId === '1');

  assert.ok(ana?.eliminado, 'Ana deve ser eliminada (disponível só a partir de 11h, evento começa 10h)');
  assert.match(ana.motivos[0], /11h/);
});

// ─── 10. Disponibilidade parcial "apos" que cobre → elegível ─────────────────

test('parcial "apos" que cobre o evento: elegível', () => {
  // Evento: 10h–13h. Bia disponível a partir de 09h → cobre (10h >= 09h)
  const ctx = makeCtx({
    disponibilidade: {
      '3': { '2026-10-10': { status: 'parcial', tipo: 'apos', hora: '09:00' } },
    },
  });

  const candidatos = rankCandidatos('Líder', ctx);
  const carol      = candidatos.find(c => c.freelancerId === '3');

  assert.ok(!carol?.eliminado, 'Carol deve ser elegível (disponível a partir de 9h, evento começa 10h)');
});

// ─── 11. Disponibilidade parcial "antes" não cobre → eliminado ───────────────

test('parcial "antes" que não cobre o evento: eliminado', () => {
  // Evento: 10h–13h. Carol disponível só até 12h → NÃO cobre (evento termina 13h > 12h)
  const ctx = makeCtx({
    disponibilidade: {
      '3': { '2026-10-10': { status: 'parcial', tipo: 'antes', hora: '12:00' } },
    },
  });

  const candidatos = rankCandidatos('Líder', ctx);
  const carol      = candidatos.find(c => c.freelancerId === '3');

  assert.ok(carol?.eliminado, 'Carol deve ser eliminada (disponível só até 12h, evento termina 13h)');
});

// ─── 12. Disponibilidade parcial "entre" não cobre → eliminado ───────────────

test('parcial "entre" que não cobre o evento: eliminado', () => {
  // Evento: 10h–13h. Disponível 11h às 14h → NÃO cobre (evento começa 10h < 11h)
  const ctx = makeCtx({
    disponibilidade: {
      '1': { '2026-10-10': { status: 'parcial', tipo: 'entre', hora: '11:00', hora2: '14:00' } },
    },
  });

  const candidatos = rankCandidatos('Líder', ctx);
  const ana        = candidatos.find(c => c.freelancerId === '1');

  assert.ok(ana?.eliminado, 'Ana deve ser eliminada (janela 11h–14h não cobre início 10h)');
});

// ─── 13. Disponibilidade parcial "entre" que cobre → elegível ────────────────

test('parcial "entre" que cobre o evento: elegível', () => {
  // Evento: 10h–13h. Disponível 09h às 14h → cobre
  const ctx = makeCtx({
    disponibilidade: {
      '1': { '2026-10-10': { status: 'parcial', tipo: 'entre', hora: '09:00', hora2: '14:00' } },
    },
  });

  const candidatos = rankCandidatos('Líder', ctx);
  const ana        = candidatos.find(c => c.freelancerId === '1');

  assert.ok(!ana?.eliminado, 'Ana deve ser elegível (janela 09h–14h cobre evento 10h–13h)');
});

// ─── 14. Regra de rotação: substitui menor score por candidato parado ─────────

test('regra de rotação: substitui alocação de menor score por candidato parado', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const ctx = makeCtx({
    // Ana, Bia e Elena como Personagem; Carol e Ana como Líder
    requiredRoles: [{ funcao: 'Personagem', quantidade: 2, obrigatorio: true }],
    freelancers: [
      { id: '1', nome: 'Ana',   funcoes: ['Personagem'], ativo: true }, // 2 dias parada
      { id: '2', nome: 'Bia',   funcoes: ['Personagem'], ativo: true }, // 5 dias parada
      { id: '5', nome: 'Elena', funcoes: ['Personagem'], ativo: true }, // 20 dias parada (threshold=14)
    ],
    historico: {
      '1': { serviceCounts: {}, funcaoCounts: { 'Personagem': 10 }, lastEventDate: '2026-10-08' }, // 2 dias
      '2': { serviceCounts: {}, funcaoCounts: { 'Personagem': 8  }, lastEventDate: '2026-10-05' }, // 5 dias
      '5': { serviceCounts: {}, funcaoCounts: { 'Personagem': 2  }, lastEventDate: '2026-09-20' }, // 20 dias
    },
    _now: now,
  });

  const { vagas } = sugerirEscala(ctx);
  const vaga = vagas.find(v => v.funcao === 'Personagem');

  // Elena (20 dias) deve entrar pela rotação
  const sugeridosIds = vaga.sugeridos.map(s => s.freelancerId);
  assert.ok(sugeridosIds.includes('5'), 'Elena deve entrar pela regra de rotação');

  // A que entrou pela rotação deve ter rotacao: true
  const elena = vaga.sugeridos.find(s => s.freelancerId === '5');
  assert.ok(elena?.rotacao === true, 'Elena deve estar marcada como rotação');
});

// ─── 15. Rotação: sem candidato parado → aviso ───────────────────────────────

test('rotação sem candidato elegível parado: retorna aviso_rotacao', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const ctx = makeCtx({
    requiredRoles: [{ funcao: 'Personagem', quantidade: 1, obrigatorio: true }],
    freelancers: [
      { id: '1', nome: 'Ana', funcoes: ['Personagem'], ativo: true }, // 3 dias — abaixo de 14
      { id: '2', nome: 'Bia', funcoes: ['Personagem'], ativo: true }, // 5 dias — abaixo de 14
    ],
    historico: {
      '1': { serviceCounts: {}, funcaoCounts: {}, lastEventDate: '2026-10-07' }, // 3 dias
      '2': { serviceCounts: {}, funcaoCounts: {}, lastEventDate: '2026-10-05' }, // 5 dias
    },
    _now: now,
  });

  const result = sugerirEscala(ctx);

  assert.ok(result.aviso_rotacao, 'Deve haver aviso_rotacao');
  assert.match(result.aviso_rotacao, /ninguém.*rotação/i);
});

// ─── 16. Motivos corretos no candidato ───────────────────────────────────────

test('motivos do candidato estão no formato correto', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const ctx = makeCtx({
    requiredRoles: [{ funcao: 'Personagem', quantidade: 1, obrigatorio: true }],
    freelancers: [
      { id: '1', nome: 'Ana', funcoes: ['Personagem'], ativo: true, estrelas: 4 },
    ],
    historico: {
      '1': { serviceCounts: { 'svc-001': 3 }, funcaoCounts: { 'Personagem': 12 }, lastEventDate: '2026-09-19' }, // 21 dias
    },
    _now: now,
  });

  const { vagas } = sugerirEscala(ctx);
  const ana = vagas[0].sugeridos[0];

  assert.ok(ana, 'Ana deve ser sugerida');
  const motivos = ana.motivos;

  assert.ok(motivos.some(m => /12 eventos como Personagem/i.test(m)), 'deve informar eventos na função');
  assert.ok(motivos.some(m => /4 estrela/i.test(m)), 'deve informar estrelas');
  assert.ok(motivos.some(m => /21 dia/i.test(m)), 'deve informar dias parada');
  assert.ok(motivos.some(m => /Bluey e Bingo.*3x/i.test(m)), 'deve informar experiência no serviço');
  assert.ok(motivos.some(m => /Disponível/i.test(m)), 'deve informar janela de disponibilidade');
});
