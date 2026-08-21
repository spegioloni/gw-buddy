// Farmliste: die tatsächlich beflogenen Ziele je eigenem Planeten. Die
// Schiffszahl begrenzt die Plätze — hier steht, was sie einbringen und was
// gegen ein besseres Ziel getauscht gehört. Geladen und geschrieben wird in
// app.js; diese Datei rendert nur.
import { state } from '../state.js';
import { rankFarms, coordParts, formatIdle, attackIndex, farmExportName, npcCandidates } from '../radar.js';
import { rosterFor, suggestSwaps, resShare, trendOf, rosterIndex, avgPerFlight } from '../farmroster.js';
import { reportsAsLootTargets } from '../parse/farmberichte.js';
import { coordChip, esc, num, short } from '../util/time.js';
import { emptyState, farmTargetCard } from './components.js';
import { ownPlanetList } from './farmradar.js';

const STATE_LABEL = {
  stark: 'trägt', neu: 'neu', kalt: 'kalt', schwach: 'schwach', leer: 'nie geflogen', wach: 'wieder aktiv',
};

const when = (ms) => (ms ? new Date(ms).toLocaleString('de-DE', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
}) : '–');

/**
 * Planeten, für die eine Liste infrage kommt: die eigenen — plus alle, für
 * die schon etwas gespeichert ist (etwa nach einem Planetenverkauf).
 */
export function rosterPlanets() {
  const own = ownPlanetList();
  const extra = [...new Set(state.roster.rows.map((r) => r.origin))].filter((c) => !own.includes(c));
  return [...own, ...extra];
}

/** Der gerade betrachtete Planet — Auswahl, sonst der erste mit Liste. */
export function rosterOrigin() {
  const list = rosterPlanets();
  const chosen = state.roster.origin;
  if (chosen && list.includes(chosen)) return chosen;
  const used = state.roster.rows.find((r) => r.active !== false)?.origin;
  return used && list.includes(used) ? used : (list[0] || '');
}

/** Kapazität dieses Planeten (Voreinstellung: 8 Plätze). */
export function slotsFor(origin) {
  const row = state.roster.slots.find((s) => s.origin === origin);
  return row ? Number(row.slots) : 8;
}

/**
 * Aufbereitete Liste des gewählten Planeten.
 *
 * „wieder aktiv" richtet sich nach deiner eigenen Radar-Schwelle: Wer laut
 * Filter als inaktiv genug gilt, um überhaupt vorgeschlagen zu werden, darf
 * hier nicht als aufgewacht gelten. Sonst widerspricht sich das Dashboard.
 */
export function rosterView(origin = rosterOrigin()) {
  const idleHours = Number(state.radar.settings?.idleHours);
  return rosterFor(state.roster.rows, origin, slotsFor(origin),
    Number.isFinite(idleHours) && idleHours > 0 ? { wakeHours: idleHours } : {});
}

/**
 * Kandidaten für freie Plätze: dieselbe Bewertung wie im Radar, aber streng
 * auf diesen einen Planeten bezogen — die Liste wird ja von dort geflogen.
 */
export function rosterCandidates(origin) {
  if (!coordParts(origin)) return [];
  const s = state.radar.settings || {};
  return rankFarms(state.radar.rows, {
    own: [origin],
    mine: ownPlanetList(),
    idleHours: s.idleHours,
    maxSystems: s.maxSystems,
    sameGalaxyOnly: s.sameGalaxyOnly,
    maxPoints: s.maxPoints,
    attacks: attackIndex(state.loot.targets),
  });
}

/**
 * Ziele aus Kampfberichten, die keine Highscore-Zeile haben — vor allem
 * NPCs. Die Highscores kennen nur Spieler, das Beute-Archiv (oder ersatzweise
 * die zuletzt eingefügten Berichte, solange noch nichts archiviert ist)
 * kennt auch Ziele ohne Besitzereintrag.
 */
export function rosterNpcCandidates(origin) {
  if (!coordParts(origin)) return [];
  const s = state.radar.settings || {};
  const targets = state.loot.targets.length ? state.loot.targets : reportsAsLootTargets(state.farmReports);
  return npcCandidates(targets, {
    radarRows: state.radar.rows,
    own: [origin],
    mine: ownPlanetList(),
    maxSystems: s.maxSystems,
    sameGalaxyOnly: s.sameGalaxyOnly,
  });
}

