// Bootstrap: Tabs, Paste-Auswertung, Live-Tick, Alarme. Kein API-Zugriff.
import { state, serverNow, loadPersisted, ingest, ingestRequiredPair, hasRequiredData, clearAll, clearFarmReports, persist } from './state.js';
import { nextImpact, resourceAt } from './analysis.js';
import { clock, hhmmss, durLong, esc, coordChip } from './util/time.js';
import { deLabel } from './domain.js';
import { renderLage } from './views/lage.js';
import { renderBauen } from './views/bauen.js';
import { renderFlotten } from './views/flotten.js';
import { renderPrognose } from './views/prognose.js';
import { renderFarmen } from './views/farmen.js';
import { setZoom } from './views/timeline.js';
import { DEMO_GESAMT, DEMO_UEBERSICHT } from './demo.js';

const $ = (s) => document.querySelector(s);
const VIEWS = { lage: renderLage, bauen: renderBauen, flotten: renderFlotten, prognose: renderPrognose, farmen: renderFarmen };
let tab = persist.getTab();
let forecastPlanet = null;
if (!VIEWS[tab]) tab = 'lage';
const alarmed = new Set();

function render() {
  const fn = VIEWS[tab] || renderLage;
  $('#view').innerHTML = tab === 'farmen'
    ? fn()
    : hasRequiredData()
    ? (tab === 'prognose' ? fn(forecastPlanet) : fn())
    : '<div class="empty">Füge zuerst die Übersichtsseite (HTML oder Text) und die Gesamtübersicht ein.</div>';
  document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('#importPanel').hidden = tab === 'farmen' || (tab !== 'lage' && hasRequiredData());
  renderStatus();
  tick();
}

function renderStatus() {
  const parts = [];
  if (state.gesamt) parts.push(`<span class="pill">Gesamtübersicht · ${state.gesamt.planets.length} Planeten</span>`);
  if (state.uebersicht) {
    const age = state.snapshotAge != null ? ` · Snapshot vor ${durLong(state.snapshotAge)}` : '';
    parts.push(`<span class="pill">Übersichtsseite · ${state.fleets.length} Flotten${age}</span>`);
  }
  $('#status').innerHTML = parts.join(' ') || '<span class="pill">keine Daten geladen</span>';
  const stale = state.snapshotAge != null && state.snapshotAge > 3600;
  $('#staleBadge').hidden = !stale;
  const active = state.uebersicht?.activePlanet;
  $('#ctx').innerHTML = active ? `Aktiver Planet ${coordChip(active, 'mine')}` : '';
}

function switchTab(t) {
  tab = t; persist.setTab(t);
  closeDrawer();
  render();
}

function analyze() {
  const overview = $('#inputOverview').value.trim();
  const gesamt = $('#inputGesamt').value.trim();
  if (!overview || !gesamt) { toast('Bitte beide Ansichten einfügen.', 'bad'); return; }
  const res = ingestRequiredPair(overview, gesamt);
  if (!res.ok) { toast('❌ ' + esc(res.message), 'bad'); return; }
  $('#inputOverview').value = '';
  $('#inputGesamt').value = '';
  toast(`✅ Ansichten übernommen — ${esc(res.message)}`, 'ok');
  alarmed.clear();
  render();
}

function loadDemo() {
  const res = ingestRequiredPair(DEMO_UEBERSICHT, DEMO_GESAMT);
  if (!res.ok) { toast('❌ ' + esc(res.message), 'bad'); return; }
  toast('Beispieldaten geladen.', 'ok');
  alarmed.clear(); render();
}

