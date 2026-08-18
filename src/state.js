// Zentraler Zustand: Merge aus Gesamtübersicht + Übersichtsseite, Persistenz,
// Serverzeit aus dem Paste-Snapshot. Kein API-Zugriff.
import { detectType } from './parse/detect.js';
import { parseGesamt } from './parse/gesamt.js';
import { parseUebersicht } from './parse/uebersicht.js';
import { parseHtmlOverview } from './parse/html.js';
import { parseFarmReports, farmSummary } from './parse/farmberichte.js';

const LS = {
  get(k, d) { try { const v = localStorage.getItem('gw_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('gw_' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

export const state = {
  gesamtText: '',
  uebersichtText: '',
  htmlText: '',
  farmText: '',
  farmPaste: '',         // Inhalt des Eingabefelds (überlebt Re-Renders)
  farmReports: [],
  farmShowAll: { profitable: false, unvisited: false, enroute: false },
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
  htmlAt: null,
  fleetSource: null,
  gesamtRefAt: null,     // Serverzeit-Bezug für Restzeiten aus der Gesamtübersicht
  buildSource: null,     // welche Quelle die Bauaufträge geliefert hat
  snapshotAge: null,     // Sekunden zwischen Snapshot und Paste-Moment
  lastError: null,
  radar: {               // Farmradar (Supabase) — nur Laufzeitzustand
    settings: null,      // wird in loadPersisted() gesetzt
    user: null,          // eingeloggter Supabase-Nutzer
    rows: [],            // Zeilen aus der View `inactive_farms`
    snapshots: [],       // letzte Importe
    paste: '',           // eingefügte Highscore-Liste (überlebt Re-Renders)
    loadedAt: null,
    busy: null,          // 'login' | 'load' | 'push' | null
    error: null,
    notice: null,
    unpicked: new Set(), // vom Export abgewählte Ziele (Koordinaten)
    showAll: false,      // Zielliste vollständig zeigen statt nur der Spitze
  },
  roster: {              // Farmliste (Supabase) — nur Laufzeitzustand
    rows: [],            // Zeilen aus der View `farm_roster_stats`
    slots: [],           // Zeilen aus `farm_slots`
    origin: '',          // gerade betrachteter eigener Planet
    loadedAt: null,
    busy: null,          // 'load' | 'save' | null
    error: null,
    notice: null,
    showDropped: false,  // Archiv der abgelegten Ziele aufgeklappt?
  },
  loot: {                // Beute-Archiv (Supabase) — nur Laufzeitzustand
    rows: [],            // Zeilen aus der View `farm_loot_daily`
    targets: [],         // Zeilen aus der View `farm_loot_targets`
    loadedAt: null,
    busy: null,          // 'load' | 'push' | null
    error: null,
    notice: null,
    split: 'resource',   // Aufteilung der Balken: 'resource' | 'origin'
    rank: 'total',       // Rangliste der Ziele: 'total' (Summe) | 'avg' (je Flug)
    days: 30,            // Zeitfenster des Diagramms
  },
};

/** Voreinstellungen des Farmradars (überschreibbar per UI, in localStorage). */
export const RADAR_DEFAULTS = {
  idleHours: 72,         // Schwelle in Stunden (72 h = die früheren 3 Tage)
  maxSystems: 20,
  sameGalaxyOnly: true,
  maxPoints: null,
  onlyUntouched: false,  // nur Ziele, die noch nie im Beute-Archiv standen
  notToday: false,       // heute bereits angeflogene Ziele ausblenden
  email: '',
  center: '',            // '' = alle eigenen Planeten als Bezugspunkt
};

/**
 * Gespeicherte Einstellungen lesen. Ältere Stände haben noch `idleDays` —
 * der Wert wird einmalig in Stunden umgerechnet, damit niemand seine
 * Filtereinstellung verliert.
 */
function readRadar() {
  const raw = LS.get('radar', {}) || {};
  const cfg = { ...RADAR_DEFAULTS, ...raw };
  if (raw.idleHours == null && raw.idleDays != null) {
    cfg.idleHours = Math.max(1, Math.round(Number(raw.idleDays) * 24));
  }
  delete cfg.idleDays;
  return cfg;
}

export const serverNow = () => Date.now() + state.serverOffset;

export function loadPersisted() {
  state.radar.settings = readRadar();
  state.gesamtText = LS.get('gesamtText', '');
  state.uebersichtText = LS.get('uebersichtText', '');
  state.htmlText = LS.get('htmlText', '');
  state.farmText = LS.get('farmText', '');
  state.gesamtAt = LS.get('gesamtAt', null);
  state.uebersichtAt = LS.get('uebersichtAt', null);
  state.htmlAt = LS.get('htmlAt', null);
  state.farmReports = parseFarmReports(state.farmText);
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
  } else if (type === 'html') {
    state.htmlText = text;
    state.htmlAt = wall;
    LS.set('htmlText', text);
    LS.set('htmlAt', wall);
  } else if (type === 'farmberichte') {
    state.farmText = text;
    state.farmReports = parseFarmReports(text);
    state.farmShowAll = { profitable: false, unvisited: false, enroute: false };
    LS.set('farmText', text);
    return { type, ok: true, message: `${state.farmReports.length} Berichte · ${farmSummary(state.farmReports).farms.length} Farmen` };
  } else if (type === 'highscore_spieler' || type === 'highscore_planeten') {
    state.lastError = 'Highscore-Listen gehören in den Farmradar-Tab.';
    return { type, ok: false, message: state.lastError };
  } else {
    state.lastError = 'Konnte den Text keinem Format zuordnen.';
    return { type, ok: false, message: state.lastError };
  }
  const res = rebuild(wall);
  return { type, ok: true, message: res.message };
}

/**
 * Die Übersichtsseite beschreibt die aktuellen Flüge, die Gesamtübersicht den
 * stationierten Referenzbestand. Nur dieses Paar ergibt eine belastbare Lage.
 *
 * Die Übersicht wird in beiden Formaten akzeptiert: als HTML-Quelltext oder
 * als reiner Seitentext. HTML ist die reichere Quelle (Schiffe, Fracht und
 * exakte Unix-Ankunftszeiten stecken nur in den Tooltips), Text genügt aber
 * für Missionen, Routen und Ankunftszeiten.
 */
export function ingestRequiredPair(overview, gesamt) {
  const overviewType = detectType(overview);
  if ((overviewType !== 'html' && overviewType !== 'uebersicht') || detectType(gesamt) !== 'gesamt') {
    state.lastError = 'Bitte Übersichtsseite (HTML oder Text) und Gesamtübersicht in die passenden Felder einfügen.';
    return { ok: false, message: state.lastError };
  }
  const wall = Date.now();
  state.gesamtText = gesamt;
  state.gesamtAt = wall;
  LS.set('gesamtText', gesamt);
  LS.set('gesamtAt', wall);
  // Beide Übersichts-Formate beschreiben denselben Stand. Nur das gerade
  // eingefügte darf gelten — sonst mischt das andere ältere Flotten- oder
  // Bauauftragsdaten wieder ein.
  const html = overviewType === 'html' ? overview : '';
  const text = overviewType === 'html' ? '' : overview;
  state.htmlText = html;
  state.htmlAt = html ? wall : null;
  state.uebersichtText = text;
  state.uebersichtAt = text ? wall : null;
  LS.set('htmlText', html);
  LS.set('htmlAt', state.htmlAt);
  LS.set('uebersichtText', text);
  LS.set('uebersichtAt', state.uebersichtAt);
  const res = rebuild(wall);
  return { ok: true, message: res.message };
}

export const hasRequiredData = () => !!(state.gesamt && state.fleetSource);

export function clearAll() {
  state.gesamtText = ''; state.uebersichtText = ''; state.htmlText = ''; state.farmText = '';
  state.farmReports = [];
  state.gesamtAt = null; state.uebersichtAt = null; state.htmlAt = null;
  LS.set('gesamtText', ''); LS.set('uebersichtText', '');
  LS.set('gesamtAt', null); LS.set('uebersichtAt', null);
  LS.set('htmlText', ''); LS.set('htmlAt', null);
  LS.set('farmText', '');
  rebuild(Date.now());
}

export function clearFarmReports() {
  state.farmText = '';
  state.farmReports = [];
  state.farmShowAll = { profitable: false, unvisited: false, enroute: false };
  LS.set('farmText', '');
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
  const textOverview = state.uebersichtText
    ? safe(() => parseUebersicht(state.uebersichtText, state.ownPlanets)) : null;
  const htmlOverview = state.htmlText ? safe(() => parseHtmlOverview(state.htmlText)) : null;
  // Flotten sind ein vollständiger Snapshot. Der neuere Stand gewinnt;
  // bei Gleichstand HTML, weil nur er Schiffe und Fracht enthält.
  const textAbs = snapshotToAbs(textOverview?.snapshot, wall);
  const htmlAbs = htmlOverview?.snapshot?.abs ?? null;
  const fleetOverview = htmlAbs != null && (textAbs == null || htmlAbs >= textAbs)
    ? htmlOverview : textOverview;
  state.fleetSource = fleetOverview === htmlOverview ? 'html' : fleetOverview ? 'text' : null;
  state.uebersicht = textOverview ?? htmlOverview;

  // 3) Referenzzeit & Serverzeit-Offset.
  const uAbs = fleetOverview?.snapshot?.abs ?? snapshotToAbs(fleetOverview?.snapshot, wall);
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
  state.fleets = (fleetOverview?.fleets ?? []).map((e) => ({ ...e, at: e.at ?? ref + e.offsetSec * 1000 }));

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
  setTab: (v) => LS.set('tab', v), getTab: () => LS.get('tab', 'lage'),
  getForecastTargets: () => LS.get('forecastTargets', {}),
  setForecastTarget: (coord, key, value) => {
    const targets = LS.get('forecastTargets', {});
    const id = `${coord}|${key}`;
    if (value == null) delete targets[id];
    else targets[id] = value;
    LS.set('forecastTargets', targets);
  },
  getRadar: () => readRadar(),
  setRadar: (patch) => {
    const next = { ...readRadar(), ...patch };
    LS.set('radar', next);
    state.radar.settings = next;
    return next;
  },
};
