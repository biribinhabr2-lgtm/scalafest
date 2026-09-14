'use strict';

// Remove diacritics, collapse spaces, lowercase, keep only a-z 0-9 space.
function normalizar(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract duration from a block string.
// Returns { semDuracao: string, duracaoMin: number|null }
function extrairDuracaoDoBloco(texto) {
  let duracaoMin = null;
  let semDuracao = texto;

  // 1. hh:mm (check first so "1:30" doesn't get captured as "1h")
  let m = texto.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) {
    duracaoMin = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    semDuracao = texto.slice(0, m.index) + texto.slice(m.index + m[0].length);
  } else {
    // 2. Xh[Y[min]] — "1h", "2h30", "1h 30", "1h30min", "2 h", "2 h 30 min"
    m = texto.match(/\b(\d{1,2})\s*h\s*(\d{1,2})?\s*(?:min(?:utos?)?)?\b/i);
    if (m) {
      duracaoMin = parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
      semDuracao = texto.slice(0, m.index) + texto.slice(m.index + m[0].length);
    } else {
      // 3. X min / X minutos
      m = texto.match(/\b(\d{1,3})\s*min(?:utos?)?\b/i);
      if (m) {
        duracaoMin = parseInt(m[1], 10);
        semDuracao = texto.slice(0, m.index) + texto.slice(m.index + m[0].length);
      }
    }
  }

  return { semDuracao: semDuracao.trim(), duracaoMin };
}

// Parse an event title into service blocks and client name.
// Returns: { blocos: [{ nomeBruto, nomeNormalizado, duracaoMin }], cliente, restos }
function parseTituloEvento(titulo) {
  if (!titulo || !titulo.trim()) {
    return { blocos: [], cliente: null, restos: '' };
  }

  const s = titulo.trim();

  // Find last hyphen separator (-, –, —) possibly surrounded by spaces.
  const SEP = /\s*[-–—]\s*/g;
  let lastMatch = null;
  let m;
  while ((m = SEP.exec(s)) !== null) {
    lastMatch = m;
  }

  let corpo, cliente;
  if (lastMatch) {
    const candidato = s.slice(lastMatch.index + lastMatch[0].length).trim();
    // Treat as client only if it has at least one letter and contains no "+"
    // (a "+" inside the "client" means it was not really a client separator)
    if (candidato && /[a-záéíóúãõàâêîôûüçñ]/i.test(candidato) && !candidato.includes('+')) {
      corpo = s.slice(0, lastMatch.index).trim();
      cliente = candidato;
    } else {
      corpo = s;
      cliente = null;
    }
  } else {
    corpo = s;
    cliente = null;
  }

  // Split by "+" into service blocks
  const rawBlocos = corpo.split('+').map(b => b.trim()).filter(Boolean);

  const blocos = rawBlocos.map(raw => {
    const { semDuracao, duracaoMin } = extrairDuracaoDoBloco(raw);
    return {
      nomeBruto: raw,
      nomeNormalizado: normalizar(semDuracao),
      duracaoMin,
    };
  });

  return { blocos, cliente, restos: corpo };
}

module.exports = { parseTituloEvento, normalizar, extrairDuracaoDoBloco };