/* ---------- Tick: Uhr, Countdowns, Now-Linie, Alarme ---------- */
function tick() {
  const now = serverNow();
  const clk = $('#clock');
  if (clk) clk.textContent = hhmmss(now);

  let justExpired = false;
  document.querySelectorAll('.cd[data-at]').forEach((el) => {
    const at = +el.dataset.at;
    if (!at) return;
    const wasPast = el.classList.contains('past');
    el.textContent = clock((at - now) / 1000);
    const isPast = at < now;
    el.classList.toggle('past', isPast);
    if (isPast && !wasPast) justExpired = true;
  });
  // Sobald ein Countdown auf 0 läuft, den aktuellen Tab neu rendern — sonst
  // bleiben abgelaufene Bauaufträge/Ankünfte bis zum nächsten Datenimport
  // in der Liste stehen, weil render() diese sonst nur beim Einfügen neuer
  // Daten oder Tab-Wechsel herausfiltert.
  if (justExpired) { render(); return; }

  document.querySelectorAll('.gantt[data-from]').forEach((g) => {
    const from = +g.dataset.from, span = +g.dataset.span;
    const nowLine = g.querySelector('.now');
    // Der "jetzt"-Strich zeigt die reale Client-Uhrzeit, nicht die
    // (ggf. per Snapshot-Offset korrigierte) Serverzeit.
    if (nowLine && span) nowLine.style.left = ((Date.now() - from) / span * 100).toFixed(2) + '%';
  });

  checkAlarms(now);
}

function checkAlarms(now) {
  if (!$('#alarmOn')?.checked) return;
  const imp = nextImpact();
  if (!imp) return;
  const sec = (imp.at - now) / 1000;
  for (const th of [600, 300, 60, 10]) {
    const key = imp.at + ':' + th;
    if (sec <= th && sec > th - 1 && !alarmed.has(key)) {
      alarmed.add(key);
      const msg = `Einschlag auf ${imp.ziel} in ${durLong(sec)}`;
      toast('⚠ ' + msg, 'bad');
      notify('GigraWars — Einschlag', msg);
    }
  }
}

function notify(title, body) {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') new Notification(title, { body });
    else if (Notification.permission !== 'denied') Notification.requestPermission();
  } catch { /* ignore */ }
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = kind; el.innerHTML = msg;
  $('#toast').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = '.3s'; setTimeout(() => el.remove(), 300); }, 4200);
}

/* ---------- Drawer ---------- */
function openDrawer() { $('#drawer').classList.add('open'); $('#scrim').classList.add('open'); }
function closeDrawer() { $('#drawer').classList.remove('open'); $('#scrim').classList.remove('open'); }

