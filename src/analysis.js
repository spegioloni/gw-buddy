// Ableitungen aus dem State: Bedrohungen, Save-Fenster, freie Kapazität,
// gemeinsame Zeitachse (Flotten + Bau-/Forschungsabschlüsse).
import { state, serverNow } from './state.js';
import { STORAGE_OF, storageCap, protectedAmount, deLabel } from './domain.js';
import { PRODUCERS, tableRate } from './data/production.js';

/** Pro Zielplanet: Angriffe, Spionage, eigene Ankünfte, Save-Fenster. */
export function threatAnalysis() {
  const byPlanet = new Map();
  for (const e of state.fleets) {
    if (!byPlanet.has(e.ziel)) byPlanet.set(e.ziel, []);
    byPlanet.get(e.ziel).push(e);
  }
  const out = [];
  for (const [coord, evs] of byPlanet) {
    evs.sort((a, b) => a.at - b.at);
    const attacks = evs.filter((e) => e.hostile);
    const spies = evs.filter((e) => e.spy);
    const arrivals = evs.filter((e) => e.own);
    const windows = [];
    for (const a of arrivals) {
      const next = attacks.find((x) => x.at > a.at);
      const prev = [...attacks].reverse().find((x) => x.at <= a.at);
      windows.push({
        arrival: a, nextAttack: next || null, prevAttack: prev || null,
        gapSec: next ? (next.at - a.at) / 1000 : null, tooLate: !next && !!prev,
      });
    }
    windows.sort((x, y) => x.arrival.at - y.arrival.at);
    const planet = state.planets.get(coord) || null;
    out.push({
      coord, planet, mine: state.ownPlanets.has(coord),
      events: evs, attacks, spies, arrivals, windows,
      firstAttack: attacks[0] || null,
      lastAttack: attacks.length ? attacks[attacks.length - 1] : null,
      stationed: planet ? stationedSummary(planet) : null,
    });
  }
  out.sort((a, b) => {
    const av = a.attacks.length ? 0 : 1, bv = b.attacks.length ? 0 : 1;
    if (av !== bv) return av - bv;
    return (a.events[0]?.at || 0) - (b.events[0]?.at || 0);
  });
  return out;
}

/** Kurzliste stationierter Schiffe (nur > 0), sortiert nach Menge. */
export function stationedSummary(planet) {
  const ships = Object.entries(planet.ships || {}).filter(([, n]) => n > 0);
  ships.sort((a, b) => b[1] - a[1]);
  const defense = Object.entries(planet.defense || {}).filter(([, n]) => n > 0);
  const total = ships.reduce((s, [, n]) => s + n, 0);
  const defTotal = defense.reduce((s, [, n]) => s + n, 0);
  return { ships, defense, total, defTotal, hasAny: total + defTotal > 0 };
}

/**
 * Eigene Flottenankünfte auf `coord`, die nach dem Snapshot und bis `at`
 * landen. Ohne bekannten künftigen Abflug gilt: einmal gelandet, bleibt die
 * Flotte da — deshalb zählt jede Landung in diesem Zeitraum als Gegenwart.
 */
export function arrivalsBeforeAt(coord, at) {
  const ref = state.refAt ?? serverNow();
  return state.fleets
    .filter((e) => e.own && e.ziel === coord && e.at > ref && e.at <= at)
    .sort((a, b) => a.at - b.at);
}

/**
 * Stationierte Schiffe zu einem Zeitpunkt `at` — der Snapshot-Bestand PLUS
 * eigene Flotten, die zwischenzeitlich (Snapshot bis `at`) dort gelandet
 * sind. Ohne bekannten Abflug bleiben sie im Feuer, wenn danach ein Angriff
 * einschlägt. Ohne diese Ergänzung würde eine kurz vor dem Einschlag
 * zurückkehrende Flotte fälschlich als "save" gelten.
 * @returns {{...stationedSummary, hasAny, arrivals}}
 */
export function stationedAt(planet, coord, at) {
  const base = stationedSummary(planet);
  const arrivals = arrivalsBeforeAt(coord, at);
  return { ...base, hasAny: base.hasAny || arrivals.length > 0, arrivals };
}

