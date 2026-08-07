// Tab "Lage": Impact-Held, Signal-Kacheln, bedrohte Planeten (mit stationierten
// Flotten als Save-/Verteidigungs-Entscheidung) und freie Kapazität.
import { state, serverNow } from '../state.js';
import { threatAnalysis, freeCapacity, nextImpact, stationedSummary,
  saveWindows, criticalPoints, timelineEvents, SAVE_LEAD_SEC } from '../analysis.js';
import { coordChip, num, esc, durLong, hhmm } from '../util/time.js';
import { deLabel } from '../domain.js';
import { emptyState } from './components.js';
import { gantt, bandLegend, windowSummary } from './timeline.js';

const cd = (at, cls = '') => `<span class="cd ${cls}" data-at="${at}"></span>`;
const SAVE_LEAD_MIN = Math.round(SAVE_LEAD_SEC / 60);
const plural = (n) => (n > 1 ? 'Einschläge' : 'Einschlag');

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
    <div class="sig f"><div class="k">Freie Kapazität</div><div class="v">${fc.any.length}</div><div class="sub">${fc.noBuild.length}× Bauplatz · ${fc.idleYard.length}× Schiffsfabrik</div></div>
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

/* ---------- Online-/Save-Fenster ---------- */

function windowCard(w, i) {
  const label = w.active ? 'läuft jetzt' : `beginnt in`;
  const chips = [];
  if (w.stationedCoords.length) {
    chips.push(`<span class="chip crit">Flotte im Feuer auf ${w.stationedCoords.map((c) => coordChip(c, 'mine')).join(' ')}</span>`);
  }
  if (w.landings.length) {
    chips.push(`<span class="chip crit">${w.landings.length} eigene Landung${w.landings.length > 1 ? 'en' : ''} im Fenster</span>`);
  }
  if (w.builds.length) {
    chips.push(`<span class="chip warn">${w.builds.length} Bau wird fertig</span>`);
  }
  if (w.gapBeforeSec != null && w.gapBeforeSec > 0) {
    chips.push(`<span class="chip free">${durLong(w.gapBeforeSec)} Pause davor</span>`);
  }
  const targets = w.coords.map((c) => coordChip(c, 'mine')).join(' ');
  return `<div class="win ${w.level}${w.active ? ' live' : ''}">
    <div class="rng"><b>${hhmm(w.from)}</b><span>bis</span><b>${hhmm(w.to)}</b>
      <em>${durLong(w.durationSec)}</em></div>
    <div class="grow">
      <div class="ttl">${w.active ? '● ' : ''}Fenster ${i + 1} · ${w.impacts.length} ${plural(w.impacts.length)} auf ${targets}</div>
      <div class="sub">${label} ${w.active ? '' : `<span class="cd inline" data-at="${w.from}"></span>`}
        · Einschläge: ${w.impacts.map((e) => `<span class="mono">${hhmm(e.at)}</span>`).join(', ')}</div>
      ${chips.length ? `<div class="sub">${chips.join(' ')}</div>` : ''}
    </div></div>`;
}

function windowSection(wins) {
  if (!wins.length) {
    return emptyState('Keine feindlichen Einschläge — du musst für nichts online sein.');
  }
  const total = wins.reduce((s, w) => s + w.durationSec, 0);
  return `<div class="win-head">${esc(windowSummary(wins))}
    <span class="chip">${wins.length} Fenster · ${durLong(total)} gesamt online</span></div>
    <div class="list win-list">${wins.map(windowCard).join('')}</div>`;
}

/* ---------- Kritische Stellen ---------- */

const CRIT_ICON = { loss: '☠', landing: '↯', late: '⏱', clash: '⚡' };const CRIT_KIND = { loss: 'Verlustrisiko', landing: 'Landung im Feuer', late: 'Zu spät', clash: 'Kollision' };

function criticalSection(points) {
  if (!points.length) return emptyState('Keine kritischen Stellen erkannt.');
  return `<div class="list">${points.map((c) => `
    <div class="item crit-${c.level}">
      <div class="cd" data-at="${c.at}"></div>
      <div class="grow">
        <div class="ttl">${CRIT_ICON[c.kind] || '!'} ${esc(CRIT_KIND[c.kind] || c.kind)} ${coordChip(c.coord, 'mine')}
          <span class="mono at">${hhmm(c.at)}</span></div>
        <div class="sub">${esc(c.text)}</div>
      </div></div>`).join('')}</div>`;
}

export function renderLage() {
  if (!state.planets.size && !state.fleets.length) {
    return emptyState('Noch keine Daten. Füge oben deine Übersichtsseite oder Gesamtübersicht ein.');
  }
  const threats = threatAnalysis();
  const threatened = threats.filter((t) => t.mine && t.attacks.length);
  const fc = freeCapacity();
  const wins = saveWindows();
  const crits = criticalPoints();
  const events = timelineEvents();

  const threatSection = threatened.length
    ? `<div class="list">${threatened.map(threatCard).join('')}</div>`
    : emptyState('Keine bedrohten eigenen Planeten.');

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
      <h2>🕒 Wann du online sein musst</h2>
      <div class="desc">Zusammenhängende Zeitbereiche, in denen du zum Saven am Rechner sein musst — inklusive ${SAVE_LEAD_MIN} min Vorlauf vor jedem Einschlag. Dicht aufeinanderfolgende Einschläge sind zu einer Session gebündelt.</div>
      ${windowSection(wins)}
    </div>
    <div class="section">
      <h2>▤ Zeitachse</h2>
      <div class="desc">Alle Ereignisse auf einer Achse. Die farbigen Bänder sind die Online-Fenster von oben. Links je Planet drei Ampeln: <b>⬟ Flotte</b> stationiert (rot = steht im Einschlag), <b>⌂ Bauplatz</b> und <b>⚒ Werft</b> — grün heißt frei. Eigene Planeten ohne Ereignisse stehen unten, damit du freie Kapazität auf einen Blick siehst.</div>
      ${bandLegend(wins)}
      ${events.length ? gantt(events, { windows: wins }) : emptyState('Noch keine Ereignisse. Füge deine Übersichtsseite ein.')}
    </div>
    <div class="section">
      <h2>☠ Kritische Stellen</h2>
      <div class="desc">Konkrete Risiken in den kommenden Stunden — was passiert, wenn du nichts tust.</div>
      ${criticalSection(crits)}
    </div>
    <div class="section">
      <h2>⚠ Bedrohte Planeten</h2>
      <div class="desc">Nächster Einschlag je Planet, stationierte Flotten als Entscheidungshilfe (saven vs. verteidigen) und Save-Fenster eigener Landungen.</div>
      ${threatSection}
    </div>
    <div class="section">
      <h2>◇ Freie Kapazität</h2>
      <div class="desc">Zwei unabhängige Dinge: der <b>Bauplatz</b> (Gebäude-Warteschlange) und die <b>Schiffsfabrik</b>. Ein Planet kann ein Gebäude bauen und trotzdem eine leere Werft haben.</div>
      ${capSection}
    </div>`;
}
