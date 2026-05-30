'use strict';
const https = require('https');

const key = () => process.env.GOOGLE_MAPS_KEY || '';

/** HTTP GET → JSON */
function get(url) {
  return new Promise((res, rej) => {
    https.get(url, r => {
      let d = '';
      r.on('data', c => { d += c; });
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

/** HTTP POST → JSON */
function post(url, body, headers = {}) {
  return new Promise((res, rej) => {
    const payload = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers },
    }, r => {
      let d = '';
      r.on('data', c => { d += c; });
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    });
    req.on('error', rej);
    req.write(payload);
    req.end();
  });
}

/**
 * Distance Matrix API — N×N matrix of durations/distances.
 * origins/destinations: array of addresses or "lat,lng" strings.
 */
async function distanceMatrix(origins, destinations, departureTime = null) {
  if (!key()) throw new Error('GOOGLE_MAPS_KEY não configurada.');
  const p = new URLSearchParams({
    origins: origins.join('|'),
    destinations: destinations.join('|'),
    mode: 'driving', language: 'pt-BR', key: key(),
    ...(departureTime && {
      departure_time: String(Math.floor(Date.now() / 1000)),
      traffic_model: 'best_guess',
    }),
  });
  const data = await get(`https://maps.googleapis.com/maps/api/distancematrix/json?${p}`);
  if (data.status !== 'OK') throw new Error(`Distance Matrix: ${data.status}`);
  return data;
}

/**
 * Routes API — single route between two points.
 * Returns { duracao_min, distancia_km, duracao_seg, distancia_m }
 */
async function routeInfo(origin, destination, departureTime = null) {
  if (!key()) throw new Error('GOOGLE_MAPS_KEY não configurada.');
  const body = {
    origin: { address: origin },
    destination: { address: destination },
    travelMode: 'DRIVE',
    routingPreference: departureTime ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE',
    computeAlternativeRoutes: false,
    languageCode: 'pt-BR',
    ...(departureTime && { departureTime: new Date(departureTime).toISOString() }),
  };
  const data = await post(
    'https://routes.googleapis.com/directions/v2:computeRoutes',
    body,
    { 'X-Goog-Api-Key': key(), 'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters' }
  );
  const route = data?.routes?.[0];
  if (!route) throw new Error('Nenhuma rota retornada pelo Google.');
  const seg = parseInt(route.duration?.replace('s', '') || 0);
  return {
    duracao_seg: seg,
    duracao_min: Math.ceil(seg / 60),
    distancia_m: route.distanceMeters || 0,
    distancia_km: Math.round((route.distanceMeters || 0) / 100) / 10,
  };
}

/**
 * Calculates ideal departure time.
 * departure = event_start − travel_min − safety_min − loading_min
 */
function horarioSaida(eventoISO, duracaoMin, cfg) {
  const total = duracaoMin + (cfg.tempo_seguranca_min || 30) + (cfg.tempo_carga_min || 20);
  return new Date(new Date(eventoISO).getTime() - total * 60_000);
}

/**
 * Google Maps navigation URL (opens directly in app/browser).
 */
function mapsUrl(origin, destination, waypoints = []) {
  const parts = [origin, ...waypoints, destination].map(encodeURIComponent).join('/');
  return `https://www.google.com/maps/dir/${parts}`;
}

module.exports = { distanceMatrix, routeInfo, horarioSaida, mapsUrl };
