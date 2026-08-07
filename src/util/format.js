// Format- und Parse-Helfer (framework-frei, in Node und Browser nutzbar).

export const pad = (n) => String(n).padStart(2, '0');

/** Deutsche Zahl ("344.761", "-11.736", "7,88") -> Number. "-"/"" -> null. */
export function parseGwNumber(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '' || s === '-') return null;
  // Tausenderpunkte entfernen, Dezimalkomma zu Punkt.
  const norm = s.replace(/\./g, '').replace(',', '.');
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

/** Ganzzahl-Variante (ignoriert Nachkommastellen der Durchschnittsspalten). */
export function parseGwInt(raw) {
  const n = parseGwNumber(raw);
  return n == null ? null : Math.round(n);
}

/**
 * Restzeit-Strings in Sekunden.
 *  "00:24:38", "18:22:19", "7 Tage, 16:44:08", "30 Tage, 08:45:35"
 *  "-"/"" -> null.
 */
export function parseDuration(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '' || s === '-') return null;
  const m = /(?:(\d+)\s*Tage?,?\s*)?(\d{1,4}):([0-5]?\d):([0-5]\d)/.exec(s);
  if (!m) return null;
  const days = m[1] ? +m[1] : 0;
  return days * 86400 + +m[2] * 3600 + +m[3] * 60 + +m[4];
}

/** "HH:MM:SS" -> Sekunden seit Mitternacht, sonst null. */
export function parseClock(raw) {
  const m = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(String(raw || '').trim());
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
}

/** Speicher-Zelle "19 (21.960.000)" -> {level:19, cap:21960000}. */
export function parseLevelWithCap(raw) {
  const s = String(raw ?? '').trim();
  const m = /^(-?\d+)\s*\(([\d.]+)\)\s*$/.exec(s);
  if (m) return { level: +m[1], cap: parseGwInt(m[2]) };
  const lvl = parseGwInt(s);
  return { level: lvl, cap: null };
}

/**
 * Bauauftrags-Zelle "Eisenspeicher Stufe 1 (00:24:38)" ->
 *   {name:'Eisenspeicher', level:1, remainingSec:1478}. "-" -> null.
 */
export function parseBuildCell(raw) {
  const s = String(raw ?? '').trim();
  if (s === '' || s === '-') return null;
  const m = /^(.+?)\s+Stufe\s+(\d+)\s*\(([^)]+)\)\s*$/i.exec(s);
  if (!m) return null;
  return { name: m[1].trim(), level: +m[2], remainingSec: parseDuration(m[3]) };
}

/** Zeile in Spalten: Tab bevorzugt, sonst 2+ Leerzeichen (Chat-Paste). */
export function splitCells(line) {
  const raw = line.includes('\t') ? line.split('\t') : line.split(/ {2,}/);
  return raw.map((c) => c.replace(/\u00a0/g, ' ').trim());
}

export const RE_COORD = /^\[?(\d{1,3}):(\d{1,3}):(\d{1,3})\]?/;

/** Erstes Koordinaten-Vorkommen einer Zelle -> "g:s:p" (normalisiert). */
export function coordOf(raw) {
  const m = RE_COORD.exec(String(raw || '').trim());
  return m ? `${+m[1]}:${+m[2]}:${+m[3]}` : null;
}
