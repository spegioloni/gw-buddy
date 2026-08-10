import { state } from '../state.js';
import { farmSummary } from '../parse/farmberichte.js';
import { coordChip, esc, num } from '../util/time.js';
import { emptyState } from './components.js';

const dateLabel = (at) => at == null ? 'Zeitpunkt nicht erkannt' : new Date(at).toLocaleString('de-DE', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

function farmRows(farms, list, muted = false) {
  if (!farms.length) return emptyState(muted ? 'Alle erfassten Farmen wurden heute angegriffen.' : 'Noch keine Farmberichte erkannt.');
  const showAll = state.farmShowAll[list];
  const visible = showAll ? farms : farms.slice(0, 10);
  return `<div class="farm-list">${visible.map((farm, index) => `<article class="farm-row${muted ? ' stale' : ''}">
    <div class="farm-rank mono">${muted ? '○' : `#${index + 1}`}</div>
    <div class="farm-target">${coordChip(farm.target)}<b>${esc(farm.player)}</b><small>${dateLabel(farm.at)}</small></div>
    <div class="farm-loot mono"><b>${num(farm.total)}</b><small>Rohstoffe gesamt</small></div>
    <div class="farm-res mono">
      <span>E ${num(farm.resources.iron)}</span><span>L ${num(farm.resources.lutinum)}</span>
      <span>W ${num(farm.resources.water)}</span><span>H ${num(farm.resources.hydrogen)}</span>
    </div>
  </article>`).join('')}</div>${farms.length > 10 ? `<button class="btn sm ghost farm-more" data-farm-list="${list}">${showAll ? 'Weniger anzeigen' : `Zeige mehr (${farms.length - 10})`}</button>` : ''}`;
}

export function renderFarmen() {
  const summary = farmSummary(state.farmReports);
  return `<section class="farm-intro">
      <div><div class="eyebrow">Angriffsberichte</div><h1>Farmatlas</h1>
      <p>Die jüngste Spionage pro Ziel entscheidet über die Rangfolge. Farmen ohne Bericht von heute bleiben sichtbar, damit kein Rundgang verloren geht.</p></div>
      <div class="farm-count mono"><b>${summary.farms.length}</b><span>erkannte Farmen</span></div>
    </section>
    <section class="panel farm-import">
      <div class="head"><h3>Angriffsberichte einfügen</h3><span class="hint">Komplette Berichtsseite aus GigraWars einfügen.</span></div>
      <div class="body"><textarea id="inputFarmReports" spellcheck="false" placeholder="Angriffsberichte hier einfügen …"></textarea>
      <div class="row"><button class="btn primary" id="btnAnalyzeFarms">Farmen auswerten</button><button class="btn sm ghost" id="btnClearFarms">Farmdaten leeren</button></div></div>
    </section>
    ${summary.farms.length ? `<div class="signals farm-signals">
      <div class="sig f"><div class="k">Erfasste Farmen</div><div class="v">${summary.farms.length}</div><div class="sub">${summary.reports} Berichte eingelesen</div></div>
      <div class="sig o"><div class="k">Heute angegriffen</div><div class="v">${summary.attackedToday.length}</div><div class="sub">letzter Bericht von heute</div></div>
      <div class="sig s"><div class="k">Heute offen</div><div class="v">${summary.notAttackedToday.length}</div><div class="sub">letzter Bericht vor heute</div></div>
      <div class="sig t"><div class="k">Beste Beute</div><div class="v">${num(summary.farms[0].total)}</div><div class="sub">${coordChip(summary.farms[0].target)} ${esc(summary.farms[0].player)}</div></div>
    </div>
    <div class="farm-columns">
      <section class="section"><h2>◆ Lohnendste Farmen</h2><div class="desc">Sortiert nach allen im jüngsten Bericht sichtbaren Rohstoffen.</div>${farmRows(summary.farms, 'profitable')}</section>
      <section class="section"><h2>○ Heute noch nicht angegriffen</h2><div class="desc">Diese Farmen haben im eingefügten Verlauf keinen Bericht von heute.</div>${farmRows(summary.notAttackedToday, 'unvisited', true)}</section>
    </div>`
      : emptyState('Füge die Angriffsberichte ein, um die Farmen zu vergleichen.')}`;
}
