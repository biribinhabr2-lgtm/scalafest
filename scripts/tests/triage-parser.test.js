'use strict';

const assert = require('assert');
const { parseTituloEvento, normalizar, extrairDuracaoDoBloco } = require('../lib/triage-parser');
const { matchServico, bigramSimilarity } = require('../lib/triage-match');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  ✓', name);
    passed++;
  } catch (e) {
    console.error('  ✗', name);
    console.error('    ', e.message);
    failed++;
  }
}

function eq(a, b, msg) {
  assert.deepStrictEqual(a, b, msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ═══════════════════════════════════════════════════════
// normalizar
// ═══════════════════════════════════════════════════════
console.log('\nnormalizar:');

test('lowercase', () => eq(normalizar('Animação'), 'animacao'));
test('remove diacritics', () => eq(normalizar('Ação Héróica'), 'acao heroica'));
test('collapse multiple spaces', () => eq(normalizar('  hello   world  '), 'hello world'));
test('remove special chars', () => eq(normalizar('hello-world!'), 'hello world'));
test('numbers kept', () => eq(normalizar('3h30'), '3h30'));
test('empty string', () => eq(normalizar(''), ''));
test('ç kept as c', () => eq(normalizar('açúcar'), 'acucar'));
test('ñ and ü', () => eq(normalizar('niño müller'), 'nino muller'));

// ═══════════════════════════════════════════════════════
// extrairDuracaoDoBloco
// ═══════════════════════════════════════════════════════
console.log('\nextrairDuracaoDoBloco:');

test('1h', () => {
  const r = extrairDuracaoDoBloco('Animação 1h');
  eq(r.duracaoMin, 60);
  eq(r.semDuracao.trim(), 'Animação');
});

test('2h', () => {
  const r = extrairDuracaoDoBloco('Show 2h');
  eq(r.duracaoMin, 120);
});

test('1h30', () => {
  const r = extrairDuracaoDoBloco('Recreação 1h30');
  eq(r.duracaoMin, 90);
});

test('2h30', () => {
  const r = extrairDuracaoDoBloco('Oficina 2h30');
  eq(r.duracaoMin, 150);
});

test('1:30', () => {
  const r = extrairDuracaoDoBloco('Ballet 1:30');
  eq(r.duracaoMin, 90);
});

test('30min', () => {
  const r = extrairDuracaoDoBloco('Mágica 30min');
  eq(r.duracaoMin, 30);
});

test('90 min (with space)', () => {
  const r = extrairDuracaoDoBloco('Caricatura 90 min');
  eq(r.duracaoMin, 90);
});

test('45minutos', () => {
  const r = extrairDuracaoDoBloco('Palhaço 45minutos');
  eq(r.duracaoMin, 45);
});

test('no duration', () => {
  const r = extrairDuracaoDoBloco('Animação');
  eq(r.duracaoMin, null);
  eq(r.semDuracao, 'Animação');
});

test('1h 30 (space between h and minutes)', () => {
  const r = extrairDuracaoDoBloco('Dança 1h 30');
  eq(r.duracaoMin, 90);
});

// ═══════════════════════════════════════════════════════
// parseTituloEvento
// ═══════════════════════════════════════════════════════
console.log('\nparseTituloEvento:');

test('single service, no client, no duration', () => {
  const r = parseTituloEvento('Animação');
  eq(r.cliente, null);
  eq(r.blocos.length, 1);
  eq(r.blocos[0].nomeNormalizado, 'animacao');
  eq(r.blocos[0].duracaoMin, null);
});

test('client via hyphen', () => {
  const r = parseTituloEvento('Animação 1h - João');
  eq(r.cliente, 'João');
  eq(r.blocos[0].duracaoMin, 60);
  eq(r.blocos[0].nomeNormalizado, 'animacao');
});

test('client via em-dash', () => {
  const r = parseTituloEvento('Show — Maria');
  eq(r.cliente, 'Maria');
});

test('client via en-dash', () => {
  const r = parseTituloEvento('Show – Pedro');
  eq(r.cliente, 'Pedro');
});

test('client is LAST hyphen segment', () => {
  // "Turma do Meier - Recreação 2h - Família Silva"
  // last hyphen → "Família Silva" is client; "Turma do Meier - Recreação 2h" is corpo
  const r = parseTituloEvento('Recreação 2h - Turma do Meier - Família Silva');
  eq(r.cliente, 'Família Silva');
  eq(r.blocos[0].duracaoMin, 120);
  // corpo becomes "Recreação 2h - Turma do Meier" → one block because no "+"
  eq(r.blocos.length, 1);
});

test('two services with "+"', () => {
  const r = parseTituloEvento('Animação 1h + Mágica 30min - Cliente');
  eq(r.cliente, 'Cliente');
  eq(r.blocos.length, 2);
  eq(r.blocos[0].duracaoMin, 60);
  eq(r.blocos[0].nomeNormalizado, 'animacao');
  eq(r.blocos[1].duracaoMin, 30);
  eq(r.blocos[1].nomeNormalizado, 'magica');
});

test('three services', () => {
  const r = parseTituloEvento('Animação 1h + Mágica 30min + Caricatura 45min - Família');
  eq(r.cliente, 'Família');
  eq(r.blocos.length, 3);
  eq(r.blocos[2].nomeNormalizado, 'caricatura');
  eq(r.blocos[2].duracaoMin, 45);
});

test('no client (title has no hyphen)', () => {
  const r = parseTituloEvento('Animação 2h');
  eq(r.cliente, null);
  eq(r.blocos.length, 1);
});

test('hyphen inside service name is not treated as client separator if no letters follow', () => {
  // Edge: "Animação – " → candidato is empty → no client
  const r = parseTituloEvento('Animação – ');
  // candidato is "" → no letters → corpo = full title, no client
  eq(r.cliente, null);
});

test('1h30 duration format', () => {
  const r = parseTituloEvento('Dança 1h30 - Ana');
  eq(r.blocos[0].duracaoMin, 90);
  eq(r.blocos[0].nomeNormalizado, 'danca');
  eq(r.cliente, 'Ana');
});

test('duration 90 min with space', () => {
  const r = parseTituloEvento('Animação 90 min - Turma');
  eq(r.blocos[0].duracaoMin, 90);
});

test('duration 1:30 colon format', () => {
  const r = parseTituloEvento('Ballet 1:30 - Turma');
  eq(r.blocos[0].duracaoMin, 90);
});

test('empty title', () => {
  const r = parseTituloEvento('');
  eq(r.blocos, []);
  eq(r.cliente, null);
});

test('null title', () => {
  const r = parseTituloEvento(null);
  eq(r.blocos, []);
  eq(r.cliente, null);
});

test('+ inside client area is rejected as client', () => {
  // "A + B" — no real hyphen; entire string is corpo
  const r = parseTituloEvento('A + B');
  eq(r.cliente, null);
  eq(r.blocos.length, 2);
});

// ═══════════════════════════════════════════════════════
// matchServico
// ═══════════════════════════════════════════════════════
console.log('\nmatchServico:');

const KW = [
  { serviceId: 'svc-anim', keyword: 'animacao' },
  { serviceId: 'svc-anim', keyword: 'animadora' },
  { serviceId: 'svc-mag',  keyword: 'magica' },
  { serviceId: 'svc-mag',  keyword: 'show de magica' },
  { serviceId: 'svc-car',  keyword: 'caricatura' },
  { serviceId: 'svc-bal',  keyword: 'ballet' },
];

test('exact match', () => eq(matchServico('animacao', KW), 'svc-anim'));
test('exact match magica', () => eq(matchServico('magica', KW), 'svc-mag'));
test('no match returns null', () => eq(matchServico('xyzabc', KW), null));
test('empty returns null', () => eq(matchServico('', KW), null));
test('null kw list returns null', () => eq(matchServico('animacao', null), null));

test('containment: nome contains keyword', () => {
  // "grande animacao" contains keyword "animacao"
  eq(matchServico('grande animacao', KW), 'svc-anim');
});

test('containment: keyword contains nome', () => {
  // "show de magica" keyword contains "magica"
  eq(matchServico('magica', KW), 'svc-mag');
});

test('bigram similarity - close match', () => {
  // "animaçao" -> normalized "animacao" → exact
  const kw = [{ serviceId: 'svc-x', keyword: 'animacao' }];
  eq(matchServico('animcao', kw), 'svc-x'); // close enough
});

test('ambiguous containment returns null', () => {
  const kw = [
    { serviceId: 'svc-a', keyword: 'ani' },
    { serviceId: 'svc-b', keyword: 'ani' },
  ];
  // same keyword length → ambiguous
  eq(matchServico('animacao', kw), null);
});

test('bigramSimilarity same string', () => eq(bigramSimilarity('abc', 'abc'), 1));
test('bigramSimilarity different', () => {
  const s = bigramSimilarity('abc', 'xyz');
  assert.ok(s < 0.3, `Expected low similarity, got ${s}`);
});
test('bigramSimilarity close', () => {
  const s = bigramSimilarity('animacao', 'animcao');
  assert.ok(s > 0.6, `Expected >= 0.6, got ${s}`);
});

// ═══════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════
console.log(`\n${'─'.repeat(40)}`);
console.log(`Total: ${passed + failed}  ✓ ${passed}  ✗ ${failed}`);
if (failed > 0) process.exit(1);
