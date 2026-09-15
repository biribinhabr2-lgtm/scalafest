'use strict';

/**
 * roster-engine.test.js — Testes do motor puro de sugestão de escala.
 *
 * Roda com: node --test src/lib/escala/roster-engine.test.js
 */

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { sugerirEscala, rankCandidatos, calcScore, DEFAULT_WEIGHTS } = require('./roster-engine');

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
      { funcao: 'Líder',      quantidade: 1, obrigatorio: true  },
      { funcao: 'Personagem', quantidade: 2, obrigatorio: true  },
    ],
    freelancers: [
      { id: '1', nome: 'Ana',    funcoes: ['Líder', 'Personagem'], ativo: true,  userId: 'u1' },
      { id: '2', nome: 'Bia',    funcoes: ['Personagem'],          ativo: true,  userId: null },
      { id: '3', nome: 'Carol',  funcoes: ['Líder'],               ativo: true,  userId: null },
      { id: '4', nome: 'Dani',   funcoes: ['Personagem'],          ativo: false, userId: null },
      { id: '5', nome: 'Elena',  funcoes: ['Personagem'],          ativo: true,  userId: null },
    ],
    disponibilidade: {},
    historico:       {},
    feedbacks:       {},
    conflitos:       new Set(),
    semana:          new Set(),
    jaEscalados:     new Set(),
    eventServiceIds:   ['svc-001'],
    eventServiceNames: ['Bluey e Bingo'],
    _now: new Date('2026-10-10T12:00:00Z'),
    ...overrides,
  };
}

// ─── 1. História vazia: cai em função + disponibilidade ──────────────────────

test('história vazia: seleciona por função e disponibilidade', () => {
  const ctx = makeCtx();
  const vagas = sugerirEscala(ctx);

  // Líder: Ana (1) ou Carol (3); Personagem: Ana (1) ou Bia (2)
  const vagaLider = vagas.find(v => v.funcao === 'Líder');
  const vagaPersonagem = vagas.find(v => v.funcao === 'Personagem');

  assert.ok(vagaLider,     'Deve haver vaga de Líder');
  assert.ok(vagaPersonagem,'Deve haver vaga de Personagem');

  // Dani está inativa → não deve aparecer
  const todosCandidatos = vagaPersonagem.candidatos.map(c => c.nome);
  assert.ok(!todosCandidatos.includes('Dani'), 'Freelancer inativo não deve aparecer');

  // Deve sugerir 1 líder
  assert.equal(vagaLider.sugeridos.length, 1, 'Deve sugerir 1 líder');

  // Deve sugerir 2 personagens
  assert.equal(vagaPersonagem.sugeridos.length, 2, 'Deve sugerir 2 personagens');

  // Sem repetição: se Ana foi alocada como Líder, não pode ser Personagem
  const liderId = vagaLider.sugeridos[0]?.freelancerId;
  const personagemIds = vagaPersonagem.sugeridos.map(c => c.freelancerId);
  assert.ok(!personagemIds.includes(liderId), 'Freelancer não deve aparecer em duas funções');
});

// ─── 2. Freelancer indisponível: excluído ────────────────────────────────────

test('freelancer indisponível na data: excluído', () => {
  const ctx = makeCtx({
    disponibilidade: {
      '1': { '2026-10-10': 'indisponivel' },
    },
  });

  const vagas = sugerirEscala(ctx);
  const vagaLider = vagas.find(v => v.funcao === 'Líder');

  // Ana está indisponível; Carol é a única com Líder
  assert.equal(vagaLider.sugeridos[0].nome, 'Carol', 'Deve sugerir Carol, não Ana (indisponível)');

  // Ana deve aparecer nos candidatos como eliminada
  const anaCandidata = vagaLider.candidatos.find(c => c.freelancerId === '1');
  assert.ok(anaCandidata?.eliminado, 'Ana deve estar marcada como eliminada');
  assert.match(anaCandidata.motivos[0], /indispon/i);
});

// ─── 3. Conflito de horário: excluído ────────────────────────────────────────

test('conflito de horário: excluído', () => {
  const ctx = makeCtx({
    conflitos: new Set(['2']), // Bia tem conflito
  });

  const vagaPersonagem = sugerirEscala(ctx).find(v => v.funcao === 'Personagem');

  // Bia está excluída por conflito
  const biaCandidata = vagaPersonagem.candidatos.find(c => c.freelancerId === '2');
  assert.ok(biaCandidata?.eliminado, 'Bia deve estar marcada como eliminada');
  assert.match(biaCandidata.motivos[0], /conflito/i);

  // Personagem: deve vir Ana (única disponível além de Bia)
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

  // Ana: 3+4=7 eventos nos dois serviços → maior serviceExp que Carol (1)
  const { score: scoreAna } = calcScore('1', 'Líder', ctx);
  const { score: scoreCarol } = calcScore('3', 'Líder', ctx);

  assert.ok(scoreAna > scoreCarol, 'Ana deve ter score maior que Carol por mais experiência nos serviços');
});

// ─── 5. Empate resolvido por rotação ─────────────────────────────────────────

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

  // Mesma experiência de função (5x cada), mas Ana ficou mais tempo sem trabalhar
  assert.ok(scoreAna > scoreBia, 'Ana (mais tempo sem trabalhar) deve ter score maior');
});

// ─── 6. Sem candidato para função obrigatória ────────────────────────────────

test('sem candidato para função: semSugestao preenchido', () => {
  const ctx = makeCtx({
    freelancers: [
      { id: '2', nome: 'Bia', funcoes: ['Personagem'], ativo: true },
      // nenhum com Líder ativo
    ],
  });

  const vagaLider = sugerirEscala(ctx).find(v => v.funcao === 'Líder');

  assert.equal(vagaLider.sugeridos.length, 0, 'Nenhum sugerido para Líder');
  assert.ok(vagaLider.semSugestao, 'semSugestao deve estar preenchido');
  assert.match(vagaLider.semSugestao, /nenhum candidato/i);
});

// ─── 7. Penalidade de semana não elimina, apenas reduz score ─────────────────

test('penalidade de semana: reduz score mas não elimina', () => {
  const ctx = makeCtx({
    semana: new Set(['3']), // Carol já escalada na semana
    freelancers: [
      { id: '3', nome: 'Carol', funcoes: ['Líder'], ativo: true },
    ],
    requiredRoles: [{ funcao: 'Líder', quantidade: 1, obrigatorio: true }],
  });

  const vagaLider = sugerirEscala(ctx).find(v => v.funcao === 'Líder');

  // Carol deve ser sugerida mesmo com penalidade (é a única)
  assert.equal(vagaLider.sugeridos.length, 1);
  assert.equal(vagaLider.sugeridos[0].nome, 'Carol');

  // Score deve incluir aviso de semana
  const motivos = vagaLider.sugeridos[0].motivos;
  assert.ok(motivos.some(m => /semana/i.test(m)), 'Deve informar penalidade de semana nos motivos');
});

// ─── 8. Já escalado neste evento: excluído ───────────────────────────────────

test('já escalado no evento: não aparece como candidato elegível', () => {
  const ctx = makeCtx({
    jaEscalados: new Set(['1']), // Ana já está na equipe
  });

  const candidatos = rankCandidatos('Líder', ctx);
  const ana = candidatos.find(c => c.freelancerId === '1');

  assert.ok(ana?.eliminado, 'Ana já escalada deve ser marcada como eliminada');
});
