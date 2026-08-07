// Tab "Lage": Impact-Held, Signal-Kacheln, bedrohte Planeten (mit stationierten
// Flotten als Save-/Verteidigungs-Entscheidung) und freie Kapazität.
import { state, serverNow } from '../state.js';
import { threatAnalysis, freeCapacity, nextImpact, stationedSummary } from '../analysis.js';
import { coordChip, num, esc, durLong } from '../util/time.js';
import { deLabel } from '../domain.js';
import { emptyState } from './components.js';

const cd = (at, cls = '') => `<span class="cd ${cls}" data-at="${at}"></span>`;

function shipList(st, max = 3) {
  if (!st?.ships?.length) return '<span style="color:var(--faint)">keine Schiffe stationiert</span>';
  const top = st.ships.slice(0, max).map(([k, n]) => `${num(n)} ${esc(deLabel.ship(k))}`);
  const rest = st.ships.length - max;
  return top.join(' · ') + (rest > 0 ? ` +${rest} weitere` : '');
}

function hero() {
  const imp = nextImpact();
  if (!imp) {
    return `<div class="hero calm"><div class="ring"></div><div class="deco">
      <div class="lbl">✓ Keine Einschläge erfasst</div>
      <div class="count" style="font-size:34px">Alles ruhig</div>
      <div class="meta">Keine feindlichen Flotten in den ausgewerteten Daten.</div></div></div>`;
  }
  const p = state.planets.get(imp.ziel);
  const st = p ? stationedSummary(p) : null;
  const stationLine = st && st.hasAny
    ? `Stationiert auf ${coordChip(imp.ziel)}: <b>${shipList(st)}</b>${st.defTotal ? ` · ${num(st.defTotal)} Verteidigung` : ''} → saven oder zur Verteidigung halten?`
    : `Auf ${coordChip(imp.ziel)} sind aktuell keine eigenen Schiffe stationiert.`;
  const others = state.fleets.filter((e) => e.hostile).length - 1;
  return `<div class="hero"><div class="ring"></div>
    <div>
      <div class="lbl">▲ Nächster Einschlag</div>
      <div class="count" data-at="${imp.at}"></div>
      <div class="meta">Ziel ${coordChip(imp.ziel)} · <b>${esc(imp.mission)}</b> von ${coordChip(imp.start)}${imp.player ? ` · ${esc(imp.player)}` : ''}</div>
    </div>
    <div class="deco">
      <span class="badge">${state.fleets.filter((e) => e.hostile).length} feindliche Flotten</span>
      <div class="stationed">${stationLine}</div>
    </div></div>`;
}

function signals(threats) {
  const threatened = threats.filter((t) => t.mine && t.attacks.length).length;
  const inTransit = state.fleets.filter((e) => e.own && e.at >= serverNow() - 1000).length;
  const nextBuild = state.buildOrders.find((b) => b.at >= serverNow() - 1000);
  const fc = freeCapacity();
  return `<div class="signals">
    <div class="sig t"><div class="k">Bedrohte Planeten</div><div class="v">${threatened}</div><div class="sub">${state.fleets.filter((e) => e.hostile).length} Angriffe gesamt</div></div>
    <div class="sig o"><div class="k">Eigene Flotten unterwegs</div><div class="v">${inTransit}</div><div class="sub">Hin- &amp; Rückflüge</div></div>
    <div class="sig s"><div class="k">Nächster Bau fertig</div><div class="v cd" data-at="${nextBuild ? nextBuild.at : ''}">${nextBuild ? '' : '–'}</div><div class="sub">${nextBuild ? `${esc(nextBuild.name)} · ${coordChip(nextBuild.coord)}` : 'kein Auftrag'}</div></div>
    <div class="sig f"><div class="k">Freie Kapazität</div><div class="v">${fc.noBuild.length}</div><div class="sub">${fc.idleYard.length} Schiffsfabrik(en) idle</div></div>
  </div>`;
}

function threatCard(t) {
  const a = t.firstAttack;
  const st = t.stationed;
  const saves = t.windows.filter((w) => w.nextAttack || w.tooLate);
  const saveHtml = saves.length ? `<div class="sub" style="margin-top:6px">${saves.map((w) => {
    const gap = w.gapSec != null ? durLong(w.gapSec) : null;
    return w.tooLate
      ? `<span class="chip" style="color:var(--threat)">Rückflug ${coordChip(w.arrival.start)} landet nach letztem Angriff</span>`
      : `<span class="chip free">Save-Fenster ${gap} ab Ankunft ${coordChip(w.arrival.start)}</span>`;
  }).join(' ')}</div>` : '';
  return `<div class="item threat">
    <div class="cd" data-at="${a.at}"></div>
    <div class="grow">
      <div class="ttl">${coordChip(t.coord, t.mine ? 'mine' : '')} · ${t.attacks.length} Angriff${t.attacks.length > 1 ? 'e' : ''}${t.spies.length ? ` · ${t.spies.length} Spionage` : ''}</div>
      <div class="sub">${st && st.hasAny ? `Stationiert: <b style="color:var(--safe)">${shipList(st, 4)}</b>${st.defTotal ? ` · ${num(st.defTotal)} Vert.` : ''}` : '<span style="color:var(--faint)">keine Schiffe stationiert</span>'}</div>
      ${saveHtml}
    </div></div>`;
}

export function renderLage() {
  if (!state.planets.size && !state.fleets.length) {
    return emptyState('Noch keine Daten. Füge oben deine Übersichtsseite oder Gesamtübersicht ein.');
  }
  const threats = threatAnalysis();
  const threatened = threats.filter((t) => t.mine && t.attacks.length);
  const fc = freeCapacity();

  const threatSection = threatened.length
    ? `<div class="list">${threatened.map(threatCard).join('')}</div>`
    : emptyState('Keine bedrohten eigenen Planeten.');

  const capSection = fc.noBuild.length
    ? `<div class="cap-grid">${fc.noBuild.map((c) => {
        const idle = fc.idleYard.includes(c);
        return `<div class="cap"><div class="t">frei</div>${coordChip(c, 'mine')}<div class="sub" style="font-size:11.5px;color:var(--dim);margin-top:4px">kein Bauauftrag${idle ? ' · Schiffsfabrik idle' : ''}</div></div>`;
      }).join('')}</div>`
    : emptyState('Alle Planeten bauen gerade.');

  return `${hero()}${signals(threats)}
    <div class="section">
      <h2>⚠ Bedrohte Planeten</h2>
      <div class="desc">Nächster Einschlag je Planet, stationierte Flotten als Entscheidungshilfe (saven vs. verteidigen) und Save-Fenster eigener Landungen.</div>
      ${threatSection}
    </div>
    <div class="section">
      <h2>◇ Freie Kapazität</h2>
      <div class="desc">Planeten ohne laufenden Bauauftrag — hier kannst du etwas starten.</div>
      ${capSection}
    </div>`;
}
