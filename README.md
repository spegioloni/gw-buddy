# GigraWars · Orbitkommando

Ein statisches Kommando-Dashboard für GigraWars (`index.html`, kein Build,
reine ES-Module) – ideal für GitHub Pages. Keine API, kein Login: Du fügst
Ansichten aus dem Spiel per Copy & Paste ein, der Rest passiert lokal im
Browser.

## Starten

Die Seite ist rein statisch: `index.html` + `styles.css` + `src/` (native
ES-Module). Kein Build, kein Server, keine Laufzeit-Dependencies.

Auf **GitHub Pages** (oder jedem anderen Webhosting) einfach die Adresse
aufrufen — fertig.

> Ein Doppelklick auf `index.html` im Explorer funktioniert **nicht**: Browser
> blockieren ES-Module über `file://` per CORS. Die Seite zeigt in dem Fall
> einen entsprechenden Hinweis an.

## GitHub Pages einrichten

Repo → *Settings* → *Pages* → *Source: Deploy from a branch* → Branch `main`,
Ordner `/ (root)`. Die Datei `.nojekyll` im Root sorgt dafür, dass Pages den
Inhalt unverändert ausliefert.

## Bedienung

1. Im Spiel eine der beiden Ansichten markieren und kopieren:
   - **Übersichtsseite** (dein aktueller Planet) – liefert Serverzeit,
     Flottenbewegungen, Bauaufträge, Rohstoffe des aktiven Planeten.
   - **Gesamtübersicht** (Menü „Punkte → Gesamtübersicht") – liefert alle
     eigenen Planeten mit Gebäuden, Schiffen, Verteidigung und Rohstoffen.
2. Text oben ins Feld einfügen, `Strg`+`Enter` oder „⚡ Auswerten" klicken.
   Der Typ wird automatisch erkannt – du musst nichts umschalten.
3. Beide Ansichten ergänzen sich: einmal eingefügt, bleiben sie erhalten
   (im Browser via `localStorage`), bis du sie neu einfügst oder „Leeren"
   klickst. Deine eigenen Planeten merkt sich die Seite aus der
   Gesamtübersicht.
4. Countdowns laufen live gegen die Serverzeit weiter, die aus dem
   Snapshot-Zeitstempel der Übersichtsseite berechnet wird – auch wenn der
   eingefügte Stand schon ein paar Minuten alt ist.
5. „Beispiel laden" befüllt das Dashboard mit Demo-Daten, um die Ansicht
   ohne eigene Pastes auszuprobieren.

Alles bleibt ausschließlich lokal im Browser – nichts wird irgendwohin
hochgeladen.

## Die vier Tabs

- **Lage** – Cockpit-Ansicht: Countdown bis zum nächsten Einschlag, welche
  Schiffe/Verteidigung dort gerade stehen (Save-vs-Verteidigen-Entscheidung),
  Signal-Kacheln (bedrohte Planeten, Flotten unterwegs, nächster Bau,
  freie Kapazität) sowie die Liste bedrohter Planeten mit Save-Fenstern.
- **Bauen & Forschen** – laufende Bauaufträge mit Countdown, freie Kapazität
  (Planeten ohne Auftrag / mit leerer Schiffsfabrik), Forschungszentren, und
  aufklappbar die vollständige Gebäude-Matrix aller Planeten.
- **Flotten** – pro Planet gruppiert: was stationiert ist (Schiffe,
  Verteidigung) und was gerade dorthin bzw. von dort wegfliegt. Bedrohte
  Planeten stehen oben.
- **Zeitachse** – eine gemeinsame Achse aller Ereignisse (Angriffe,
  Spionage, eigene Hin-/Rückflüge, Handel, Bau-/Forschungsabschlüsse) mit
  Marker je Typ, Typ-Filtern und einer chronologischen Liste darunter.

Auf schmalen Bildschirmen (≤ 820 px) wird aus der Desktop-Tabellen-Matrix eine
Kartenansicht pro Planet, und die Tab-Leiste wird zum Burger-Menü.

## Architektur

```
index.html        Grundgerüst (Topbar, Paste-Feld, #view, Drawer)
styles.css         Theme „Deep Orbit"
src/
  state.js         zentraler Zustand: Paste-Erkennung, Merge, Persistenz, Serverzeit
  analysis.js       Ableitungen: Bedrohungen, Save-Fenster, freie Kapazität, Zeitachse
  domain.js         kanonische Keys ↔ deutsche Bezeichnungen (Gebäude/Schiffe/Rohstoffe)
  demo.js           Beispieldaten für „Beispiel laden"
  parse/
    detect.js        erkennt Übersichtsseite vs. Gesamtübersicht
    uebersicht.js     parst Flotten, Bauaufträge, Rohstoffe des aktiven Planeten
    gesamt.js         parst die Planeten-Matrix (Gebäude/Schiffe/Verteidigung/Rohstoffe)
  util/
    format.js         Zahlen-/Dauer-Parsing, Zellen-Splitting
    time.js           Anzeige-Helfer (Uhrzeit, Countdown, Zahlenformat, Koordinaten-Chip)
  views/
    lage.js, bauen.js, flotten.js, zeitachse.js, components.js
  app.js             Bootstrap: Tabs, Tick-Loop, Alarme, Drawer, Toasts
test/
  parse.test.mjs      Parser-Regressionstest gegen echte Pastes
  state.test.mjs       State-/Analyse-Regressionstest
  fixtures/            echte Beispiel-Pastes (uebersicht.txt, gesamt.txt)
```

Kein Build-Schritt, keine Dependencies zur Laufzeit – alles läuft als
natives ES-Modul im Browser.

## Tests

Optional und nur für die Entwicklung — die Seite selbst braucht kein Node:

```
node test/parse.test.mjs && node test/state.test.mjs
```

Prüft Parser und State/Analyse gegen die echten Fixture-Pastes
(`test/fixtures/`). Bei Änderungen an Parsern oder am Datenmodell vorher
laufen lassen.

## Alarm

Toast + Desktop-Benachrichtigung bei 10 min / 5 min / 60 s / 10 s vor dem
nächsten erfassten Feindeinschlag (kein Ton). Lässt sich oben rechts per
Schalter deaktivieren.
