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

- **Lage** – Cockpit-Ansicht und wichtigster Bildschirm:
  - Countdown bis zum nächsten Einschlag mit den dort stationierten Schiffen
    (Save-vs-Verteidigen-Entscheidung).
  - **Wann du online sein musst** – zusammenhängende Zeitbereiche statt
    Einzelzeiten: pro Einschlag 10 min Vorlauf, dicht aufeinanderfolgende
    Einschläge werden zu *einer* Session gebündelt. Je Fenster: Start–Ende,
    Dauer, Countdown, betroffene Planeten und die Pause davor.
  - **Zeitachse** – direkt eingebettet, mit den Online-Fenstern als Leiste
    unter der Achse (rot = Flotte steht im Feuer, gelb = Einschlag ohne
    stationierte Flotte); getönt ist nur das laufende bzw. nächste Fenster.
    Angegriffene Planeten stehen oben, ruhige gesammelt darunter.
  - **Kritische Stellen** – nach Schweregrad sortiert: Verlustrisiko
    (Schiffe stehen beim Einschlag da), plünderbare Rohstoffe beim Einschlag,
    eigene Landung kurz vor dem
    Einschlag, Rückflüge die zu spät kommen, zeitgleiche Einschläge.
  - Signal-Kacheln, bedrohte Planeten und freie Kapazität.

### Sind die Schiffe save? Sind die Rohstoffe save?

Das sind die zwei Fragen, die bei einem Angriff zählen, und genau die
beantwortet die Zeitachse aus der Kombination *beider* Pastes: die
Übersichtsseite liefert die Flugzeiten, die Gesamtübersicht die Bestände,
Förderraten und Speicherstufen.

- **⬟ Schiffe** – wie viele Schiffe zum Einschlagszeitpunkt auf dem Planeten
  stehen (stationiert plus alles, was vorher landet, minus alles, was vorher
  startet). `⬟–` heißt: leer, nichts zu verlieren.
- **◈ Beute** – wie viel ein Angreifer mitnehmen könnte. Pro Rohstoff gilt
  `Beute = max(0, Bestand − Sockel)`, mit `Sockel = 2 % der Speicherkapazität`
  und `Kapazität = 300.000 + 60.000 · Stufe²`. Die Kapazität wird direkt aus
  der Gesamtübersicht gelesen; die Formel ist nur der Rückfall.
  **Wasser bleibt bewusst außen vor** – das darf geplündert werden.
- Der Bestand wird auf den Einschlagszeitpunkt **hochgerechnet**: aus der
  gemessenen Förderrate, gedeckelt durch den Speicher. Fertig werdende
  Minenausbauten innerhalb des Prognosefensters erhöhen die Rate ab ihrer
  Fertigstellung – dafür dienen die Tabellen in `src/data/production.js`,
  und zwar ausschließlich als *Differenz* (Stufe n minus Stufe n−1), weil die
  reale Rate zusätzlich eine planetenabhängige Grundproduktion enthält.

Am Angriffsmarker steht das Urteil als `⬟◈` direkt dran, in der Planetenzeile
als Chip. Grün = save, rot = da ist was zu holen. Fehlt die Gesamtübersicht,
steht `◈?` statt einer erfundenen Zahl.
- **Bauen & Forschen** – laufende Bauaufträge mit Countdown, freie Kapazität
  (Planeten ohne Auftrag / mit leerer Schiffsfabrik), Forschungszentren, und
  aufklappbar die vollständige Gebäude-Matrix aller Planeten.
- **Flotten** – pro Planet gruppiert: was stationiert ist (Schiffe,
  Verteidigung) und was gerade dorthin bzw. von dort wegfliegt. Bedrohte
  Planeten stehen oben.
- **Zeitachse** – dieselbe Achse wie in der Lage, nur größer und filterbar:
  alle Ereignisse (Angriffe, Spionage, eigene Hin-/Rückflüge, Handel,
  Bau-/Forschungsabschlüsse) mit Marker je Typ, Typ-Filtern, umstellbarem
  Zeitfenster (3/6/12 h oder alles), der Online-Fenster-Leiste und einer
  chronologischen Liste darunter. Die Uhrzeit steht nur an Einschlägen am
  Marker, sonst im Tooltip; was rechts aus dem Zeitfenster fällt, wird je
  Planet als **+n▸** gezählt.

Auf schmalen Bildschirmen (≤ 820 px) wird aus der Desktop-Tabellen-Matrix eine
Kartenansicht pro Planet, und die Tab-Leiste wird zum Burger-Menü.

## Architektur

```
index.html        Grundgerüst (Topbar, Paste-Feld, #view, Drawer)
styles.css         Theme „Deep Orbit"
src/
  state.js         zentraler Zustand: Paste-Erkennung, Merge, Persistenz, Serverzeit
  analysis.js       Ableitungen: Bedrohungen, Online-/Save-Fenster, Rohstoff-Prognose & Beute, kritische Stellen, freie Kapazität, Zeitachse
  domain.js         kanonische Keys ↔ deutsche Bezeichnungen (Gebäude/Schiffe/Rohstoffe), Speicher-/Sockel-Mathematik
  demo.js           Beispieldaten für „Beispiel laden"
  data/
    production.js    Förderraten je Gebäudestufe (nur für Ausbau-Differenzen)
  parse/
    detect.js        erkennt Übersichtsseite vs. Gesamtübersicht
    uebersicht.js     parst Flotten, Bauaufträge, Rohstoffe des aktiven Planeten
    gesamt.js         parst die Planeten-Matrix (Gebäude/Schiffe/Verteidigung/Rohstoffe)
  util/
    format.js         Zahlen-/Dauer-Parsing, Zellen-Splitting
    time.js           Anzeige-Helfer (Uhrzeit, Countdown, Zahlenformat, Koordinaten-Chip)
  views/
    lage.js, bauen.js, flotten.js, zeitachse.js, components.js
    timeline.js       geteilter Gantt-Renderer (Lage + Zeitachse) inkl. Zoom und Fenster-Leiste
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