/* ---------- Sind die Rohstoffe save? ---------- */

// Wasser bleibt bewusst außen vor: es darf ruhig geplündert werden.
export const PLUNDER_RESOURCES = ['iron', 'lutinum', 'hydrogen'];

const lvlOf = (v) => (v && typeof v === 'object' ? v.level : v) ?? 0;

/** Kapazität und nicht plünderbarer Sockel eines Rohstoffspeichers. */
function storageOf(planet, resKey) {
  const entry = planet.buildings?.[STORAGE_OF[resKey]];
  const level = lvlOf(entry);
  // Die Gesamtübersicht nennt die Kapazität in Klammern — die ist maßgeblich,
  // weil sie den tatsächlichen Wert des Spielstands zeigt.
  const cap = (entry && typeof entry === 'object' && entry.cap != null)
    ? entry.cap : storageCap(level);
  return { level, cap, floor: protectedAmount(cap) };
}

/**
 * Förderrate über die Zeit als Segmente. Die Gesamtübersicht liefert die
 * aktuelle Rate inklusive Planeten-Grundproduktion; ein laufender Minenausbau
 * hebt sie ab seiner Fertigstellung um die Tabellendifferenz der beiden Stufen.
 * Dadurch bleibt die kalibrierte Grundproduktion des Planeten erhalten.
 */
function rateSegments(planet, resKey, ref) {
  const base = planet.production?.[resKey] ?? 0;
  const bo = planet.buildOrder;
  if (!bo?.key || !PRODUCERS[resKey]?.includes(bo.key) || bo.remainingSec == null) {
    return [{ from: ref, to: Infinity, rate: base }];
  }
  const doneAt = ref + bo.remainingSec * 1000;
  const delta = tableRate(bo.key, bo.level) - tableRate(bo.key, bo.level - 1);
  return [
    { from: ref, to: doneAt, rate: base },
    { from: doneAt, to: Infinity, rate: base + delta, upgrade: { key: bo.key, level: bo.level, at: doneAt, delta } },
  ];
}

/** Bestand zu einem Zeitpunkt, segmentweise integriert und am Speicher gedeckelt. */
function stockAt(segs, start, cap, at) {
  let stock = Math.max(0, Math.min(cap, start));
  for (const s of segs) {
    const to = Math.min(s.to, at);
    if (to <= s.from) break;
    stock = Math.max(0, Math.min(cap, stock + s.rate * ((to - s.from) / 3600e3)));
    if (s.to >= at) break;
  }
  return stock;
}

/** Erster Zeitpunkt, zu dem der Bestand `level` erreicht — null = nie. */
function crossesAt(segs, start, cap, level) {
  if (level > cap) return null;
  let stock = Math.max(0, Math.min(cap, start));
  if (stock >= level) return segs[0].from;
  for (const s of segs) {
    if (s.rate <= 0) {
      if (!Number.isFinite(s.to)) return null;
      stock = Math.max(0, stock + s.rate * ((s.to - s.from) / 3600e3));
      continue;
    }
    const need = ((level - stock) / s.rate) * 3600e3;
    if (s.from + need <= s.to) return s.from + need;
    stock = Math.min(cap, stock + s.rate * ((s.to - s.from) / 3600e3));
  }
  return null;
}

/**
 * Bestand eines Rohstoffs zu einem Zeitpunkt hochrechnen.
 * Basis ist der Snapshot der eingefügten Ansichten (state.refAt).
 * @returns {{key,level,cap,floor,rate,stock,loot,full,unsafeAt,fullAt,upgrade}}
 */
export function resourceAt(planet, resKey, at) {
  const ref = state.refAt ?? serverNow();
  const { level, cap, floor } = storageOf(planet, resKey);
  const start = planet.resources?.[resKey] ?? 0;
  const segs = rateSegments(planet, resKey, ref);
  const stock = stockAt(segs, start, cap, Math.max(ref, at));
  const last = segs[segs.length - 1];
  return {
    key: resKey, level, cap, floor,
    rate: segs[0].rate, rateLater: last.rate, upgrade: last.upgrade ?? null,
    stock: Math.round(stock),
    loot: Math.max(0, Math.round(stock - floor)),
    full: stock >= cap,
    unsafeAt: crossesAt(segs, start, cap, floor),
    fullAt: crossesAt(segs, start, cap, cap),
  };
}

