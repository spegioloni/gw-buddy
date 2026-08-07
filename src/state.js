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
  snapshotAge: null,     // Sekunden zwischen Snapshot und Paste-Moment
  lastError: null,
};

export const serverNow = () => Date.now() + state.serverOffset;

export function loadPersisted() {
  state.gesamtText = LS.get('gesamtText', '');
  state.uebersichtText = LS.get('uebersichtText', '');
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
  if (type === 'gesamt') {
    state.gesamtText = text;
    LS.set('gesamtText', text);
  } else if (type === 'uebersicht') {
    state.uebersichtText = text;
    LS.set('uebersichtText', text);
  } else {
    state.lastError = 'Konnte den Text keinem Format zuordnen.';
    return { type, ok: false, message: state.lastError };
  }
  const res = rebuild(Date.now());
  return { type, ok: true, message: res.message };
}

export function clearAll() {
  state.gesamtText = ''; state.uebersichtText = '';
  LS.set('gesamtText', ''); LS.set('uebersichtText', '');
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

  // 4) Planeten-Datensätze zusammenführen.
  buildPlanets();

  // 5) Flotten & Bauaufträge mit absoluten Zeiten.
  const ref = state.refAt;
  state.fleets = (state.uebersicht?.fleets ?? []).map((e) => ({ ...e, at: ref + e.offsetSec * 1000 }));

  const orders = [];
  if (state.uebersicht?.buildOrders?.length) {
    for (const b of state.uebersicht.buildOrders) {
      orders.push({ ...b, at: ref + (b.remainingSec ?? 0) * 1000, source: 'uebersicht' });
    }
  } else if (state.gesamt) {
    for (const [coord, p] of Object.entries(state.gesamt.byPlanet)) {
      if (p.buildOrder && p.buildOrder.remainingSec != null) {
        orders.push({ coord, name: p.buildOrder.name, level: p.buildOrder.level, key: p.buildOrder.key,
          remainingSec: p.buildOrder.remainingSec, at: ref + p.buildOrder.remainingSec * 1000, source: 'gesamt' });
      }
    }
  }
  orders.sort((a, b) => a.at - b.at);
  state.buildOrders = orders;

  const parts = [];
  if (state.gesamt) parts.push(`${state.gesamt.planets.length} Planeten`);
  if (state.uebersicht) parts.push(`${state.fleets.length} Flotten`, `${state.buildOrders.length} Bauaufträge`);
  return { message: parts.join(' · ') || 'keine Daten' };
}

function buildPlanets() {
  const map = new Map();
  const ensure = (coord) => {
    if (!map.has(coord)) {
      map.set(coord, {
        coord, mine: state.ownPlanets.has(coord),
        points: null, resources: {}, production: {}, waterUsage: null, tradePost: {},
        buildings: {}, ships: {}, defense: {}, shipyardFreeSec: null, buildOrder: null,
        fleets: [], stationedSource: null,
      });
    }
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
