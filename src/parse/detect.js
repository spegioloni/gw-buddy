// Auto-Erkennung des Paste-Typs.
import { looksLikeGesamt } from './gesamt.js';

/** 'gesamt' | 'uebersicht' | 'unknown' */
export function detectType(text) {
  if (looksLikeGesamt(text)) return 'gesamt';
  // Übersichtsseite: Flotten-/Nachrichten-Block oder Gebäudeaufträge.
  if (/nachrichten/i.test(text) || /Flotten\s*\(\d+\)/i.test(text) ||
      /Gebäudeaufträge/i.test(text) || /feindliche Flotten/i.test(text)) {
    return 'uebersicht';
  }
  return 'unknown';
}