/**
 * Beantwortet für einen Zeitpunkt: sind die Rohstoffe save?
 * "Save" heißt, der Bestand von Eisen, Lutinum und Wasserstoff liegt unter dem
 * nicht plünderbaren Sockel (2 % der Speicherkapazität) — dann geht der
 * Angreifer leer aus. Wasser zählt bewusst nicht mit.
 * @returns {{known,loot,stock,safe,byRes,worst,nextUnsafeAt}}
 */
export function plunderRisk(coord, at) {
  const p = state.planets.get(coord);
  // Ohne Gesamtübersicht fehlen Bestände, Förderung und Speicherstufen.
  if (!p || !Object.keys(p.resources || {}).length) {
    return { known: false, loot: 0, stock: 0, safe: false, byRes: [], worst: null, nextUnsafeAt: null };
  }
  const byRes = PLUNDER_RESOURCES.map((k) => resourceAt(p, k, at));
  const loot = byRes.reduce((s, r) => s + r.loot, 0);
  const stock = byRes.reduce((s, r) => s + r.stock, 0);
  const worst = byRes.filter((r) => r.loot > 0).sort((a, b) => b.loot - a.loot)[0] ?? null;
  // Wann kippt der erste Rohstoff über den Sockel? (nur relevant, solange save)
  const upcoming = byRes.map((r) => r.unsafeAt).filter((t) => t != null && t > at);
  return {
    known: true, loot, stock, safe: loot <= 0, byRes, worst,
    nextUnsafeAt: upcoming.length ? Math.min(...upcoming) : null,
  };
}

/** Nächster feindlicher Einschlag auf einen bestimmten Planeten. */
export function nextImpactOn(coord, from = serverNow()) {
  return state.fleets
    .filter((e) => e.hostile && e.ziel === coord && e.at >= from - 1000)
    .sort((a, b) => a.at - b.at)[0] || null;
}

/**
 * Freie Kapazität — zwei unabhängige Dinge:
 *  - noBuild:  kein laufender Gebäude-Bauauftrag
 *  - idleYard: Schiffsfabrik baut gerade nichts
 * Ein Planet kann in beiden, einem oder keinem Topf sein.
 */
export function freeCapacity() {
  const noBuild = [], idleYard = [];
  const lvl = (v) => (v && typeof v === 'object' ? v.level : v);
  for (const [coord, p] of state.planets) {
    if (!p.mine) continue;
    if (!p.buildOrder) noBuild.push(coord);
    // Nur sinnvoll, wenn dort überhaupt eine Schiffsfabrik steht.
    if (lvl(p.buildings?.shipFactory) >= 1 && p.shipyardFreeSec == null) idleYard.push(coord);
  }
  return { noBuild, idleYard, any: [...new Set([...noBuild, ...idleYard])] };
}

/**
 * Status-Indikatoren eines Planeten für die Zeitachse — bewusst grob:
 * „steht was rum?", „sind die Rohstoffe save?", „ist Bauplatz/Werft frei?".
 * Der Rohstoff-Teil rechnet auf den nächsten Einschlag hoch, denn genau dann
 * entscheidet sich, ob es etwas zu holen gibt.
 * Fremde Planeten liefern {mine:false} und bekommen keine Indikatoren.
 * @param at  Zeitpunkt für die Rohstoff-Prognose; default = nächster Einschlag
 * @returns {{mine:boolean, stationed?:object, loot?:object, build?:object, yard?:object}}
 */