function planetField(origin) {
  const list = rosterPlanets();
  if (!list.length) {
    return `<label>Planet<b class="mono">keine eigenen Planeten bekannt</b></label>`;
  }
  const opts = list.map((c) => `<option value="${esc(c)}"${c === origin ? ' selected' : ''}>${esc(c)}</option>`).join('');
  return `<label>Planet
    <select class="inp" data-roster="origin">${opts}</select>
    <b class="mono">Startplanet der Runde</b></label>`;
}

function controls(origin, view) {
  return `<section class="panel">
    <div class="head"><h3>Planet & Kapazität</h3>
      <span class="hint">Die Plätze sind die Ziele, die deine Flotte von hier aus in einer Runde schafft. Mehr Ziele als Plätze heißt: etwas muss weichen.</span></div>
    <div class="body">
      <div class="radar-grid">
        ${planetField(origin)}
        <label>Farmplätze
          <input class="inp" type="number" min="0" max="200" step="1" value="${view.slots}" data-roster="slots">
          <b class="mono">${view.active.length} belegt · ${view.over ? `${view.over} zu viel` : `${view.free} frei`}</b></label>
        <label>Ø Tagesertrag (Median)
          <b class="mono">${num(view.median)}</b>
          <b class="mono">Maßstab für „schwach"</b></label>
      </div>
    </div>
  </section>`;
}

/** Rohstoffbalken: woraus die Beute dieser Farm besteht. */
function resBar(row) {
  const parts = resShare(row.res).filter((r) => r.value > 0);
  if (!parts.length) return '';
  const bar = parts.map((r) => `<span class="rs ${r.key}" style="flex:${r.share}" title="${r.label} ${num(r.value)}"></span>`).join('');
  const labels = parts.map((r) => `${r.label} ${Math.round(r.share * 100)} %`).join(' · ');
  return `<div class="roster-bar">${bar}</div><small class="roster-barlabel">${esc(labels)}</small>`;
}

/**
 * Zahlenblock einer Karte: das, wonach man „lohnt sich?" entscheidet.
 *
 * Die sechs Felder stehen immer an derselben Stelle — nur so lassen sich
 * Karten nebeneinander vergleichen. Fehlen eigene Flüge seit der Aufnahme,
 * springen die Werte auf das Beute-Archiv um (auch Flüge von früher oder von
 * anderen Planeten); das ist an der blassen Schrift und der Notiz erkennbar.
 */
function statGrid(row, gap) {
  const arch = !row.reports && row.lifeReports > 0;
  const src = arch
    ? { avg: row.lifeAvg, best: row.lifeBest, last: row.lifeLast, total: row.lifeTotal, reports: row.lifeReports,
        hours: row.lifeLastAt == null ? null : Math.floor((Date.now() - row.lifeLastAt) / 3600e3) }
    : { avg: row.avg, best: row.best, last: row.last, total: row.total, reports: row.reports,
        hours: row.hoursSinceLast };
  const t = trendOf(row);
  const dash = (v, text = short(v)) => (v ? text : '–');
  const cells = [
    ['bester Flug', dash(src.best), arch ? 'Bestwert aller je gemeldeten Flüge' : (src.best ? 'Obergrenze der Lager' : 'noch kein eigener Flug')],
    ['letzter Flug', dash(src.last), arch ? 'jüngster Flug im Beute-Archiv' : (t ? t.label : 'noch kein eigener Flug')],
    ['Beute gesamt', dash(src.total), arch ? 'alles, was dieses Ziel je gebracht hat' : `seit ${row.daysListed} T auf der Liste`],
    ['Flüge', num(src.reports), arch ? 'aus dem Beute-Archiv, auch von anderen Planeten' : 'Berichte seit der Aufnahme'],
    ['zuletzt', src.hours == null ? 'nie' : `vor ${formatIdle(src.hours)}`,
      row.lastAt || row.lifeLastAt ? when(row.lastAt || row.lifeLastAt) : 'noch kein Bericht'],
    ['Entfernung', gap != null ? `${gap} Sys` : '–', 'Flugweg vom Startplaneten'],
  ];
  const note = row.reports ? '' : `<small class="roster-context">${arch
    ? 'Zahlen aus dem Archiv — seit der Aufnahme hier noch kein eigener Flug.'
    : 'Noch nie angeflogen: Zahlen entstehen, sobald ein Kampfbericht im Beute-Archiv landet.'}</small>`;
  return `<div class="roster-stats mono${arch ? ' arch' : ''}">${cells.map(([k, v, hint]) =>
    `<div class="rstat" title="${esc(hint)}"><span class="k">${k}</span><b>${v}</b></div>`).join('')}</div>${note}`;
}

