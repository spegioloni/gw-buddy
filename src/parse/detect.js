// Auto-Erkennung des Paste-Typs.
import { looksLikeGesamt } from './gesamt.js';
import { parseFarmReports } from './farmberichte.js';
import { looksLikePlayerHighscore, looksLikePlanetHighscore } from './highscore.js';

/** 'gesamt' | 'uebersicht' | 'highscore_spieler' | 'highscore_planeten' | 'html' | 'farmberichte' | 'unknown' */
export function detectType(text) {
  // Highscore zuerst: die Listen tragen dieselbe Navigationsleiste wie die
  // Übersichtsseite und würden sonst als solche durchgehen.
  if (looksLikePlayerHighscore(text)) return 'highscore_spieler';
  if (looksLikePlanetHighscore(text)) return 'highscore_planeten';
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
