// Zentraler Zustand: Merge aus Gesamtübersicht + Übersichtsseite, Persistenz,
// Serverzeit aus dem Paste-Snapshot. Kein API-Zugriff.
import { detectType } from './parse/detect.js';
import { parseGesamt } from './parse/gesamt.js';
import { parseUebersicht } from './parse/uebersicht.js';

const LS = {
  get(k, d) { try { const v = localStorage.getItem('gw_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('gw_' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

export const state = {
  gesamtText: '',
  uebersichtText: '',
  gesamt: null,          // geparste Gesamtübersicht
  uebersicht: null,      // geparste Übersichtsseite
  ownPlanets: new Set(), // eigene Koordinaten (persistiert)
  planets: new Map(),    // coord -> zusammengeführter Planeten-Datensatz
  fleets: [],            // Flottenbewegungen mit absoluter Ankunftszeit .at
  buildOrders: [],       // laufende Bauaufträge mit absoluter Fertigzeit .at
  serverOffset: 0,       // Serverzeit(ms) − lokale Zeit(ms)
  refAt: null,           // absolute Referenzzeit des Snapshots (ms)
  gesamtAt: null,        // Wanduhr-Zeit des Gesamtübersicht-Pastes (ms)
  uebersichtAt: null,    // Wanduhr-Zeit des Übersichtsseiten-Pastes (ms)
  gesamtRefAt: null,     // Serverzeit-Bezug für Restzeiten aus der Gesamtübersicht
  buildSource: null,     // welche Quelle die Bauaufträge geliefert hat
  snapshotAge: null,     // Sekunden zwischen Snapshot und Paste-Moment
  lastError: null,
};

export const serverNow = () => Date.now() + state.serverOffset;

export function loadPersisted() {
  state.gesamtText = LS.get('gesamtText', '');
  state.uebersichtText = LS.get('uebersichtText', '');
  state.gesamtAt = LS.get('gesamtAt', null);
  state.uebersichtAt = LS.get('uebersichtAt', null);
  const own = LS.get('ownPlanets', []);
  state.ownPlanets = new Set(Array.isArray(own) ? own : []);
  rebuild(Date.now());
}

/** Snapshot-Header (Sekunden seit Mitternacht + optionales Datum) -> absolute ms. */
function snapshotToAbs(snap, wall) {
  if (!snap || snap.sec == null) return null;
  const now = new Date(wall);
  let abs;
  if (snap.date) {
    abs = new Date(snap.date.y, snap.date.m - 1, snap.date.d, 0, 0, 0, 0).getTime() + snap.sec * 1000;
  } else {
    abs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() + snap.sec * 1000;
    if (abs - wall > 6 * 3600e3) abs -= 86400e3; // Snapshot lag scheinbar in der Zukunft -> gestern
  }
  return abs;
}

/**
 * Neuen Paste einarbeiten. Ergänzt bestehende Daten (Gesamtübersicht ODER
 * Übersichtsseite), erkennt den Typ automatisch.
 * @returns {{type:string, ok:boolean, message:string}}
 */
export function ingest(text) {
  const type = detectType(text);
  const wall = Date.now();
  if (type === 'gesamt') {
    state.gesamtText = text;
    state.gesamtAt = wall;
    LS.set('gesamtText', text);
    LS.set('gesamtAt', wall);
  } else if (type === 'uebersicht') {
    state.uebersichtText = text;
    state.uebersichtAt = wall;
    LS.set('uebersichtText', text);
    LS.set('uebersichtAt', wall);
  } else {
    state.lastError = 'Konnte den Text keinem Format zuordnen.';
    return { type, ok: false, message: state.lastError };
  }
  const res = rebuild(wall);
  return { type, ok: true, message: res.message };
}

export function clearAll() {
  state.gesamtText = ''; state.uebersichtText = '';
  state.gesamtAt = null; state.uebersichtAt = null;
  LS.set('gesamtText', ''); LS.set('uebersichtText', '');
  LS.set('gesamtAt', null); LS.set('uebersichtAt', null);
  rebuild(Date.now());
}

/** Gesamten Zustand aus den beiden Rohtexten neu aufbauen. */
export function rebuild(wall) {
  // 1) Gesamtübersicht -> Stammdaten + eigene Planeten.
  state.gesamt = state.gesamtText ? safe(() => parseGesamt(state.gesamtText)) : null;
  if (state.gesamt?.planets?.length) {
    state.ownPlanets = new Set(state.gesamt.planets);
    LS.set('ownPlanets', [...state.ownPlanets]);
  }

  // 2) Übersichtsseite -> Snapshot-Zeit, Flotten, Bauaufträge, aktive Rohstoffe.
  state.uebersicht = state.uebersichtText
    ? safe(() => parseUebersicht(state.uebersichtText, state.ownPlanets))
    : null;

  // 3) Referenzzeit & Serverzeit-Offset.
  const uAbs = snapshotToAbs(state.uebersicht?.snapshot, wall);
  state.refAt = uAbs ?? wall;
  state.serverOffset = state.refAt - wall;
  state.snapshotAge = uAbs != null ? Math.max(0, (wall - uAbs) / 1000) : null;
  // Die Gesamtübersicht trägt keinen Zeitstempel — ihre Restzeiten galten im
  // Moment des Einfügens. In Serverzeit umgerechnet ergibt das ihren Bezug.
  state.gesamtRefAt = state.gesamtAt != null
    ? state.gesamtAt + state.serverOffset
    : state.refAt;

  // 4) Planeten-Datensätze zusammenführen.
  buildPlanets();

  // 5) Flotten & Bauaufträge mit absoluten Zeiten.
  const ref = state.refAt;
  state.fleets = (state.uebersicht?.fleets ?? []).map((e) => ({ ...e, at: ref + e.offsetSec * 1000 }));

  const { orders, source } = mergeBuildOrders();
  state.buildOrders = orders;
  state.buildSource = source;

  // 6) Bauaufträge auf die Planeten zurückschreiben. Beide Quellen listen
  //    jeweils ALLE laufenden Aufträge — die maßgebliche Quelle entscheidet
  //    deshalb auch, wo KEIN Auftrag läuft (ein Planet ohne Eintrag ist frei,
  //    auch wenn das ältere Dokument dort noch einen Auftrag zeigt).
  if (source) {
    const byCoord = new Map(state.buildOrders.map((o) => [o.coord, o]));
    for (const coord of byCoord.keys()) ensurePlanet(coord);
    for (const [coord, p] of state.planets) {
      const o = byCoord.get(coord);
      p.buildOrder = o
        ? { name: o.name, level: o.level, key: o.key, remainingSec: o.remainingSec }
        : null;
    }
  }

  const parts = [];
  if (state.gesamt) parts.push(`${state.gesamt.planets.length} Planeten`);
  if (state.uebersicht) parts.push(`${state.fleets.length} Flotten`, `${state.buildOrders.length} Bauaufträge`);
  return { message: parts.join(' · ') || 'keine Daten' };
}

/**
 * Bauaufträge aus beiden Quellen abgleichen.
 *
 * Beide Dokumente listen jeweils den kompletten Stand — sie ergänzen sich
 * nicht, sie widersprechen sich höchstens. Deshalb gewinnt das zuletzt
 * eingefügte Dokument; das ältere springt nur ein, wenn das jüngere gar
 * keine Bausektion mitbringt. Innerhalb einer Quelle werden Doppelnennungen
 * (gleicher Planet, gleiches Gebäude, gleiche Stufe) zusammengefasst — beim
 * Kopieren aus dem Spiel taucht dieselbe Tabelle gern zweimal im Text auf.
 * @returns {{orders:Array, source:'uebersicht'|'gesamt'|null}}
 */
function mergeBuildOrders() {
  const fromUebersicht = () => (state.uebersicht?.buildOrders ?? []).map((b) => ({
    ...b, at: state.refAt + (b.remainingSec ?? 0) * 1000, source: 'uebersicht',
  }));
  const fromGesamt = () => Object.entries(state.gesamt?.byPlanet ?? {})
    .filter(([, p]) => p.buildOrder && p.buildOrder.remainingSec != null)
    .map(([coord, p]) => ({
      coord, name: p.buildOrder.name, level: p.buildOrder.level, key: p.buildOrder.key,
      remainingSec: p.buildOrder.remainingSec,
      at: state.gesamtRefAt + p.buildOrder.remainingSec * 1000, source: 'gesamt',
    }));

  // "Jünger" heißt: zuletzt eingefügt. Die Gesamtübersicht trägt keine Uhrzeit,
  // also ist der Paste-Moment das einzig belastbare Kriterium für beide.
  const uAt = state.uebersichtAt ?? (state.uebersichtText ? 0 : -Infinity);
  const gAt = state.gesamtAt ?? (state.gesamtText ? 0 : -Infinity);
  const candidates = uAt >= gAt
    ? [['uebersicht', fromUebersicht], ['gesamt', fromGesamt]]
    : [['gesamt', fromGesamt], ['uebersicht', fromUebersicht]];

  for (const [source, load] of candidates) {
    const present = source === 'uebersicht' ? !!state.uebersicht?.buildSection : !!state.gesamt;
    if (!present) continue;
    // Eine leere, aber vorhandene Bausektion ist eine Aussage ("nichts läuft"),
    // kein fehlender Datensatz — dann darf die ältere Quelle nicht einspringen.
    const orders = dedupeOrders(load()).sort((a, b) => a.at - b.at);
    return { orders, source };
  }
  return { orders: [], source: null };
}

/** Gleicher Planet + gleiches Gebäude + gleiche Stufe = derselbe Auftrag. */
function dedupeOrders(orders) {
  const seen = new Map();
  for (const o of orders) {
    const k = `${o.coord}|${o.key ?? o.name}|${o.level}`;
    const prev = seen.get(k);
    // Bei Dubletten die kleinere Restzeit behalten — sie ist die frischere.
    if (!prev || o.at < prev.at) seen.set(k, o);
  }
  return [...seen.values()];
}

function newPlanet(coord) {
  return {
    coord, mine: state.ownPlanets.has(coord),
    points: null, resources: {}, production: {}, waterUsage: null, tradePost: {},
    buildings: {}, ships: {}, defense: {}, shipyardFreeSec: null, buildOrder: null,
    ckkShips: null, ckkDefense: null,
    fleets: [], stationedSource: null,
  };
}

/** Planeten-Datensatz in state.planets sicherstellen. */
function ensurePlanet(coord) {
  if (!state.planets.has(coord)) state.planets.set(coord, newPlanet(coord));
  return state.planets.get(coord);
}

function buildPlanets() {
  const map = new Map();
  const ensure = (coord) => {
    if (!map.has(coord)) map.set(coord, newPlanet(coord));
    return map.get(coord);
  };
  if (state.gesamt) {
    for (const [coord, g] of Object.entries(state.gesamt.byPlanet)) {
      const p = ensure(coord);
      Object.assign(p, {
        points: g.points, resources: { ...g.resources }, production: { ...g.production },
        waterUsage: g.waterUsage, tradePost: { ...g.tradePost }, buildings: { ...g.buildings },
        ships: { ...g.ships }, defense: { ...g.defense },
        shipyardFreeSec: g.shipyardFreeSec, buildOrder: g.buildOrder,
        ckkShips: g.ckkShips, ckkDefense: g.ckkDefense,
        stationedSource: 'gesamt',
      });
    }
  }

  // Aktiver Planet aus der Übersichtsseite: frischere Rohstoffe/Schiffe.
  const u = state.uebersicht;
  if (u?.activePlanet) {
    const p = ensure(u.activePlanet);
    if (Object.keys(u.activeResources).length) p.resources = { ...p.resources, ...u.activeResources };
    if (Object.keys(u.ships).length) { p.ships = { ...u.ships }; p.stationedSource = 'uebersicht'; }
    if (Object.keys(u.tradePost).length) p.tradePost = { ...p.tradePost, ...u.tradePost };
  }

  state.planets = map;
}

const safe = (fn) => { try { return fn(); } catch (e) { state.lastError = String(e?.message || e); return null; } };

export const persist = { setAlarm: (v) => LS.set('alarm', v), getAlarm: () => LS.get('alarm', true),
  setTab: (v) => LS.set('tab', v), getTab: () => LS.get('tab', 'lage') };