/**
 * Kontext, der nichts mit dem eigenen Ertrag zu tun hat: Größe des Ziels,
 * wie lange es schon schläft, wie weit es weg ist — und was die Farm
 * insgesamt (auch von anderen Planeten, auch vor einer Pause) gebracht hat.
 */
function contextLine(row) {
  const bits = [
    `${num(row.planetPoints)} P Planet`,
    row.totalPoints ? `${num(row.totalPoints)} P Spieler${row.planetCount ? ` · ${row.planetCount} Planeten` : ''}` : null,
    row.playerIdleHours == null ? null
      : `${formatIdle(row.playerIdleHours)} ${row.idleConfirmed === false ? 'beobachtet' : 'inaktiv'}`,
    row.perDay ? `${short(row.perDay)} je Tag seit Aufnahme` : null,
    row.lifeReports > row.reports
      ? `insgesamt ${num(row.lifeReports)} Flüge · Ø ${short(row.lifeAvg)}` : null,
  ].filter(Boolean);
  return `<small class="roster-context">${esc(bits.join(' · '))}</small>`;
}

/** Systemabstand vom Startplaneten — die eigentliche Flugkostenfrage. */
function systemGap(origin, target) {
  const a = coordParts(origin), b = coordParts(target);
  if (!a || !b || a.galaxy !== b.galaxy) return null;
  return Math.abs(a.system - b.system);
}

function rosterRow(row, origin) {
  const h = row.health;
  const t = trendOf(row);
  const gap = systemGap(origin, row.target);
  // Oben groß steht der Schnitt je Flug — die Zahl, an der sich entscheidet,
  // ob der Platz seinen Schiffsraum wert ist. Ohne eigene Flüge seit der
  // Aufnahme zählt der Archivschnitt; ganz ohne Bericht bleibt ein Strich.
  const arch = !row.reports && row.lifeReports > 0;
  const avg = avgPerFlight(row);
  return `<article class="farm-card ${h.state}">
    <div class="rc-head">
      <div class="rc-name">${coordChip(row.target)}<b>${esc(row.player || '?')}</b>
        ${row.alliance ? `<span class="rc-tag">[${esc(row.alliance)}]</span>` : ''}</div>
      <div class="rc-day mono${arch ? ' arch' : ''}" title="${arch ? 'Schnitt aus dem Beute-Archiv' : 'Schnitt der eigenen Flüge seit der Aufnahme'}"><b>${avg ? short(avg) : '–'}</b><small>Ø je Flug</small></div>
    </div>
    <span class="farm-badge ${h.state}">${STATE_LABEL[h.state] || h.state} · ${esc(h.reason)}</span>
    ${t && t.dir !== 'flat' ? `<span class="farm-badge ${t.dir === 'down' ? 'schwach' : 'stark'}">${t.dir === 'down' ? '▼' : '▲'} ${esc(t.label)}</span>` : ''}
    ${contextLine(row)}
    ${statGrid(row, gap)}
    ${resBar(row)}
    ${row.note ? `<small class="roster-context">Notiz: ${esc(row.note)}</small>` : ''}
    <div class="roster-actions">
      <button class="btn sm ghost" data-roster-drop="${esc(row.target)}" data-reason="${esc(h.state === 'stark' ? 'ersetzt' : h.reason)}">entfernen</button>
    </div>
  </article>`;
}

/**
 * Nachrücker: dieselbe Karte wie im Radar, damit ein Kandidat und ein
 * belegter Platz Zahl für Zahl vergleichbar sind. Der Startplanet steht
 * fest — es ist der gerade betrachtete.
 */