/* ---------- Init ---------- */
function init() {
  loadPersisted();
  $('#alarmOn').checked = persist.getAlarm();

  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#burger').addEventListener('click', openDrawer);
  $('#scrim').addEventListener('click', closeDrawer);

  $('#btnAnalyze').addEventListener('click', analyze);
  $('#btnDemo').addEventListener('click', loadDemo);
  $('#btnClear').addEventListener('click', () => { clearAll(); toast('Daten geleert.'); render(); });
  $('#btnFold').addEventListener('click', () => {
    const b = $('#importBody'); b.hidden = !b.hidden;
    $('#btnFold').textContent = b.hidden ? 'Einfügen ▸' : 'Einfügen ▾';
  });
  $('#alarmOn').addEventListener('change', (e) => persist.setAlarm(e.target.checked));
  for (const input of [$('#inputOverview'), $('#inputGesamt')]) {
    input.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); analyze(); }
    });
  }

  // Zoom-Stufen der Gantt-Zeitachse (im Lage-Tab).
  $('#view').addEventListener('click', (e) => {
    const farmMore = e.target.closest('[data-farm-list]');
    if (farmMore) {
      const list = farmMore.dataset.farmList;
      state.farmShowAll[list] = !state.farmShowAll[list];
      render(); return;
    }
    if (e.target.closest('#btnAnalyzeFarms')) {
      const text = $('#inputFarmReports').value.trim();
      if (!text) { toast('Bitte Angriffsberichte einfügen.', 'bad'); return; }
      const result = ingest(text);
      if (!result.ok || result.type !== 'farmberichte') { toast('Konnte keine Angriffsberichte erkennen.', 'bad'); return; }
      toast(`✅ ${result.message}`, 'ok'); render(); return;
    }
    if (e.target.closest('#btnClearFarms')) {
      clearFarmReports();
      render(); return;
    }
    const zoom = e.target.closest('[data-tlzoom]');
    if (zoom) { setZoom(zoom.dataset.tlzoom); render(); }
  });
  $('#view').addEventListener('change', (e) => {
    if (e.target.id === 'forecastPlanet') { forecastPlanet = e.target.value; render(); }
    if (e.target.matches('[data-forecast-target]')) {
      const value = e.target.value === '' ? null : Number(e.target.value);
      persist.setForecastTarget(e.target.dataset.coord, e.target.dataset.resource, value);
      render();
    }
  });
  $('#view').addEventListener('mousemove', (e) => {
    const airHit = e.target.closest('.air-chart-hit');
    if (airHit) {
      const chart = airHit.closest('.air-chart');
      const tip = chart.querySelector('.air-chart-tooltip');
      const rect = chart.getBoundingClientRect();
      const ratio = Math.max(5, Math.min(95, (e.clientX - rect.left) / rect.width * 100));
      tip.textContent = airHit.dataset.airDetail;
      tip.style.left = `${ratio}%`;
      tip.hidden = false;
      return;
    }
    const airLine = e.target.closest('.air-chart-line-hit');
    if (airLine) {
      const chart = airLine.closest('.air-chart');
      const tip = chart.querySelector('.air-chart-tooltip');
      const rect = chart.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const at = +airLine.dataset.airFrom + ratio * +airLine.dataset.airSpan;
      const ships = {};
      for (const flight of JSON.parse(airLine.dataset.airFlights)) {
        if (flight.at <= at) continue;
        for (const [key, amount] of Object.entries(flight.ships)) ships[key] = (ships[key] || 0) + amount;
      }
      const manifest = Object.entries(ships)
        .filter(([, amount]) => amount > 0)
        .sort(([, a], [, b]) => b - a)
        .map(([key, amount]) => `${amount.toLocaleString('de-DE')} × ${deLabel.ship(key)}`)
        .join('\n');
      const time = new Date(at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      tip.textContent = manifest ? `${time}\n${manifest}` : `${time}\n–`;
      tip.style.left = `${Math.max(5, Math.min(95, ratio * 100))}%`;
      tip.hidden = false;
      return;
    }
    const hit = e.target.closest('.forecast-hit');
    if (!hit) return;
    const card = hit.closest('.forecast-card');
    const rect = hit.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const at = +hit.dataset.from + ratio * 24 * 3600e3;
    const planet = state.planets.get(hit.dataset.coord);
    if (!planet) return;
    const stock = resourceAt(planet, hit.dataset.resource, at).stock;
    const tip = card.querySelector('.forecast-tooltip');
    tip.textContent = `${new Date(at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · ${stock.toLocaleString('de-DE')} ${hit.dataset.resource === 'hydrogen' ? 'Wasserstoff' : hit.dataset.resource}`;
    tip.style.left = `${Math.max(6, Math.min(94, ratio * 100))}%`;
    tip.hidden = false;
  });
  $('#view').addEventListener('mouseout', (e) => {
    const airHit = e.target.closest('.air-chart-hit');
    if (airHit && !airHit.contains(e.relatedTarget)) {
      airHit.closest('.air-chart').querySelector('.air-chart-tooltip').hidden = true;
      return;
    }
    const airLine = e.target.closest('.air-chart-line-hit');
    if (airLine && !airLine.contains(e.relatedTarget)) {
      airLine.closest('.air-chart').querySelector('.air-chart-tooltip').hidden = true;
      return;
    }
    const forecastCard = e.target.closest('.forecast-card');
    if (forecastCard && !forecastCard.contains(e.relatedTarget)) {
      forecastCard.querySelector('.forecast-tooltip').hidden = true;
    }
  });

  // Gantt-Zeitachse hängt an der Fensterbreite (Marker mit/ohne Uhrzeit) -> neu rendern.
  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(render, 150);
  });

  setInterval(tick, 250);
  render();
}
document.addEventListener('DOMContentLoaded', init);
