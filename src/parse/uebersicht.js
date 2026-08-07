// Parser für die "Übersichtsseite" eines Planeten:
// Flottenbewegungen + Gebäudeaufträge + Schiffe + aktuelle Rohstoffe.
import { splitCells, coordOf, parseGwInt, RE_COORD } from '../util/format.js';
import { RESOURCES, buildingKey, shipKey, resourceKey } from '../domain.js';

const RE_TIME = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/;

/* ---------- Missionen ---------- */
const MISSIONS = [
  { re: /angriff|attack/i, key: 'Angriff', icon: '⚔️', hostile: true },
  { re: /zerst[öo]r/i, key: 'Zerstören', icon: '💥', hostile: true },
  { re: /spionage|spion/i, key: 'Spionage', icon: '🔍', hostile: false, spy: true },
  { re: /stationier/i, key: 'Stationierung', icon: '🛡️', hostile: false },
  { re: /transport/i, key: 'Transport', icon: '📦', hostile: false },
  { re: /sammeln|recycl|tr[üu]mmer/i, key: 'Sammeln', icon: '♻️', hostile: false },
  { re: /kolonis/i, key: 'Kolonisieren', icon: '🌱', hostile: false },
  { re: /handel|trade/i, key: 'Handel', icon: '🤝', hostile: false },
  { re: /verb[üu]nde|unterst[üu]tz|halten/i, key: 'Unterstützung', icon: '🤝', hostile: false },
  { re: /r[üu]ckflug|zur[üu]ck/i, key: 'Rückflug', icon: '↩️', hostile: false },
];
function classifyMission(raw) {
  const t = (raw || '').trim();
  for (const m of MISSIONS) if (m.re.test(t)) return { ...m, raw: t };
  return { key: t || 'Unbekannt', icon: '❔', hostile: false, raw: t };
}

const SECTIONS = [
  { re: /fremde|feindlich/i, key: 'fremd' },
  { re: /r[üu]ckflug|zur[üu]ck/i, key: 'rueck' },
  { re: /hinflug|hin\b/i, key: 'hin' },
  { re: /eigene/i, key: 'hin' },
];

// Zeilen, an denen die Flotten enden und Zusatzsektionen beginnen.
const TRAILING = /^(Gebäudeaufträge|Gebaeudeauftraege|Forschungsaufträge|Forschungsauftraege|Schiffe\s*\(|Verteidigungsanlagen|Handelsposten\s+Lager|Punkte\b)/i;

/** Nur echte Flotten-Überschriften: enthält "Flotten"/Zähler UND genau ein "(n)". */
function headerOf(l) {
  if (RE_TIME.test(l) || RE_COORD.test(l)) return undefined;
  const counts = (l.match(/\(\s*\d+\s*\)/g) || []).length;
  if (counts > 1) return undefined; // Navigations-/Summenzeile
  if (!/flott/i.test(l) && !/\(\s*\d+\s*\)\s*$/.test(l)) return undefined;
  return SECTIONS.find((s) => s.re.test(l));
}

function resolveRoute(section, c1, c2, mine) {
  const isMine = (c) => mine.has(c);
  if (section === 'fremd') {
    if (isMine(c2) && !isMine(c1)) return { start: c1, ziel: c2 };
    if (isMine(c1) && !isMine(c2)) return { start: c2, ziel: c1 };
    return { start: c1, ziel: c2 };
  }
  if (section === 'rueck') {
    if (isMine(c1) && !isMine(c2)) return { start: c2, ziel: c1 };
    if (isMine(c2) && !isMine(c1)) return { start: c1, ziel: c2 };
    return { start: c2, ziel: c1 };
  }
  return { start: c1, ziel: c2 };
}

/** Flottenbewegungen. `ownPlanets` = Set eigener Koordinaten (für Start/Ziel). */
export function parseFleets(text, ownPlanets = new Set()) {
  const all = text.split(/\r?\n/).map((l) => l.replace(/\u00a0/g, ' ').trim());
  // Bei den Zusatzsektionen abschneiden, damit deren Zeilen keine Flotten stören.
  let end = all.findIndex((l) => TRAILING.test(l));
  const lines = end === -1 ? all : all.slice(0, end);

  let firstHeader = lines.findIndex((l) => l && headerOf(l));
  if (firstHeader === -1) firstHeader = lines.length;

  const blocks = [];
  let section = '', cur = null;

  const isMissionText = (l) => !!l && !RE_TIME.test(l) && !RE_COORD.test(l) &&
    !headerOf(l) && !/^[\d.,\s%+-]*$/.test(l);
  const startsEntry = (i) => {
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j]) continue;
      return isMissionText(lines[j]);
    }
    return false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const sec = headerOf(line);
    if (sec) { section = sec.key; if (cur) { blocks.push(cur); cur = null; } continue; }
    const mt = RE_TIME.exec(line);
    if (mt && section && startsEntry(i)) {
      if (cur) blocks.push(cur);
      cur = { section, sec: +mt[1] * 3600 + +mt[2] * 60 + +mt[3], countdown: line, lines: [] };
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) blocks.push(cur);

  const events = [];
  for (const b of blocks) {
    const coords = [], texts = [];
    for (const l of b.lines) {
      const c = coordOf(l);
      if (c && RE_COORD.test(l)) coords.push(c);
      else if (!/^[\d.,\s%+-]*$/.test(l)) texts.push(l);
    }
    if (!coords.length) continue;
    const mission = classifyMission(texts[0] || (b.section === 'rueck' ? 'Rückflug' : ''));
    const player = texts.slice(1).find((t) => t.length > 1 && !/^\(|\)$/.test(t)) || '';
    const [c1, c2] = [coords[0], coords[1] || coords[0]];
    const { start, ziel } = resolveRoute(b.section, c1, c2, ownPlanets);
    events.push({
      section: b.section, countdown: b.countdown, offsetSec: b.sec,
      mission: mission.key, icon: mission.icon,
      hostile: b.section === 'fremd' && mission.hostile,
      spy: !!mission.spy && b.section === 'fremd',
      own: b.section !== 'fremd', start, ziel, player,
      owner: b.section === 'fremd' ? 'Feind'
        : (b.section === 'rueck' ? 'Eigene · Rückflug' : 'Eigene · Hinflug'),
    });
  }
  events.sort((a, b) => a.offsetSec - b.offsetSec);
  return events;
}