function candidateRow(row, origin, listedBy) {
  return farmTargetCard(row, {
    origin,
    listed: listedBy?.get(row.coord),
    addLabel: 'aufnehmen',
  });
}

function droppedPanel(view) {
  if (!view.dropped.length) return '';
  if (!state.roster.showDropped) {
    return `<div class="row farm-more"><button class="btn sm ghost" id="btnRosterDropped">▾ ${view.dropped.length} abgelegte Ziele zeigen</button></div>`;
  }
  const rows = view.dropped.map((r) => `<article class="farm-card stale">
    <div class="rc-head">
      <div class="rc-name">${coordChip(r.target)}<b>${esc(r.player || '?')}</b></div>
      <div class="rc-day mono"><b>${short(r.total)}</b><small>Beute gesamt</small></div>
    </div>
    <small class="roster-context">abgelegt ${when(r.removedAt)}${r.dropReason ? ` · ${esc(r.dropReason)}` : ''} · ${num(r.reports)} Flüge · Ø ${short(r.avg)}${r.lifeReports ? ` · insgesamt ${num(r.lifeReports)} Flüge` : ''}</small>
    <div class="roster-actions"><button class="btn sm ghost" data-roster-readd="${esc(r.target)}" data-player="${esc(r.player || '')}">zurückholen</button></div>
  </article>`).join('');
  return `<div class="row farm-more"><button class="btn sm ghost" id="btnRosterDropped">▴ Abgelegte ausblenden</button></div>
    <div class="farm-list cards">${rows}</div>`;
}

/**
 * Fehlt die Farmliste im Projekt, meldet Supabase nur „table not found".
 * Das ist kein Fehler, sondern ein fehlender Schemastand — sag, was zu tun
 * ist, statt die Rohmeldung durchzureichen.
 */
export function rosterError(message) {
  const text = String(message || '');
  return /farm_roster|farm_slots|roster_/.test(text)
    ? `Die Farmverwaltung fehlt noch in deinem Supabase-Projekt: supabase/schema.sql erneut im SQL-Editor ausführen. (${text})`
    : text;
}