export function planetStatus(coord, at = null) {
  const p = state.planets.get(coord);
  const mine = state.ownPlanets.has(coord);
  if (!mine || !p) return { mine: false };

  const lvl = (v) => (v && typeof v === 'object' ? v.level : v);
  const ref = state.refAt ?? serverNow();

  const order = state.buildOrders.find((o) => o.coord === coord) || null;
  const build = p.buildOrder || order
    ? {
        free: false,
        name: order?.name ?? p.buildOrder.name,
        level: order?.level ?? p.buildOrder.level,
        at: order?.at ?? (p.buildOrder.remainingSec != null ? ref + p.buildOrder.remainingSec * 1000 : null),
      }
    : { free: true };

  const yardLvl = lvl(p.buildings?.shipFactory) || 0;
  // Die Werft-Restzeit kommt ausschließlich aus der Gesamtübersicht und zählt
  // ab deren Einfügemoment — nicht ab dem Snapshot der Übersichtsseite.
  const gRef = state.gesamtRefAt ?? ref;
  const yard = yardLvl < 1
    ? { none: true }
    : p.shipyardFreeSec == null
      ? { free: true, level: yardLvl }
      : { free: false, level: yardLvl, at: gRef + p.shipyardFreeSec * 1000 };

  const imp = nextImpactOn(coord);
  const lootAt = at ?? imp?.at ?? serverNow();
  const loot = { ...plunderRisk(coord, lootAt), at: lootAt, forImpact: at == null && !!imp };

  return { mine: true, stationed: stationedSummary(p), loot, build, yard };
}

/* ---------- Urteil zu einem einzelnen Einschlag ---------- */

/**
 * Die eine Wahrheit hinter Marker-Farbe UND Bandfarbe: Ist bei diesem
 * Einschlag etwas zu verlieren? Beides zum Zeitpunkt des Einschlags, nicht
 * zum jetzigen Stand. Marker und Online-Fenster nutzen dieselbe Funktion,
 * damit die Bewertungen nicht auseinanderlaufen können.
 * @returns {{coord,at,st,risk,shipsSafe,lootSafe,safe}}
 *   shipsSafe = nichts stationiert und keine eigene Landung bis dahin
 *   lootSafe  = Rohstoffe bekannt UND unter dem Sockel (unbekannt = nicht save)
 */
export function impactVerdict(coord, at) {
  const p = state.planets.get(coord);
  const st = p ? stationedAt(p, coord, at) : null;
  const risk = plunderRisk(coord, at);
  const shipsSafe = !st?.hasAny;
  const lootSafe = risk.known && risk.safe;
  return { coord, at, st, risk, shipsSafe, lootSafe, safe: shipsSafe && lootSafe };
}

/* ---------- Online-/Save-Fenster ---------- */

// Vorlaufzeit: so lange vor einem Einschlag musst du online sein, um zu saven.
export const SAVE_LEAD_SEC = 600;
// Zwei Fenster, die enger als das beieinander liegen, werden zu einer Session.
const MERGE_GAP_SEC = 900;
// Eigene Landung so kurz vor einem Einschlag = die Flotte steht im Feuer.
const LANDING_RISK_SEC = 900;

/** Feindliche Einschläge auf eigenen Planeten, chronologisch, ab jetzt. */
function futureImpacts(now) {
  return state.fleets
    .filter((e) => e.hostile && e.at >= now - 1000 && state.ownPlanets.has(e.ziel))
    .sort((a, b) => a.at - b.at);
}

/**
 * Zusammenhängende Zeitbereiche, in denen du online sein musst, um zu saven.
 * Einschläge, die dicht beieinander liegen, werden zu einer Session gebündelt.
 * @returns {Array<{from,to,impacts,coords,level,durationSec,startsInSec,
 *   stationedCoords,landings,builds,gapBeforeSec}>}
 */