/** Snapshot-Zeit aus Kopfzeile "10:03:23 - 07.08.2026". */
export function parseSnapshot(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  for (let i = 0; i < Math.min(40, lines.length); i++) {
    const l = lines[i];
    const md = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(l);
    const mt = /\b(\d{1,2}):([0-5]\d):([0-5]\d)\b/.exec(l);
    if (mt && (/nachricht/i.test(l) || md || /-\s*\d{1,2}\./.test(l))) {
      return {
        sec: +mt[1] * 3600 + +mt[2] * 60 + +mt[3],
        date: md ? { d: +md[1], m: +md[2], y: +md[3] } : null,
      };
    }
  }
  return { sec: null, date: null };
}

export function parseUebersicht(text, ownPlanets = new Set()) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\u00a0/g, ' ').replace(/\s+$/, ''));

  const result = {
    type: 'uebersicht',
    snapshot: parseSnapshot(text),
    activePlanet: null,
    activeResources: {},
    tradePost: {},
    ships: {},
    buildOrders: [],
    // Wurde die Sektion "Gebäudeaufträge" überhaupt mitkopiert? Nur dann ist
    // die Liste vollständig und darf ältere Gesamtübersicht-Daten überstimmen.
    buildSection: false,
    buildCount: null,
    counts: {},
    fleets: parseFleets(text, ownPlanets),
  };

  // Aktiver Planet: Koordinate mit [M]-Marker (Hauptplanet) …
  const active = lines.find((l) => /^\d+:\d+:\d+\s*\[/.test(l.trim()));
  if (active) result.activePlanet = coordOf(active);
  // … sonst die erste Koordinate direkt unter der "Planet"-Überschrift.
  if (!result.activePlanet) {
    const hdr = lines.findIndex((l) => /^Planet\s*$/i.test(l.trim()));
    if (hdr !== -1) {
      for (let i = hdr + 1; i < Math.min(hdr + 6, lines.length); i++) {
        const c = lines[i].trim();
        if (!c) continue;
        if (RE_COORD.test(c)) { result.activePlanet = coordOf(c); }
        break;
      }
    }
  }

  // Navigations-/Summenzeile mit Zählern.
  const nav = lines.find((l) => /Eigene Flotten \(\d+\).*Fremde Flotten \(\d+\)/i.test(l));
  if (nav) {
    const g = (re) => { const m = re.exec(nav); return m ? +m[1] : null; };
    result.counts = {
      eigeneFlotten: g(/Eigene Flotten \((\d+)\)/i),
      fremdeFlotten: g(/Fremde Flotten \((\d+)\)/i),
      gebaeude: g(/Gebäude \((\d+)\)/i),
      forschungen: g(/Forschungen \((\d+)\)/i),
      handel: g(/Handel \((\d+)\)/i),
    };
  }

  // Aktuelle Rohstoffe: oberer Block, Res-Name gefolgt von Zahl.
  const resDe = new Set(RESOURCES.map((r) => r.de));
  const firstFleet = lines.findIndex((l) => headerOf(l.trim()));
  const top = firstFleet === -1 ? lines : lines.slice(0, firstFleet);
  for (let i = 0; i < top.length - 1; i++) {
    const name = top[i].trim();
    if (resDe.has(name)) {
      const val = parseGwInt(top[i + 1].trim());
      if (val != null) result.activeResources[resourceKey(name)] = val;
    }
  }

  // Zeilenbasierte Zusatzsektionen (Tab-getrennt).
  let section = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^Gebäudeaufträge/i.test(line)) {
      section = 'build';
      result.buildSection = true;
      const m = /\((\d+)\)/.exec(line);
      if (m) result.buildCount = +m[1];
      continue;
    }
    if (/^Forschungsaufträge/i.test(line)) { section = 'research'; continue; }
    if (/^Schiffe\s*\(/i.test(line)) { section = 'ships'; continue; }
    if (/^Verteidigungsanlagen/i.test(line)) { section = 'defense'; continue; }
    if (/^Handelsposten\s+Lager/i.test(line)) { section = 'trade'; continue; }
    if (/^(Punkte|Gesamtübersicht|Hilfe)\b/i.test(line)) { section = null; continue; }

    const cells = splitCells(line);
    if (section === 'build' && cells.length >= 3) {
      const remainingSec = timeToSec(cells[0]);
      const mo = /^(.+?)\s+Stufe\s+(\d+)$/i.exec(cells[1]);
      const coord = coordOf(cells[2]);
      if (mo && coord) {
        result.buildOrders.push({
          remainingSec, name: mo[1].trim(), level: +mo[2],
          key: buildingKey(mo[1].trim()), coord,
        });
      }
    } else if (section === 'ships' && cells.length >= 2) {
      const n = parseGwInt(cells[1]);
      if (n != null) result.ships[shipKey(cells[0]) ?? cells[0]] = n;
    } else if (section === 'trade' && cells.length >= 2) {
      const rk = resourceKey(cells[0]);
      if (rk) result.tradePost[rk] = parseGwInt(cells[1]) ?? 0;
    }
  }

  return result;
}

function timeToSec(s) {
  const m = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(String(s || '').trim());
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
}
