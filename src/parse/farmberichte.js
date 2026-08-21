// Parser fuer kopierte GigraWars-Angriffsberichte. Ein Bericht besteht aus
// Start/Ziel, Spielername, Rohstoffen und einem relativen oder absoluten Datum.
import { coordOf, parseGwInt } from '../util/format.js';

const RESOURCES = [
  ['iron', 'Eisen'],
  ['lutinum', 'Lutinum'],
  ['water', 'Wasser'],
  ['hydrogen', 'Wasserstoff'],
];

const timeAt = (raw, now) => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let m = /^(heute|gestern)\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/i.exec(raw);
  if (m) {
    const day = m[1].toLowerCase() === 'gestern' ? -1 : 0;
    return new Date(today.getFullYear(), today.getMonth(), today.getDate() + day,
      +m[2], +m[3], +(m[4] || 0)).getTime();
  }
  m = /^(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (!m) return null;
  let year = today.getFullYear();
  let at = new Date(year, +m[2] - 1, +m[1], +m[3], +m[4], +(m[5] || 0));
  if (at.getTime() > now.getTime() + 24 * 3600e3) {
    at = new Date(--year, +m[2] - 1, +m[1], +m[3], +m[4], +(m[5] || 0));
  }
  return at.getTime();
};

const resourceLine = (line) => {
  if (!/\b(Eisen|Lutinum|Wasser|Wasserstoff)\b/i.test(line)) return null;
  const resources = {};
  for (const [key, label] of RESOURCES) {
    const m = new RegExp(`([\\d.]+)\\s+${label}\\b`, 'i').exec(line);
    resources[key] = m ? parseGwInt(m[1]) : 0;
  }
  return resources;
};

const coordPair = (line) => {
  const coords = [...line.matchAll(/\d{1,3}:\d{1,3}:\d{1,3}/g)].map((m) => coordOf(m[0]));
  return coords.length >= 2 ? coords : null;
};

export function parseFarmReports(text, reference = new Date()) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map((line) => line.trim());
  const reports = [];
  for (let i = 0; i < lines.length; i++) {
    const pair = coordPair(lines[i]);
    if (!pair) continue;
    const end = lines.findIndex((line, index) => index > i && coordPair(line));
    const block = lines.slice(i + 1, end < 0 ? lines.length : end);
    if (!block.some((line) => /^Bericht$/i.test(line))) continue;
    const resourceIndex = block.findIndex(resourceLine);
    if (resourceIndex < 0) continue;
    const resources = resourceLine(block[resourceIndex]);
    const dateLine = block.slice(resourceIndex + 1).find((line) => timeAt(line, reference) != null);
    const at = dateLine ? timeAt(dateLine, reference) : null;
    const playerLine = block.slice(0, resourceIndex).find((line) =>
      line && !/^Bericht$/i.test(line) && !/spegioloni/i.test(line) && !/^\d+\s+\d+$/.test(line));
    reports.push({
      start: pair[0],
      target: pair[1],
      player: playerLine ? playerLine.replace(/\s+\d+\s+\d+\s*$/, '').trim() : 'Unbekannt',
      resources,
      total: Object.values(resources).reduce((sum, amount) => sum + amount, 0),
      at,
    });
    i += block.length;
  }
  return reports;
}

/**
 * Berichte in die Form der Archiv-View `farm_loot_targets` bringen — damit
 * Funktionen, die eigentlich fürs Beute-Archiv gebaut sind (etwa
 * `npcCandidates`), auch mit frisch eingefügten, noch nicht archivierten
 * Berichten arbeiten können.
 */
export function reportsAsLootTargets(reports) {
  const byTarget = new Map();
  for (const r of reports || []) {
    const list = byTarget.get(r.target) || [];
    list.push(r);
    byTarget.set(r.target, list);
  }
  return [...byTarget.entries()].map(([target, list]) => {
    const sorted = [...list].sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity));
    const latest = sorted[0];
    const total = list.reduce((sum, r) => sum + r.total, 0);
    const best = Math.max(...list.map((r) => r.total));
    return {
      target,
      target_player: latest.player,
      reports: list.length,
      total,
      avg_total: Math.round(total / list.length),
      best_total: best,
      last_total: latest.total,
      last_at: latest.at ? new Date(latest.at).toISOString() : null,
    };
  });
}

export function farmSummary(reports, reference = new Date()) {
  const todayStart = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate()).getTime();
  const farms = new Map();
  for (const report of reports) {
    const previous = farms.get(report.target);
    if (!previous || (report.at ?? -Infinity) > (previous.at ?? -Infinity)) farms.set(report.target, report);
  }
  const ranked = [...farms.values()].sort((a, b) => b.total - a.total);
  return {
    reports: reports.length,
    farms: ranked,
    attackedToday: ranked.filter((farm) => farm.at != null && farm.at >= todayStart),
    notAttackedToday: ranked.filter((farm) => farm.at == null || farm.at < todayStart),
  };
}
