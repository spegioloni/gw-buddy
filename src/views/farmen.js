import { state, serverNow } from '../state.js';
import { farmSummary } from '../parse/farmberichte.js';
import { stackByResource, stackByOrigin, lootStats, archiveFarms, farmFlights, rankFarms, RESOURCES } from '../farmstats.js';
import { stackedBars, barList } from './charts.js';
import { coordChip, esc, num, short, clock } from '../util/time.js';
import { emptyState } from './components.js';

const dateLabel = (at) => at == null ? 'Zeitpunkt nicht erkannt' : new Date(at).toLocaleString('de-DE', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

const dayOnly = (at) => at == null ? '—' : new Date(at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

const idleLabel = (days) => days == null ? 'nie angeflogen'
  : days <= 0 ? 'heute angeflogen'
  : days === 1 ? 'seit gestern offen'
  : `seit ${days} Tagen offen`;

/** „⚔ Einschlag in 12:31" bzw. „↩ Rückflug, Ankunft in 4:02" mit lebendem Countdown. */
function flightLabel(flight) {
  if (!flight) return '';
  // class="cd" wird vom Tick-Loop in app.js jede Viertelsekunde nachgezogen.
  const when = flight.at == null ? '' : ` <span class="cd mono" data-at="${flight.at}">${clock((flight.at - serverNow()) / 1000)}</span>`;
  return flight.kind === 'hin'
    ? `⚔️ ${esc(flight.mission)} unterwegs · Einschlag in${when}`
    : `↩️ Rückflug läuft · Ankunft in${when}`;
}

/**
 * Solange das Archiv nicht geladen ist, bleibt der eingefügte Bericht die
 * Quelle. Sobald Archivdaten da sind, gewinnen die — sie kennen auch Ziele,
 * die im aktuellen Berichtsblatt nicht mehr auftauchen.
 */
function atlas() {
  if (state.loot.targets.length) return archiveFarms(state.loot.targets);
  return { ...farmSummary(state.farmReports), source: 'paste' };
}

function farmRows(farms, list, muted = false, source = 'paste', flights = null, legacy = false) {
  if (!farms.length) {
    return emptyState(muted
      ? 'Jede bekannte Farm ist heute schon angeflogen oder unterwegs.'
      : source === 'archiv' ? 'Im Archiv liegt noch kein Angriff.' : 'Noch keine Farmberichte erkannt.');
  }
  const showAll = state.farmShowAll[list];
  const visible = showAll ? farms : farms.slice(0, 10);
  return `<div class="farm-list">${visible.map((farm, index) => {
    const flight = flights?.get(farm.target) || null;
    const sub = flight ? `<small class="farm-flight">${flightLabel(flight)}</small>`
      : `<small>${muted && source === 'archiv' ? `${idleLabel(farm.idleDays)} · zuletzt ${dayOnly(farm.at)}` : dateLabel(farm.at)}</small>`;
    return `<article class="farm-row${muted ? ' stale' : ''}${flight ? ' enroute' : ''}">
    <div class="farm-rank mono">${flight ? (flight.kind === 'hin' ? '⚔️' : '↩️') : muted ? '○' : `#${index + 1}`}</div>
    <div class="farm-target">${coordChip(farm.target)}<b>${esc(farm.player)}</b>${sub}</div>
    <div class="farm-loot mono"><b>${num(source === 'archiv' ? farm.avg : farm.total)}</b><small>${source === 'archiv' ? `Ø je Angriff · ${farm.reports}×` : 'Rohstoffe gesamt'}</small></div>
    ${legacy ? `<div class="farm-res mono"><span>Gesamt ${num(farm.sum)}</span></div>` : `<div class="farm-res mono">
      <span>E ${num(farm.resources.iron)}</span><span>L ${num(farm.resources.lutinum)}</span>
      <span>W ${num(farm.resources.water)}</span><span>H ${num(farm.resources.hydrogen)}</span>
    </div>`}
  </article>`;
  }).join('')}</div>${farms.length > 10 ? `<button class="btn sm ghost farm-more" data-farm-list="${list}">${showAll ? 'Weniger anzeigen' : `Zeige mehr (${farms.length - 10})`}</button>` : ''}`;
}

/* ---------- Archiv & Diagramme (Supabase) ---------- */

const localDay = (d = new Date()) => d.toLocaleDateString('sv-SE');

const DAY_WINDOWS = [7, 14, 30, 90, 365];

function archiveHead() {
  const { loot } = state;
  const undated = state.farmReports.filter((r) => r.at == null).length;
  const pushLabel = loot.busy === 'push' ? 'Archiviere …' : `${state.farmReports.length} Berichte archivieren`;
  return `<div class="row loot-actions">
      <button class="btn primary" id="btnLootPush" ${!state.farmReports.length || loot.busy ? 'disabled' : ''}>${pushLabel}</button>
      <button class="btn sm ghost" id="btnLootLoad" ${loot.busy ? 'disabled' : ''}>${loot.busy === 'load' ? 'Lade …' : 'Archiv neu laden'}</button>
      <label class="inp sm">Zeitraum
        <select data-loot="days">${DAY_WINDOWS.map((d) =>
          `<option value="${d}"${d === loot.days ? ' selected' : ''}>${d} Tage</option>`).join('')}</select>
      </label>
      <label class="inp sm">Aufteilung
        <select data-loot="split">
          <option value="resource"${loot.split === 'resource' ? ' selected' : ''}>nach Rohstoff</option>
          <option value="origin"${loot.split === 'origin' ? ' selected' : ''}>nach eigenem Planeten</option>
        </select>
      </label>
    </div>
    ${undated ? `<div class="hint">${undated} Bericht${undated === 1 ? '' : 'e'} ohne erkannten Zeitpunkt werden nicht archiviert.</div>` : ''}
    ${loot.error ? `<div class="empty bad">${esc(loot.error)}</div>` : ''}
    ${loot.notice ? `<div class="hint ok">${esc(loot.notice)}</div>` : ''}`;
}

function lootCharts() {
  const { loot } = state;
  const today = localDay();
  const stats = lootStats(loot.rows, today);
  if (!loot.rows.length) {
    return emptyState(loot.loadedAt
      ? 'Im Archiv liegt noch nichts. Berichte einfügen und archivieren.'
      : 'Archiv noch nicht geladen.');
  }
  const series = loot.split === 'origin'
    ? stackByOrigin(loot.rows, today)
    : stackByResource(loot.rows, today);
  const ranked = rankFarms(loot.targets, loot.rank);
  const byAvg = loot.rank === 'avg';
  const targets = ranked.map((t) => ({
    label: t.target,
    html: `${coordChip(t.target)}<b>${esc(t.target_player || 'Unbekannt')}</b>`,
    value: byAvg ? t.avg : t.total,
    sub: `${t.reports} Angriff${t.reports === 1 ? '' : 'e'}${byAvg ? ` · ${short(t.total)} gesamt` : ''}`,
  }));
  return `<div class="signals loot-signals">
      <div class="sig f"><div class="k">Gesamt gefarmt</div><div class="v">${short(stats.total)}</div><div class="sub">${stats.reports} Berichte im Archiv</div></div>
      <div class="sig o"><div class="k">Letzte 7 Tage</div><div class="v">${short(stats.last7)}</div><div class="sub">heute ${short(stats.todayLoot)}</div></div>
      <div class="sig s"><div class="k">Schnitt je Farmtag</div><div class="v">${short(stats.perDayAvg)}</div><div class="sub">${stats.activeDays} Tage mit Beute</div></div>
      <div class="sig t"><div class="k">Bester Tag</div><div class="v">${stats.bestDay ? short(stats.bestDay.total) : '—'}</div><div class="sub">${stats.bestDay ? stats.bestDay.day.split('-').reverse().join('.') : 'noch keiner'}</div></div>
    </div>
    <section class="section"><h2>◆ Beute je Tag</h2>
      <div class="desc">${loot.split === 'origin'
        ? `Gestapelt nach dem eigenen Planeten, von dem der Angriff startete (${stats.origins} Planeten aktiv).`
        : 'Gestapelt nach Rohstoff. Tage ohne Beute bleiben als Lücke sichtbar.'}</div>
      ${stackedBars(series, { title: 'Beute je Tag' })}
    </section>
    <section class="section"><h2>◆ Ertrag je Rohstoff</h2>
      ${barList(RESOURCES.map(([key, label, color]) => ({ label, value: stats.byResource[key], color })))}
    </section>
    <section class="section"><h2>◆ ${byAvg ? 'Beste Farmen je Flug' : 'Ergiebigste Farmen'}
        <select class="chart-toggle" data-loot="rank" aria-label="Rangliste sortieren nach">
          <option value="total"${byAvg ? '' : ' selected'}>Gesamtertrag</option>
          <option value="avg"${byAvg ? ' selected' : ''}>Ertrag je Flug</option>
        </select></h2>
      <div class="desc">${byAvg
        ? 'Durchschnittliche Beute je archiviertem Angriff — zeigt auch selten besuchte Ziele, die sich lohnen.'
        : 'Summe aller archivierten Angriffe je Ziel — begünstigt, was oft angeflogen wurde.'}</div>
      ${barList(targets, { foot: `${loot.targets.length} Ziele im Archiv` })}
    </section>`;
}

function archiveSection() {
  if (!state.radar.user) {
    return `<section class="panel"><div class="head"><h3>Beute-Archiv</h3>
      <span class="hint">Speichert jeden Bericht dauerhaft und zeichnet den Verlauf.</span></div>
      <div class="body">${emptyState('Zum Archivieren im Tab „Farmradar" bei Supabase anmelden.')}</div></section>`;
  }
  return `<section class="panel"><div class="head"><h3>Beute-Archiv</h3>
      <span class="hint">${state.loot.loadedAt
        ? `Stand ${new Date(state.loot.loadedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
        : 'noch nicht geladen'} · schon bekannte Berichte werden übersprungen</span></div>
      <div class="body">${archiveHead()}</div></section>
    ${lootCharts()}`;
}

export function renderFarmen() {
  const summary = atlas();
  const fromArchive = summary.source === 'archiv';
  const best = summary.farms[0];
  // Was schon in der Luft ist, muss nicht nochmal losgeschickt werden.
  const flights = farmFlights(state.fleets, state.ownPlanets);
  const enRoute = summary.notAttackedToday.filter((f) => flights.has(f.target));
  const open = summary.notAttackedToday.filter((f) => !flights.has(f.target));
  const flightsKnown = state.fleets.length > 0;
  // Altes Schema im Projekt: die View liefert Schnitt und Aufschlüsselung
  // des letzten Angriffs noch nicht.
  const stale = !!summary.legacy;
  return `<section class="farm-intro">
      <div><div class="eyebrow">Angriffsberichte</div><h1>Farmatlas</h1>
      <p>${fromArchive
        ? 'Grundlage ist das komplette Beute-Archiv — auch Ziele, die im zuletzt eingefügten Berichtsblatt gar nicht mehr auftauchen.'
        : 'Die jüngste Spionage pro Ziel entscheidet über die Rangfolge. Farmen ohne Bericht von heute bleiben sichtbar, damit kein Rundgang verloren geht.'}</p></div>
      <div class="farm-count mono"><b>${summary.farms.length}</b><span>${fromArchive ? 'Farmen im Archiv' : 'erkannte Farmen'}</span></div>
    </section>
    <section class="panel farm-import">
      <div class="head"><h3>Angriffsberichte einfügen</h3><span class="hint">Komplette Berichtsseite aus GigraWars einfügen.</span></div>
      <div class="body"><textarea id="inputFarmReports" spellcheck="false" placeholder="Angriffsberichte hier einfügen …">${esc(state.farmPaste)}</textarea>
      <div class="row"><button class="btn primary" id="btnAnalyzeFarms">Farmen auswerten</button><button class="btn sm ghost" id="btnClearFarms">Farmdaten leeren</button></div></div>
    </section>
    ${archiveSection()}
    ${stale ? `<div class="empty bad">Das Archiv im Supabase-Projekt läuft noch auf einem älteren Schemastand:
      die View <code>farm_loot_targets</code> liefert weder den Schnitt je Angriff noch die Aufschlüsselung des
      letzten Angriffs. Der Schnitt wird hier aus Summe und Anzahl gerechnet, die Rohstoff-Aufteilung fehlt.
      Einmal <code>supabase/schema.sql</code> im SQL-Editor ausführen, dann stimmt alles wieder.</div>` : ''}
    ${summary.farms.length ? `<div class="signals farm-signals">
      <div class="sig f"><div class="k">${fromArchive ? 'Farmen im Archiv' : 'Erfasste Farmen'}</div><div class="v">${summary.farms.length}</div><div class="sub">${num(summary.reports)} Berichte ${fromArchive ? 'archiviert' : 'eingelesen'}</div></div>
      <div class="sig o"><div class="k">Heute angeflogen</div><div class="v">${summary.attackedToday.length}</div><div class="sub">letzter Angriff von heute</div></div>
      <div class="sig s"><div class="k">Jetzt offen</div><div class="v">${open.length}</div><div class="sub">${flightsKnown
        ? `${enRoute.length} bereits unterwegs`
        : 'Übersichtsseite einfügen, dann zählen laufende Flotten mit'}</div></div>
      <div class="sig t"><div class="k">${fromArchive ? 'Beste Ø-Beute' : 'Beste Beute'}</div><div class="v">${num(fromArchive ? best.avg : best.total)}</div><div class="sub">${coordChip(best.target)} ${esc(best.player)}</div></div>
    </div>
    <div class="farm-columns">
      <section class="section"><h2>◆ Lohnendste Farmen</h2><div class="desc">${fromArchive
        ? 'Sortiert nach der durchschnittlichen Beute je Angriff über alle archivierten Anflüge.'
        : 'Sortiert nach allen im jüngsten Bericht sichtbaren Rohstoffen.'}</div>${farmRows(summary.farms, 'profitable', false, summary.source, flights, stale)}</section>
      <section class="section"><h2>○ Heute noch nicht angeflogen</h2><div class="desc">${fromArchive
        ? 'Jede je gefarmte Koordinate ohne Angriff von heute und ohne laufende Flotte — nach Ø-Beute sortiert.'
        : 'Diese Farmen haben im eingefügten Verlauf keinen Bericht von heute und keine Flotte unterwegs.'}${flightsKnown ? '' : ' Ohne eingefügte Übersichtsseite sind laufende Flotten unbekannt.'}</div>${farmRows(open, 'unvisited', true, summary.source, null, stale)}
        ${enRoute.length ? `<h3 class="farm-subhead">⚔️ Bereits unterwegs (${enRoute.length})</h3>
          <div class="desc">Diese Ziele stehen schon auf dem Flugplan — Rückflüge bedeuten, dass der Bericht nur noch fehlt.</div>
          ${farmRows(enRoute, 'enroute', true, summary.source, flights, stale)}` : ''}</section>
    </div>`
      : emptyState('Füge die Angriffsberichte ein, um die Farmen zu vergleichen.')}`;
}