export function saveWindows({ leadSec = SAVE_LEAD_SEC } = {}) {
  const now = serverNow();
  const impacts = futureImpacts(now);
  if (!impacts.length) return [];

  const blocks = [];
  for (const imp of impacts) {
    const from = imp.at - leadSec * 1000;
    const last = blocks[blocks.length - 1];
    if (last && from <= last.to + MERGE_GAP_SEC * 1000) {
      last.to = Math.max(last.to, imp.at);
      last.impacts.push(imp);
    } else {
      blocks.push({ from, to: imp.at, impacts: [imp] });
    }
  }

  let prevEnd = null;
  return blocks.map((b) => {
    const coords = [...new Set(b.impacts.map((e) => e.ziel))];
    // Je Einschlag dasselbe Urteil wie am Marker auf der Zeitachse — so hat
    // das Band garantiert die Farbe des schlimmsten Markers darin.
    const verdicts = b.impacts.map((e) => impactVerdict(e.ziel, e.at));
    const stationedCoords = [...new Set(verdicts.filter((v) => !v.shipsSafe).map((v) => v.coord))];
    const lootCoords = [...new Set(verdicts.filter((v) => !v.lootSafe).map((v) => v.coord))];
    // Beute je Planet zum Zeitpunkt seines eigenen Einschlags — der erste
    // Einschlag zählt, danach ist ohnehin abgeräumt.
    let lootTotal = 0;
    for (const c of lootCoords) {
      const v = verdicts.find((x) => x.coord === c);
      if (v?.risk.known) lootTotal += v.risk.loot;
    }
    // Eigene Flotten, die mitten im Fenster landen — die stehen dann im Feuer.
    const landings = state.fleets.filter(
      (e) => e.own && e.at >= b.from && e.at <= b.to && coords.includes(e.ziel));
    // Bauaufträge, die im Fenster auf einem angegriffenen Planeten fertig werden.
    const builds = state.buildOrders.filter(
      (o) => o.at >= b.from && o.at <= b.to && coords.includes(o.coord));

    // Kritisch: Flotte steht im Feuer oder landet mitten im Fenster.
    // Warn: nichts stationiert, aber es gibt Beute zu holen (oder die
    //       Rohstofflage ist unbekannt — dann lieber hinschauen).
    // Safe: weder Flotte noch Rohstoffe in Gefahr — Online-Zeit ist optional.
    const level = stationedCoords.length || landings.length
      ? 'critical' : lootCoords.length ? 'warn' : 'safe';
    const gapBeforeSec = prevEnd != null ? (b.from - prevEnd) / 1000 : null;
    prevEnd = b.to;

    return {
      ...b, coords, stationedCoords, landings, builds, level, verdicts,
      lootTotal, lootCoords, optional: level === 'safe',
      durationSec: (b.to - b.from) / 1000,
      startsInSec: (b.from - now) / 1000,
      endsInSec: (b.to - now) / 1000,
      active: now >= b.from && now <= b.to,
      gapBeforeSec,
    };
  });
}

/**
 * Kritische Stellen als flache, priorisierte Liste — das, was schiefgehen kann.
 * @returns {Array<{kind,at,coord,text,level}>}
 */
