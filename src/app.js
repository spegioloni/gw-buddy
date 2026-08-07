// Bootstrap: Tabs, Paste-Auswertung, Live-Tick, Alarme. Kein API-Zugriff.
import { state, serverNow, loadPersisted, ingest, clearAll, persist } from './state.js';
import { nextImpact } from './analysis.js';
import { clock, hhmmss, durLong, esc, coordChip } from './util/time.js';
import { renderLage } from './views/lage.js';
import { renderBauen } from './views/bauen.js';
import { renderFlotten } from './views/flotten.js';
import { renderZeitachse, toggleType } from './views/zeitachse.js';
import { DEMO_GESAMT, DEMO_UEBERSICHT } from './demo.js';

const $ = (s) => document.querySelector(s);
const VIEWS = { lage: renderLage, bauen: renderBauen, flotten: renderFlotten, zeitachse: renderZeitachse };
let tab = persist.getTab();
const alarmed = new Set();

function render() {
  const fn = VIEWS[tab] || renderLage;
  $('#view').innerHTML = fn();
  document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
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
  const active = state.uebersicht?.activePlanet;
  $('#ctx').innerHTML = active ? `Aktiver Planet ${coordChip(active, 'mine')}` : '';
}

function switchTab(t) {
  tab = t; persist.setTab(t);
  closeDrawer();
  render();
}

function analyze() {
  const text = $('#input').value.trim();
  if (!text) { toast('Bitte zuerst eine Ansicht einfügen.', 'bad'); return; }
  const res = ingest(text);
  if (!res.ok) { toast('❌ ' + esc(res.message), 'bad'); return; }
  $('#input').value = '';
  const label = res.type === 'gesamt' ? 'Gesamtübersicht' : 'Übersichtsseite';
  toast(`✅ ${label} übernommen — ${esc(res.message)}`, 'ok');
  alarmed.clear();
  render();
}

function loadDemo() {
  ingest(DEMO_GESAMT); ingest(DEMO_UEBERSICHT);
  toast('Beispieldaten geladen.', 'ok');
  alarmed.clear(); render();
}

/* ---------- Tick: Uhr, Countdowns, Now-Linie, Alarme ---------- */
function tick() {
  const now = serverNow();
  const clk = $('#clock');
  if (clk) clk.textContent = hhmmss(now);

  document.querySelectorAll('.cd[data-at]').forEach((el) => {
    const at = +el.dataset.at;
    if (!at) return;
    el.textContent = clock((at - now) / 1000);
    el.classList.toggle('past', at < now);
  });

  document.querySelectorAll('.gantt[data-from]').forEach((g) => {
    const from = +g.dataset.from, span = +g.dataset.span;
    const nowLine = g.querySelector('.now');
    if (nowLine && span) nowLine.style.left = ((now - from) / span * 100).toFixed(2) + '%';
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
  $('#input').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); analyze(); }
  });

  // Zeitachse-Filter (Event-Delegation).
  $('#view').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tl]');
    if (btn) { toggleType(btn.dataset.tl); render(); }
  });

  setInterval(tick, 250);
  render();
}
document.addEventListener('DOMContentLoaded', init);
