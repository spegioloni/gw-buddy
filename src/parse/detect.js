// Auto-Erkennung des Paste-Typs.
import { looksLikeGesamt } from './gesamt.js';
import { parseFarmReports } from './farmberichte.js';

/** 'gesamt' | 'uebersicht' | 'unknown' */
export function detectType(text) {
  if (/<html[\s>]|globalServerTime|fleet-table-tr/i.test(text)) return 'html';
  if (looksLikeGesamt(text)) return 'gesamt';
  if (parseFarmReports(text).length) return 'farmberichte';
  // Übersichtsseite: Flotten-/Nachrichten-Block oder Gebäudeaufträge.
  if (/nachrichten/i.test(text) || /Flotten\s*\(\d+\)/i.test(text) ||
      /Gebäudeaufträge/i.test(text) || /feindliche Flotten/i.test(text)) {
    return 'uebersicht';
  }
  return 'unknown';
}
