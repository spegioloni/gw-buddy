// Highscore-Listen (Community → Highscore). Beide Reiter sind reine
// Tab-Tabellen, die über viele Seiten hinweg kopiert werden: zwischen den
// Seiten stehen jeweils wieder Menü- und Pager-Zeilen, die hier wegfallen.
//
//   Spieler:  Rang | Name [Allianz] | Planetenpunkte | Forschung | Gesamt | Planeten
//   Planeten: Rang | Koordinate     | Besitzer       | Punkte
import { parseGwInt, splitCells } from '../util/format.js';

const HEAD_PLAYERS = /Name\s+Planetenpunkte\s+Forschungspunkte\s+Gesamtpunkte\s+Planeten/i;
const HEAD_PLANETS = /Koordinate\s+Besitzer\s+Punkte/i;

export const looksLikePlayerHighscore = (text) => HEAD_PLAYERS.test(String(text || ''));
export const looksLikePlanetHighscore = (text) =>
  !looksLikePlayerHighscore(text) && HEAD_PLANETS.test(String(text || ''));

/** "capy [Fox-Wing]" -> {name:'capy', alliance:'Fox-Wing'}; ohne Tag alliance=null. */
export function splitPlayerName(raw) {
  const s = String(raw ?? '').replace(/\u00a0/g, ' ').trim();
  const m = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(s);
  if (m) return { name: m[1].trim(), alliance: m[2].trim() || null };
  return { name: s, alliance: null };
}

// Ab Rang 1000 trägt die Rangspalte einen Tausenderpunkt ("3.401").
const isRank = (cell) => /^\d{1,3}(\.\d{3})*$/.test(String(cell ?? '').trim());

/**
 * Spieler-Highscore.
 * @returns {{rows:Array, pages:number, duplicates:number}}
 */
export function parsePlayerHighscore(text) {
  const seen = new Map();
  let duplicates = 0, pages = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (HEAD_PLAYERS.test(line)) { pages++; continue; }
    if (!line.includes('\t')) continue;
    const c = splitCells(line);
    if (c.length < 6 || !isRank(c[0])) continue;
    const { name, alliance } = splitPlayerName(c[1]);
    if (!name) continue;
    const total = parseGwInt(c[4]);
    if (total == null) continue;
    if (seen.has(name)) { duplicates++; continue; }
    seen.set(name, {
      rank: parseGwInt(c[0]),
      name,
      alliance,
      planetPoints: parseGwInt(c[2]) ?? 0,
      researchPoints: parseGwInt(c[3]) ?? 0,
      totalPoints: total,
      planetCount: parseGwInt(c[5]) ?? 0,
    });
  }
  return { rows: [...seen.values()], pages, duplicates };
}

/**
 * Planeten-Highscore.
 * @returns {{rows:Array, pages:number, duplicates:number}}
 */
export function parsePlanetHighscore(text) {
  const seen = new Map();
  let duplicates = 0, pages = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (HEAD_PLANETS.test(line)) { pages++; continue; }
    if (!line.includes('\t')) continue;
    const c = splitCells(line);
    if (c.length < 4 || !isRank(c[0])) continue;
    const m = /^(\d{1,3}):(\d{1,3}):(\d{1,3})$/.exec(c[1].trim());
    if (!m) continue;
    const points = parseGwInt(c[3]);
    if (points == null) continue;
    const coord = `${+m[1]}:${+m[2]}:${+m[3]}`;
    if (seen.has(coord)) { duplicates++; continue; }
    // Der Planeten-Reiter führt den Besitzer ohne Allianz-Tag — trotzdem
    // durch denselben Splitter, damit Sonderfälle nicht durchrutschen.
    const { name } = splitPlayerName(c[2]);
    seen.set(coord, {
      rank: parseGwInt(c[0]),
      coord,
      galaxy: +m[1],
      system: +m[2],
      position: +m[3],
      owner: name,
      points,
    });
  }
  return { rows: [...seen.values()], pages, duplicates };
}
