// Tab "Lage": Impact-Held, Signal-Kacheln und freie Kapazität.
import { state, serverNow } from '../state.js';
import { threatAnalysis, freeCapacity, nextImpact, stationedSummary,
  saveWindows, timelineEvents } from '../analysis.js';
import { coordChip, num, esc } from '../util/time.js';
import { deLabel } from '../domain.js';
import { emptyState } from './components.js';
import { gantt, bandLegend } from './timeline.js';

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
  const stationLine = st && st.hasShips
    ? `Stationiert auf ${coordChip(imp.ziel)}: <b>${shipList(st)}</b>${st.defTotal ? ` · ${num(st.defTotal)} Verteidigung` : ''} → saven oder zur Verteidigung halten?`
    : `Auf ${coordChip(imp.ziel)} sind aktuell keine eigenen Schiffe stationiert${st?.defTotal ? ` (nur ${num(st.defTotal)} Verteidigung — die bleibt ohnehin stehen)` : ''}.`;
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
  const now = serverNow() - 1000;
  const inTransit = state.fleets.filter((e) => e.own && (e.returnAt ?? e.at) >= now).length;
  const ownAttacks = state.fleets.filter((e) =>
    e.own && e.mission === 'Angriff' && (e.returnAt ?? e.at) >= now,
  ).length;
  const nextBuild = state.buildOrders.find((b) => b.at >= serverNow() - 1000);
  const fc = freeCapacity();
  return `<div class="signals">
    <div class="sig t"><div class="k">Bedrohte Planeten</div><div class="v">${threatened}</div><div class="sub">${state.fleets.filter((e) => e.hostile).length} Angriffe gesamt</div></div>
    <div class="sig o"><div class="k">Eigene Angriffe unterwegs</div><div class="v">${ownAttacks}</div><div class="sub">${inTransit} Flotten unterwegs</div></div>
    <div class="sig s"><div class="k">Nächster Bau fertig</div><div class="v cd" data-at="${nextBuild ? nextBuild.at : ''}">${nextBuild ? '' : '–'}</div><div class="sub">${nextBuild ? `${esc(nextBuild.name)} · ${coordChip(nextBuild.coord)}` : 'kein Auftrag'}</div></div>
    <div class="sig f"><div class="k">Freie Kapazität</div><div class="v">${fc.any.length}</div><div class="sub">${fc.noBuild.length}× Bauplatz · ${fc.idleYard.length}× Schiffsfabrik</div></div>
  </div>`;
}

export function renderLage() {
  if (!state.planets.size && !state.fleets.length) {
    return emptyState('Noch keine Daten. Füge oben deine Übersichtsseite oder Gesamtübersicht ein.');
  }
  const threats = threatAnalysis();
  const fc = freeCapacity();
  const wins = saveWindows();
  const events = timelineEvents();

  const capSection = fc.any.length
    ? `<div class="cap-grid">${fc.any.map((c) => {
        const noBuild = fc.noBuild.includes(c);
        const idle = fc.idleYard.includes(c);
        const order = state.planets.get(c)?.buildOrder;
        return `<div class="cap"><div class="t">${noBuild && idle ? 'Bau + Werft' : noBuild ? 'Bauplatz' : 'Werft'} frei</div>${coordChip(c, 'mine')}
          <div class="cap-tags">
            ${noBuild
              ? '<span class="chip free">kein Bauauftrag</span>'
              : `<span class="chip">baut ${esc(order?.name ?? '…')}</span>`}
            ${idle ? '<span class="chip free">Schiffsfabrik idle</span>' : ''}
          </div></div>`;
      }).join('')}</div>`
    : emptyState('Alle Planeten bauen gerade.');

  return `${hero()}${signals(threats)}
    <div class="section">
      <h2>▤ Zeitachse</h2>
      <div class="desc">Beantwortet je Einschlag die zwei Fragen, die zählen: <b>sind die Schiffe save</b> und <b>sind die Rohstoffe save</b>. Am Angriffsmarker steht beides als <b>⬟◈</b> — grün heißt, dort ist nichts zu holen. Die Rohstoffe sind auf den Einschlagszeitpunkt hochgerechnet (Förderung, Speicherdeckel und laufende Minenausbauten); nicht plünderbar sind 2 % der Speicherkapazität, Wasser zählt nicht mit. Die Leiste unter der Achse zeigt die Online-Fenster von oben — getönt ist nur das laufende bzw. nächste. Links je Planet <b>⬟ Flotte</b>, <b>◈ Ressourcen</b>, <b>⌂ Bauplatz</b>, <b>⚒ Werft</b>. Planeten ohne Ereignisse stehen gesammelt unter dem Chart.</div>
      ${bandLegend(wins)}
      ${events.length ? gantt(events, { windows: wins }) : emptyState('Noch keine Ereignisse. Füge deine Übersichtsseite ein.')}
    </div>
    <div class="section">
      <h2>◇ Freie Kapazität</h2>
      <div class="desc">Zwei unabhängige Dinge: der <b>Bauplatz</b> (Gebäude-Warteschlange) und die <b>Schiffsfabrik</b>. Ein Planet kann ein Gebäude bauen und trotzdem eine leere Werft haben.</div>
      ${capSection}
    </div>`;
}
