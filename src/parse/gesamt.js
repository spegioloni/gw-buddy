// Parser für die "Gesamtübersicht"-Matrix (alle Planeten in Spalten).
import {
  splitCells, coordOf, parseGwInt, parseGwNumber, parseDuration,
  parseLevelWithCap, parseBuildCell,
} from '../util/format.js';
import { buildingKey, shipKey, defenceKey, resourceKey } from '../domain.js';

/** "146,16 ckk" -> 146.16. "-"/"" -> null. */
const parseCkk = (raw) => parseGwNumber(String(raw ?? '').replace(/ckk/i, ''));

const RES_ROWS = new Set(['Eisen', 'Lutinum', 'Wasser', 'Wasserstoff']);

// Erkennung der Sektions-Überschriften (einzellige Zeilen).
function sectionOf(label) {
  const l = label.toLowerCase();
  if (l === 'rohstoffe') return 'resources';
  if (l.startsWith('rohstoffförderung') || l.startsWith('rohstofffoerderung')) return 'production';
  if (l.startsWith('handelsposten-lager')) return 'tradePost';
  if (l === 'gebäude' || l === 'gebaeude') return 'buildings';
  if (l === 'schiffe') return 'ships';
  if (l === 'verteidigung') return 'defense';
  return null;
}

/** Ist der Text plausibel eine Gesamtübersicht? (Planet-Zeile mit ≥2 Koordinaten) */
export function looksLikeGesamt(text) {
  for (const line of text.split(/\r?\n/)) {
    if (!/^Planet\b/.test(line.trim())) continue;
    const cells = splitCells(line);
    const coords = cells.slice(1).filter((c) => coordOf(c));
    if (coords.length >= 2) return true;
  }
  return false;
}

export function parseGesamt(text) {
  const lines = text.split(/\r?\n/);
  const result = {
    type: 'gesamt',
    owner: null,
    planets: [],
    planetCount: null,
    byPlanet: {},
    unknownRows: [],
    totals: { resources: {}, production: {}, points: null, ckkShips: null, ckkDefense: null },
  };

  let section = 'head';
  let coords = [];

  const ensure = (coord) => {
    if (!result.byPlanet[coord]) {
      result.byPlanet[coord] = {
        coord,
        points: null,
        buildOrder: null,      // {name, level, remainingSec, key}
        shipyardFreeSec: null, // Sekunden bis Schiffsfabrik frei; null = frei/idle
        resources: {}, production: {}, waterUsage: null, tradePost: {},
        buildings: {}, ships: {}, defense: {}, ckkShips: null, ckkDefense: null,
      };
    }
    return result.byPlanet[coord];
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\u00a0/g, ' ').replace(/\s+$/, '');
    if (!line.trim()) continue;
    const cells = splitCells(line);
    const label = cells[0];

    // Kopfzeile: "Gesamtübersicht spegioloni ..."
    if (section === 'head' && /gesamt(ü|ue)bersicht/i.test(label)) {
      const m = /gesamt(?:ü|ue)bersicht\s+(\S+)/i.exec(label);
      if (m) result.owner = m[1];
      continue;
    }

    // Sektions-Überschrift (nur eine sinnvolle Zelle)?
    const lone = cells.filter(Boolean);
    if (lone.length === 1) {
      const sec = sectionOf(label);
      if (sec) { section = sec; continue; }
      // Unbekannte Einzelzeile = fremde/neue Sektion. Ohne diesen Abbruch
      // liefen ihre Zeilen weiter in die zuletzt aktive Sektion und tauchten
      // z.B. als "Verteidigungsanlagen" auf, die es gar nicht gibt.
      if (section !== 'head') { section = null; continue; }
    }
    if (section === null) continue;

    // Planet-Kopfzeile -> Spaltenreihenfolge.
    if (section === 'head' && label === 'Planet') {
      coords = [];
      for (let i = 1; i < cells.length; i++) {
        const c = coordOf(cells[i]);
        if (c) coords.push(c);
      }
      result.planets = coords.slice();
      coords.forEach(ensure);
      // Planetenzahl = letzte reine Ganzzahl-Zelle.
      const last = parseGwInt(cells[cells.length - 1]);
      result.planetCount = last ?? coords.length;
      continue;
    }

    const N = coords.length;
    const cellFor = (i) => cells[i + 1]; // i = Planetenindex (0-basiert)

    if (section === 'head') {
      if (label === 'Gebäude' || label === 'Gebaeude') {
        for (let i = 0; i < N; i++) {
          const bo = parseBuildCell(cellFor(i));
          if (bo) ensure(coords[i]).buildOrder = { ...bo, key: buildingKey(bo.name) };
        }
      } else if (label === 'Schiffsfabrik') {
        for (let i = 0; i < N; i++) ensure(coords[i]).shipyardFreeSec = parseDuration(cellFor(i));
      } else if (label === 'Punkte') {
        for (let i = 0; i < N; i++) ensure(coords[i]).points = parseGwInt(cellFor(i));
        result.totals.points = parseGwInt(cells[cells.length - 1]);
      }
      continue;
    }

    if (section === 'resources' || section === 'production' || section === 'tradePost') {
      const target = section === 'resources' ? 'resources'
        : section === 'production' ? 'production' : 'tradePost';
      if (RES_ROWS.has(label)) {
        const rk = resourceKey(label);
        for (let i = 0; i < N; i++) ensure(coords[i])[target][rk] = parseGwInt(cellFor(i)) ?? 0;
        if (section !== 'tradePost') {
          result.totals[target][rk] = parseGwInt(cells[cells.length - 1]);
        }
      } else if (section === 'production' && /wasserverbrauch/i.test(label)) {
        for (let i = 0; i < N; i++) ensure(coords[i]).waterUsage = parseGwInt(cellFor(i)) ?? 0;
      }
      continue;
    }

    if (section === 'buildings') {
      const key = buildingKey(label) ?? label;
      for (let i = 0; i < N; i++) {
        const { level, cap } = parseLevelWithCap(cellFor(i));
        ensure(coords[i]).buildings[key] = cap != null ? { level: level ?? 0, cap } : (level ?? 0);
      }
      continue;
    }

    if (section === 'ships' || section === 'defense') {
      if (/\bckk\b/i.test(label)) {
        // ckk-Summenzeile: Kampfkraft pro Planet. Anders als sonst trägt
        // diese Zeile KEIN Label — cells[0] ist bereits der Wert des ersten
        // Planeten (deshalb cells[i], nicht cellFor(i)=cells[i+1]).
        const target = section === 'ships' ? 'ckkShips' : 'ckkDefense';
        for (let i = 0; i < N; i++) ensure(coords[i])[target] = parseCkk(cells[i]);
        result.totals[target] = parseCkk(cells[cells.length - 1]);
        continue;
      }
      const bag = section === 'ships' ? 'ships' : 'defense';
      const key = section === 'ships' ? shipKey(label) : defenceKey(label);
      // Nur bekannte Schiffe/Verteidigungsanlagen zählen. Alles andere ist
      // Fremdtext (Forschung, angehängte Seiten) und würde sonst als Bestand
      // gewertet — mit falschem "steht im Feuer"-Alarm als Folge.
      if (!key) { result.unknownRows.push({ section, label }); continue; }
      for (let i = 0; i < N; i++) ensure(coords[i])[bag][key] = parseGwInt(cellFor(i)) ?? 0;
      continue;
    }
  }

  return result;
}
