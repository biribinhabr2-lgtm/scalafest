'use strict';

// Compute bigram similarity between two strings (already normalized).
// Returns 0..1 where 1 = identical.
function bigramSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;

  function bigrams(s) {
    const set = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      set.set(bg, (set.get(bg) || 0) + 1);
    }
    return set;
  }

  const mapA = bigrams(a);
  const mapB = bigrams(b);
  let intersection = 0;

  for (const [bg, countA] of mapA) {
    const countB = mapB.get(bg) || 0;
    intersection += Math.min(countA, countB);
  }

  const totalA = Math.max(a.length - 1, 0);
  const totalB = Math.max(b.length - 1, 0);
  if (totalA + totalB === 0) return 0;
  return (2 * intersection) / (totalA + totalB);
}

// Match a normalized service name against all known keywords.
//
// allKw: [{ serviceId, keyword }]  (keyword already normalized)
//
// Strategy (each step stops if a single clear winner is found):
//   1. Exact match (nomeNorm === keyword)
//   2. Containment: keyword is substr of nomeNorm OR nomeNorm is substr of keyword
//      (both strings must be >= 3 chars; prefers longest keyword on tie → same service)
//   3. Bigram similarity >= 0.60, single dominant winner (gap > 0.15 vs runner-up)
//
// Returns serviceId (string) or null if ambiguous / no match.
function matchServico(nomeNorm, allKw) {
  if (!nomeNorm || !allKw || allKw.length === 0) return null;

  // ── 1. Exact match ────────────────────────────────────────────────────────
  const exactMatches = allKw.filter(k => k.keyword === nomeNorm);
  if (exactMatches.length === 1) return exactMatches[0].serviceId;
  if (exactMatches.length > 1) {
    const ids = new Set(exactMatches.map(k => k.serviceId));
    return ids.size === 1 ? [...ids][0] : null; // same service via multiple kw = ok
  }

  // ── 2. Containment ────────────────────────────────────────────────────────
  const MIN_LEN = 3;
  const contained = allKw.filter(k => {
    if (k.keyword.length < MIN_LEN || nomeNorm.length < MIN_LEN) return false;
    return nomeNorm.includes(k.keyword) || k.keyword.includes(nomeNorm);
  });

  if (contained.length > 0) {
    // Group by serviceId
    const byService = new Map();
    for (const k of contained) {
      if (!byService.has(k.serviceId)) byService.set(k.serviceId, []);
      byService.get(k.serviceId).push(k.keyword);
    }

    if (byService.size === 1) return [...byService.keys()][0];

    // Multiple services — prefer the one with the longest matching keyword
    let bestId = null;
    let bestLen = -1;
    let ambiguous = false;
    for (const [svcId, kws] of byService) {
      const maxLen = Math.max(...kws.map(k => k.length));
      if (maxLen > bestLen) {
        bestLen = maxLen;
        bestId = svcId;
        ambiguous = false;
      } else if (maxLen === bestLen) {
        ambiguous = true;
      }
    }
    return ambiguous ? null : bestId;
  }

  // ── 3. Bigram similarity ──────────────────────────────────────────────────
  const THRESHOLD = 0.60;
  const GAP = 0.15;

  const scored = allKw.map(k => ({
    serviceId: k.serviceId,
    score: bigramSimilarity(nomeNorm, k.keyword),
  })).filter(r => r.score >= THRESHOLD);

  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score);

  // Best score must be clearly dominant
  if (scored.length >= 2 && scored[0].score - scored[1].score < GAP) {
    // Check if both map to the same service
    const top2Services = new Set(scored.slice(0, 2).map(r => r.serviceId));
    if (top2Services.size > 1) return null; // ambiguous
  }

  return scored[0].serviceId;
}

module.exports = { matchServico, bigramSimilarity };
