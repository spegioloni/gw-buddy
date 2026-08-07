// Anzeige-Helfer für Zeiten, Zahlen und Text (rein, kein State).
import { pad } from './format.js';

export function hhmmss(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export function hhmm(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Countdown "H:MM:SS" bzw. "M:SS", mit Vorzeichen bei Vergangenheit. */
export function dur(sec) {
  sec = Math.round(sec);
  const neg = sec < 0;
  sec = Math.abs(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const out = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return (neg ? '-' : '') + out;
}

/** Feste Breite "HH:MM:SS" (für große Timer). */
export function clock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function durLong(sec) {
  sec = Math.max(0, Math.round(sec));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (d) return `${d} T ${h} h`;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min ${s} s`;
  return `${s} s`;
}

const nf = new Intl.NumberFormat('de-DE');
export const num = (n) => nf.format(Math.round(n || 0));

export function short(n) {
  n = Math.round(n || 0);
  const neg = n < 0; n = Math.abs(n);
  let out;
  if (n >= 1e9) out = (n / 1e9).toFixed(2) + ' Mrd';
  else if (n >= 1e6) out = (n / 1e6).toFixed(2) + ' Mio';
  else if (n >= 1e4) out = (n / 1e3).toFixed(0) + ' k';
  else out = nf.format(n);
  return (neg ? '−' : '') + out;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Koordinaten-Chip "12·101·5" (Galaxie·System·Planet). */
export function coordChip(coord, extra = '') {
  if (!coord) return '';
  const [g, s, p] = String(coord).split(':');
  return `<span class="coord${extra ? ' ' + extra : ''}"><span class="g">${g}</span><span class="s">${s}</span><span class="p">${p}</span></span>`;
}