export function renderFarmliste() {
  const head = `<section class="farm-intro">
      <div><div class="eyebrow">Farmverwaltung</div><h1>Farmliste</h1>
      <p>Deine Schiffe reichen für eine feste Zahl an Zielen. Diese Liste hält fest, welche Farmen ein Planet gerade bedient, was jede davon je Tag abwirft — und welche einen Platz blockiert, ohne ihn zu verdienen.</p></div>
      <div class="farm-count mono"><b>${num(state.roster.rows.filter((r) => r.active !== false).length)}</b><span>Plätze belegt</span></div>
    </section>`;

  const msg = state.roster.error
    ? `<div class="empty bad">${esc(rosterError(state.roster.error))}</div>`
    : state.roster.notice ? `<div class="empty">${esc(state.roster.notice)}</div>` : '';

  if (!state.radar.user) {
    return head + msg + emptyState('Die Farmliste liegt in Supabase — melde dich im Farmradar-Tab an.');
  }

  const origin = rosterOrigin();
  if (!origin) {
    return head + msg + emptyState('Kein eigener Planet bekannt: füge im Lage-Tab die Gesamtübersicht ein.');
  }

  const view = rosterView(origin);
  const candidates = rosterCandidates(origin);
  const swap = suggestSwaps(view, candidates);
  const listedBy = rosterIndex(state.roster.rows);
  // NPCs & Co.: kein Highscore-Eintrag, aber im Beute-Archiv als Ziel
  // bekannt. Was schon auf irgendeiner Liste steht (aktiv oder abgelegt),
  // fliegt hier raus — sonst würde dieselbe Farm zweimal vorgeschlagen.
  const known = new Set([...view.active, ...view.dropped].map((r) => r.target));
  const npcOpen = rosterNpcCandidates(origin).filter((r) => !known.has(r.coord));

  const signals = `<div class="signals farm-signals">
    <div class="sig f"><div class="k">Belegte Plätze</div><div class="v">${view.active.length} / ${view.slots}</div><div class="sub">${view.over ? `${view.over} über der Kapazität` : `${view.free} frei`}</div></div>
    <div class="sig o"><div class="k">Ertrag je Tag</div><div class="v">${short(view.perDay)}</div><div class="sub">Summe aller Plätze dieses Planeten</div></div>
    <div class="sig ${view.weak.length ? 's' : 't'}"><div class="k">Austauschen</div><div class="v">${view.weak.length}</div><div class="sub">${view.weak.length ? 'Plätze bringen zu wenig' : 'alles trägt'}</div></div>
    <div class="sig t"><div class="k">Stand</div><div class="v">${state.roster.loadedAt ? when(state.roster.loadedAt).slice(-5) : '–'}</div><div class="sub">${state.roster.loadedAt ? when(state.roster.loadedAt) : 'nicht geladen'}</div></div>
  </div>`;

  const actions = `<section class="panel">
    <div class="head"><h3>Runde exportieren</h3>
      <span class="hint">Die aktiven Ziele dieses Planeten als JSON für den Farmbot — nach Ertrag je Flug sortiert, Format <code>[["12:68:5","Manor"], …]</code>. Was hier nicht auf der Liste steht, wird auch nicht exportiert.</span></div>
    <div class="body"><div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
      <button class="btn primary" id="btnRosterExport"${view.active.length ? '' : ' disabled'}>⬇ ${num(view.active.length)} Farmen exportieren</button>
      <button class="btn sm ghost" id="btnRosterReload">${state.roster.busy === 'load' ? 'Lade …' : '⟳ neu laden'}</button>
      ${view.weak.length ? `<button class="btn sm ghost" id="btnRosterDropWeak">${view.weak.length} schwache entfernen</button>` : ''}
      <span class="pill mono">${esc(farmExportName(origin))}</span>
    </div></div>
  </section>`;

  const listSection = view.active.length
    ? `<section class="section"><h2>◆ Belegte Plätze</h2>
        <div class="desc">Sortiert nach Ertrag je Flug — oben steht, was einen Anflug am meisten lohnt. Was unten steht, kostet Flugzeit ohne Gegenwert.</div>
        <div class="farm-list cards">${view.active.map((r) => rosterRow(r, origin)).join('')}</div>${droppedPanel(view)}</section>`
    : `<section class="section"><h2>◆ Belegte Plätze</h2>${emptyState('Noch keine Farm auf der Liste — rechts aus den Vorschlägen aufnehmen oder im Farmradar auswählen und „in die Farmliste" klicken.')}${droppedPanel(view)}</section>`;

  const suggestSection = `<section class="section"><h2>○ Nachrücker</h2>
    <div class="desc">${swap.room
      ? `${swap.room} Plätze zu besetzen (frei oder schwach belegt). Bereits gelistete und früher abgelegte Ziele sind ausgeblendet.`
      : 'Alle Plätze sind gut belegt — Nachrücker erst, wenn ein Platz frei wird.'}</div>
    ${swap.add.length ? `<div class="farm-list cards">${swap.add.map((r) => candidateRow(r, origin, listedBy)).join('')}</div>`
      : emptyState(state.radar.rows.length
        ? 'Keine neuen Ziele im Radarumkreis dieses Planeten. Umkreis im Farmradar vergrößern.'
        : 'Noch keine Radardaten geladen — im Farmradar „Ziele neu laden".')}</section>`;

  const npcSection = `<section class="section"><h2>○ NPCs & unbekannte Ziele</h2>
    <div class="desc">Ziele aus Kampfberichten ohne Highscore-Eintrag — meist NPC-Dörfer/-Stützpunkte. Sie tauchen im Farmradar nie auf, lassen sich hier aber trotzdem aufnehmen.</div>
    ${npcOpen.length ? `<div class="farm-list cards">${npcOpen.map((r) => candidateRow(r, origin, listedBy)).join('')}</div>`
      : emptyState('Keine NPC-Ziele im Umkreis dieses Planeten bekannt — dafür braucht es einen Kampfbericht gegen sie.')}</section>`;

  return head + msg + controls(origin, view) + signals + actions
    + `<div class="farm-columns">${listSection}${suggestSection}${npcSection}</div>`;
}