export function criticalPoints() {
  const now = serverNow();
  const impacts = futureImpacts(now);
  const out = [];

  for (const imp of impacts) {
    const p = state.planets.get(imp.ziel);
    const st = p ? stationedAt(p, imp.ziel, imp.at) : null;
    if (st?.hasAny) {
      out.push({
        kind: 'loss', at: imp.at, coord: imp.ziel, level: 'critical',
        text: `${st.total ? `${st.total} Schiffe` : ''}${st.total && st.defTotal ? ' + ' : ''}${st.defTotal ? `${st.defTotal} Verteidigung` : ''} stehen beim Einschlag ungeschützt`,
      });
    }
    // Rohstoffe über dem nicht plünderbaren Sockel — hochgerechnet auf den Einschlag.
    const risk = plunderRisk(imp.ziel, imp.at);
    if (risk.known && risk.loot > 0) {
      const top = risk.byRes.filter((r) => r.loot > 0)
        .map((r) => `${Math.round(r.loot).toLocaleString('de-DE')} ${deLabel.resource(r.key)}`).join(', ');
      out.push({
        kind: 'loot', at: imp.at, coord: imp.ziel, level: 'critical',
        text: `${risk.loot.toLocaleString('de-DE')} Rohstoffe plünderbar beim Einschlag (${top})`,
      });
    }
    // Eigene Flotte landet kurz vor dem Einschlag auf demselben Planeten.
    for (const a of state.fleets) {
      if (!a.own || a.ziel !== imp.ziel) continue;
      const lead = (imp.at - a.at) / 1000;
      if (lead >= 0 && lead <= LANDING_RISK_SEC) {
        out.push({
          kind: 'landing', at: a.at, coord: a.ziel, level: 'critical',
          text: `Eigene Flotte (${a.mission}) landet nur ${Math.round(lead / 60)} min vor dem Einschlag`,
        });
      }
    }
  }

  // Rückflüge, die erst nach dem letzten Angriff ankommen.
  for (const t of threatAnalysis()) {
    if (!t.mine) continue;
    for (const w of t.windows) {
      if (w.tooLate && w.arrival.at >= now - 1000) {
        out.push({
          kind: 'late', at: w.arrival.at, coord: t.coord, level: 'warn',
          text: `Ankunft von ${w.arrival.start} erst nach dem letzten Angriff`,
        });
      }
    }
  }

  // Gleichzeitige Einschläge auf mehreren Planeten (< 2 min auseinander).
  for (let i = 0; i < impacts.length; i++) {
    const clash = impacts.filter(
      (x) => x !== impacts[i] && Math.abs(x.at - impacts[i].at) <= 120e3 && x.ziel !== impacts[i].ziel);
    if (clash.length && impacts[i].at <= (clash[0].at)) {
      out.push({
        kind: 'clash', at: impacts[i].at, coord: impacts[i].ziel, level: 'warn',
        text: `Zeitgleicher Einschlag auf ${clash.length + 1} Planeten — knappe Reihenfolge beim Saven`,
      });
    }
  }

  const seen = new Set();
  const rank = { critical: 0, warn: 1 };
  return out
    .filter((c) => { const k = `${c.kind}|${c.at}|${c.coord}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (rank[a.level] - rank[b.level]) || (a.at - b.at));
}

const TL_TYPES = {
  attack: { label: 'Angriff', icon: '⚔', color: 'threat' },
  spy: { label: 'Spionage', icon: '◎', color: 'own' },
  arrival: { label: 'Ankunft', icon: '▾', color: 'own' },
  rueck: { label: 'Rückflug', icon: '↩', color: 'dim' },
  trade: { label: 'Handel', icon: '⇄', color: 'safe' },
  build: { label: 'Bau fertig', icon: '⬢', color: 'soon' },
  research: { label: 'Forschung fertig', icon: '✷', color: 'brand' },
};
export const timelineTypes = TL_TYPES;

/**
 * Gemeinsame Zeitachse aus Flotten + Bauabschlüssen (+ Forschung, falls vorhanden).
 * Nur Ereignisse auf eigenen Planeten — Flüge auf fremde Koordinaten (eigene
 * Angriffe, Spionage nach außen) blähen die Achse auf, ohne dass dort etwas
 * zu entscheiden wäre.
 */
export function timelineEvents() {
  const out = [];
  const mine = (c) => state.ownPlanets.size === 0 || state.ownPlanets.has(c);
  for (const e of state.fleets) {
    if (!mine(e.ziel)) continue;
    let type = 'arrival';
    if (e.hostile) type = 'attack';
    else if (e.spy) type = 'spy';
    else if (e.mission === 'Handel') type = 'trade';
    else if (e.section === 'rueck') type = 'rueck';
    out.push({
      at: e.at, type, coord: e.ziel, from: e.start,
      label: e.mission, player: e.player, meta: e,
    });
  }
  for (const b of state.buildOrders) {
    if (!mine(b.coord)) continue;
    out.push({
      at: b.at, type: 'build', coord: b.coord, from: null,
      label: `${b.name} → Stufe ${b.level}`, meta: b,
    });
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

/** Nächster Feindeinschlag (für den Lage-Held). */
export function nextImpact() {
  const now = serverNow();
  return state.fleets
    .filter((e) => e.hostile && e.at >= now - 1000)
    .sort((a, b) => a.at - b.at)[0] || null;
}
