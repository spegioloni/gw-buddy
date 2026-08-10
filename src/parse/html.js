// Parser für den vollständigen HTML-Quelltext der GigraWars-Übersicht.
// Die Spielseite liefert darin für eigene Flotten die Tooltip-Daten, die beim
// normalen Text-Paste verloren gehen: Schiffe, Fracht und Unix-Ankunftszeit.
import { parseGwInt } from '../util/format.js';
import { shipKey, resourceKey } from '../domain.js';

const strip = (s) => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
const attr = (s, name) => {
  const m = new RegExp(`${name}="([^"]*)"`).exec(s);
  return m ? m[1] : '';
};

const fleetKey = (from, to, ships) => [
  `${from}>${to}`,
  Object.entries(ships).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}:${value}`).join('|'),
].join(';');

function manifest(title, heading) {
  const block = new RegExp(`<b>${heading}</b><br\\s*/?>([\\s\\S]*?)(?=<br\\s*/?><br\\s*/?><b>|$)`, 'i').exec(title)?.[1] || '';
  const out = {};
  for (const line of block.split(/<br\s*\/?>/i)) {
    const m = /^\s*([^:]+):\s*([\d.,]+)\s*$/.exec(strip(line));
    if (!m) continue;
    const key = heading === 'Schiffe' ? shipKey(m[1]) : resourceKey(m[1]);
    const value = parseGwInt(m[2]);
    if (key && value != null) out[key] = value;
  }
  return out;
}

export function parseHtmlOverview(html) {
  const now = +( /var\s+globalServerTime\s*=\s*(\d+)/.exec(html)?.[1] || 0) * 1000;
  const fleets = [];
  const sectionRe = /Eigene Flotten (Hinflug|Rückflug)[\s\S]*?(?=Eigene Flotten (?:Hinflug|Rückflug)|Fremde(?:\s+\w+)*\s+Flotten|Gebäudeaufträge|$)/gi;
  for (const section of html.matchAll(sectionRe)) {
    const returning = /Rückflug/i.test(section[1]);
    for (const row of section[0].matchAll(/<div class="grid gap-1 fleet-table-tr[^>]*">([\s\S]*?)(?=<div class="grid gap-1 fleet-table-tr|$)/gi)) {
      const raw = row[1];
      const at = +attr(raw, 'data-time') * 1000;
      const missionMatch = /fleet-mission[\s\S]*?<span[^>]*title="([^"]*)"[^>]*>([^<]+)<\/span>/i.exec(raw);
      const coords = [...raw.matchAll(/<a\b[^>]*>\s*(\d{1,3}:\d{1,3}:\d{1,3})\s*<\/a>/gi)].map((m) => m[1]);
      if (!at || !missionMatch || coords.length < 2) continue;
      const title = missionMatch[1];
      const mission = strip(missionMatch[2]);
      const from = coords[0], to = coords[1];
      const ships = manifest(title, 'Schiffe');
      const expectedReturn = /class="[^"]*\bopacity-75\b[^"]*"/i.test(row[0]);
      if (expectedReturn) {
        // Das Spiel listet zum Hinflug eine ausgegraute, vorausberechnete
        // Rückkehr. Sie ist keine zweite Flotte, markiert aber das Ende des
        // zusammenhängenden Flugs.
        const key = fleetKey(from, to, ships);
        const outbound = fleets.find((fleet) =>
          fleet._key === key && fleet.returnAt == null && fleet.at < at,
        );
        if (outbound) outbound.returnAt = at;
        continue;
      }
      fleets.push({
        section: returning ? 'rueck' : 'hin', own: true, hostile: false, spy: false,
        mission, icon: returning ? '↩️' : '🚀', owner: returning ? 'Eigene · Rückflug' : 'Eigene · Hinflug',
        start: returning ? to : from, ziel: returning ? from : to, at,
        ships, cargo: manifest(title, 'Rohstoffe'),
        _key: fleetKey(from, to, ships),
      });
    }
  }
  for (const fleet of fleets) delete fleet._key;
  // Feindliche Flotten verwenden kein Tooltip-<span>, sondern eine einfache
  // Missionszelle. Ihre Richtung ist im HTML trotzdem eindeutig: links
  // startet der Gegner, rechts liegt der eigene Zielplanet.
  const hostileSection = /Fremde feindliche Flotten[\s\S]*?(?=<div data-controller="fleet-listing"|$)/i.exec(html)?.[0] || '';
  for (const row of hostileSection.matchAll(/<div class="grid gap-1 fleet-table-tr[^>]*">([\s\S]*?)(?=<div class="grid gap-1 fleet-table-tr|$)/gi)) {
    const raw = row[1];
    const at = +attr(raw, 'data-time') * 1000;
    const mission = /fleet-mission[^>]*>\s*([^<]+?)\s*<\/div>/i.exec(raw)?.[1]?.trim();
    const coordLinks = [...raw.matchAll(/<a\b[^>]*title="([^"]*)"[^>]*>\s*(\d{1,3}:\d{1,3}:\d{1,3})\s*<\/a>/gi)];
    if (!at || !mission || coordLinks.length < 2) continue;
    fleets.push({
      section: 'hostile', own: false, hostile: true, spy: /erkundung|spion/i.test(mission),
      mission, icon: '⚠', owner: 'Feindlich', player: coordLinks[0][1],
      start: coordLinks[0][2], ziel: coordLinks[1][2], at, ships: {}, cargo: {},
    });
  }
  // Handelsflotten stehen nicht bei den eigenen Hin-/Rückflügen, enthalten
  // aber dieselbe relevante Information: Richtung, Ankunft und Rohstoffe.
  for (const row of html.matchAll(/<div class="grid gap-1 fleet-table-tr[^>]*">([\s\S]*?)(?=<div class="grid gap-1 fleet-table-tr|$)/gi)) {
    const raw = row[1];
    if (!/other-fleet\s+trade/i.test(raw)) continue;
    const at = +attr(raw, 'data-time') * 1000;
    const missionMatch = /fleet-mission[\s\S]*?<span[^>]*title="([^"]*)"[^>]*>([^<]+)<\/span>/i.exec(raw);
    const coords = [...raw.matchAll(/<a\b[^>]*>\s*(\d{1,3}:\d{1,3}:\d{1,3})\s*<\/a>/gi)].map((m) => m[1]);
    if (!at || !missionMatch || coords.length < 2) continue;
    const cargo = manifest(missionMatch[1], 'Rohstoffe');
    if (!Object.keys(cargo).length) continue;
    const left = coords[0], right = coords[1];
    const pointsRight = /fa-angles-right/.test(raw);
    fleets.push({
      section: 'trade', own: true, trade: true, hostile: false, spy: false,
      mission: 'Handel', icon: '🤝', owner: 'Handel',
      start: pointsRight ? left : right, ziel: pointsRight ? right : left,
      at, ships: {}, cargo,
    });
  }
  return {
    type: 'html', snapshot: now ? { abs: now } : { sec: null, date: null },
    activePlanet: null, activeResources: {}, tradePost: {}, ships: {},
    buildOrders: [], buildSection: false, counts: {}, fleets,
  };
}
