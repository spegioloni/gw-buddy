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

1. Im Spiel beide Ansichten kopieren und zusammen einfügen:
   - **Übersichtsseite** (dein aktueller Planet) – liefert Serverzeit und
     aktuelle Flottenbewegungen. Zwei Formate werden akzeptiert: der
     **HTML-Quelltext** (`Strg`+`U`) oder der **reine Seitentext** (Seite
     markieren und kopieren). Der HTML-Quelltext ist die reichere Quelle — nur
     dort stecken Schiffe und Fracht je Flotte in den Tooltips, und die
     ausgegrauten, vorausberechneten Rückflüge werden nicht als zweite Flotte
     gezählt. Der Seitentext genügt für Missionen, Routen und Ankunftszeiten.
   - **Gesamtübersicht** (Menü „Punkte → Gesamtübersicht") – liefert alle
     eigenen Planeten mit Gebäuden, stationierten Schiffen, Verteidigung und
     Rohstoffen. Sie ist der Referenzbestand für die Gesamtzahl.
2. Die beiden Paste-Felder gehören zum **Lage**-Tab (dort einfügen — die
   Daten gelten für alle Tabs). `Strg`+`Enter` oder „⚡ Auswerten" klicken.
   Bis beide Ansichten vorhanden sind, zeigt das Dashboard keine Auswertung.
   Die Tabs **Farmstatistik** und **Farmradar** haben eigene Paste-Felder und
   funktionieren unabhängig davon.
3. Beide Ansichten bleiben zusammen im Browser gespeichert
   (im Browser via `localStorage`), bis du sie neu einfügst oder „Leeren"
   klickst. Deine eigenen Planeten merkt sich die Seite aus der
   Gesamtübersicht.
4. Countdowns laufen live gegen die Serverzeit weiter, die aus dem
   Snapshot-Zeitstempel der Übersichtsseite berechnet wird – auch wenn der
   eingefügte Stand schon ein paar Minuten alt ist.
5. „Beispiel laden" befüllt das Dashboard mit Demo-Daten, um die Ansicht
   ohne eigene Pastes auszuprobieren.

Alles bleibt ausschließlich lokal im Browser – nichts wird irgendwohin
hochgeladen. Einzige Ausnahme ist der **Farmradar**: Er ist optional und
schickt die Highscore-Listen bewusst an ein eigenes Supabase-Projekt, weil
Inaktivität nur aus einem Verlauf über mehrere Tage ablesbar ist.

## Die Tabs

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
- **Farmstatistik** – hat ein eigenes Paste-Feld für die Angriffsberichte.
  Sie verdichtet mehrere Berichte je Zielkoordinate auf den jüngsten Stand,
  sortiert Farmen nach den darin sichtbaren Rohstoffen und zeigt getrennt,
  welche Farmen heute noch keinen Bericht haben. Mit Supabase-Login kommt
  darunter das **Beute-Archiv** mit den Diagrammen — siehe unten.
- **Farmradar** – der einzige Tab mit Server-Anbindung (Supabase, optional).
  Er merkt sich die Highscore-Listen über Tage hinweg und leitet daraus
  inaktive Spieler ab. Siehe „Farmradar" weiter unten.

## Farmradar (Supabase)

Alle anderen Tabs sind reine Momentaufnahmen. Der Farmradar braucht dagegen
einen **Verlauf**: Wessen Gesamtpunkte sich seit Tagen nicht bewegen, spielt
nicht mehr — und wehrlose Planeten in Reichweite sind genau die Farmen, die
man sucht. Dafür liegt ein kleines Supabase-Projekt dahinter.

### Was hochgeladen wird

Zwei Ansichten aus *Community → Highscore*, jeweils komplett (mehrere Seiten
dürfen hintereinander in dasselbe Feld):

- Reiter **Spieler** – Name, Allianz, Planeten-/Forschungs-/Gesamtpunkte,
  Planetenzahl. Das ist die Inaktivitätsquelle.
- Reiter **Planeten** – Koordinate, Besitzer, Punkte. Das ist die Landkarte.

Der Tab erkennt selbst, welche der beiden Listen eingefügt wurde.

### Wie Inaktivität entsteht

Es wird **kein** kompletter Snapshot pro Tag gespeichert. Der Import
aktualisiert den aktuellen Stand und legt nur dann eine History-Zeile an,
wenn sich Punkte (bzw. bei Planeten der Besitzer) geändert haben. Das Feld
`points_unchanged_since` ist damit direkt der Zeitpunkt, seit dem sich nichts
mehr tut. „Inaktiv ab X Tagen" ist nichts weiter als ein Vergleich damit.
Die Datenbank bleibt dadurch winzig: ein täglicher Import von ~900 Spielern
und ~3.900 Planeten erzeugt nur ein paar Dutzend neue Zeilen.

Aus den Zielen in Reichweite entsteht eine Rangfolge:
`Planetenpunkte × Nähe × Dauer der Inaktivität`. Bezugspunkte sind die
eigenen Planeten aus der Gesamtübersicht — fehlt die, kann oben eine
Koordinate von Hand eingetragen werden.

### Supabase einrichten

1. Projekt auf [supabase.com](https://supabase.com) anlegen.
2. *SQL Editor* öffnen, den Inhalt von [`supabase/schema.sql`](supabase/schema.sql)
   einfügen und ausführen. Das legt Tabellen, Views, Import-Funktionen und
   Row Level Security in einem Rutsch an.
3. *Authentication → Providers → Email* aktivieren und unter
   *Authentication → Users* den eigenen Benutzer anlegen (E-Mail + Passwort).
   Ohne Login sieht niemand etwas: anonymen Zugriff entzieht das Schema
   ausdrücklich.
4. *Settings → API*: `Project URL` und `anon public key` kopieren. Für dieses
   Repo stehen beide schon als Voreinstellung in `src/sync/supabase.js` —
   der Farmradar zeigt direkt die Anmeldemaske. Über „Projekt wechseln"
   lassen sich andere Werte eintragen, die dann in `localStorage` liegen.
   Der anon-Key darf öffentlich sein: `anon` hat auf keine Tabelle, View
   oder Funktion Rechte, der Schutz liegt komplett in RLS.
5. Anmelden, Highscore-Listen einfügen, „↑ Nach Supabase übertragen".
   Ab dem zweiten Import an einem anderen Tag zeigt der Radar Ergebnisse.

`schema.sql` ist idempotent (`create table if not exists`, `create or replace`)
— nach einem Update der Datei einfach erneut komplett im SQL-Editor ausführen.
Bestehende Daten bleiben erhalten.

Geschrieben wird ausschließlich über die `security definer`-Funktionen
`ingest_players`, `ingest_planets`, `ingest_farm_reports` und `log_snapshot`;
die Tabellen selbst haben bewusst *keine* Insert-Policy. Ein gestohlener
anon-Key erlaubt damit weder Lesen noch Schreiben.

## Beute-Archiv (Supabase)

Im Tab **Farmstatistik**, sobald man im Farmradar angemeldet ist. Die
Angriffsberichte werden nicht nur ausgewertet, sondern dauerhaft
gespeichert — so entsteht über Wochen eine Farm-Historie.

**Neue Berichte erkennt das Archiv von selbst.** Ein Bericht ist eindeutig
über *Startplanet + Ziel + Angriffszeitpunkt*: von einem Planeten kann nicht
zweimal in derselben Sekunde dieselbe Farm getroffen werden. Doppelte
Berichte fallen serverseitig am Unique-Index ab, deshalb kann man dieselbe
Berichtsseite bedenkenlos mehrfach einfügen. Nach dem Übertragen steht da
z. B. „37 neue Berichte archiviert · 112 schon bekannt". Relative Zeitangaben
(„heute 11:34", „gestern 10:26") rechnet der Parser beim Einfügen in absolute
Zeitpunkte um — ein Bericht bekommt also beim zweiten Einfügen denselben
Zeitstempel wie beim ersten. Berichte, deren Zeitpunkt nicht erkannt wurde,
lässt der Import aus (sie ließen sich nicht zuverlässig entdoppeln); die
Anzahl steht als Hinweis über dem Knopf.

Ausgewertet wird das Archiv in drei Diagrammen:
- **Beute je Tag** – gestapelte Balken, umschaltbar zwischen *nach Rohstoff*
  (Eisen/Lutinum/Wasser/Wasserstoff) und *nach eigenem Planeten* (welche
  Kolonie hat wie viel eingeflogen). Tage ohne Beute bleiben als Lücke
  sichtbar, damit Farmpausen nicht kaschiert werden. Zeitfenster wählbar
  von 7 bis 365 Tagen.
- **Ertrag je Rohstoff** – die Gesamtsumme, aufgeteilt nach Rohstoff.
- **Ergiebigste Farmen** – Summe aller archivierten Angriffe je Ziel, mit
  der Anzahl der Angriffe.

Darüber vier Kennzahlen: Gesamtbeute, letzte 7 Tage, Schnitt je Farmtag und
bester Tag. Der Tageswechsel richtet sich nach Spielzeit (Europe/Berlin),
nicht nach UTC — sonst lägen Nachtangriffe im falschen Balken.

Gespeichert wird pro Bericht: Startplanet, Ziel, Spielername, Zeitpunkt und
die vier Rohstoffmengen. Die Gesamtsumme rechnet Postgres als generierte
Spalte, die Tages- und Ziel-Auswertung erledigen die Views `farm_loot_daily`
und `farm_loot_targets`.

**Der Farmatlas unten auf der Seite lebt ebenfalls vom Archiv**, sobald es
geladen ist. Vorher (oder ohne Login) bleibt der zuletzt eingefügte Bericht
die Quelle — das steht dann auch so im Untertitel. Der Unterschied ist
wesentlich:

- „Heute noch nicht angeflogen" listet jetzt *jede je gefarmte Koordinate*
  ohne Angriff von heute, nicht nur die, die zufällig im letzten
  Berichtsblatt standen. Je Zeile steht, wie lange die Farm schon offen ist.
- „Lohnendste Farmen" sortiert nach der **durchschnittlichen Beute je
  Angriff** über alle archivierten Anflüge statt nach dem letzten Zufall.
  Die reine Gesamtsumme steht weiter oben unter „Ergiebigste Farmen".

**Laufende Flotten zählen mit.** Wurde die Übersichtsseite eingefügt, prüft
der Atlas zusätzlich den Flugplan: Ziele, auf die gerade ein `Angriff` oder
`Zerstören` zufliegt — oder von denen eine Flotte zurückkommt, deren Bericht
also nur noch fehlt — wandern aus „Heute noch nicht angeflogen" in den
Unterabschnitt „Bereits unterwegs", mitsamt laufendem Countdown bis zum
Einschlag beziehungsweise zur Ankunft. Spionage zählt bewusst nicht: sie
erntet nichts und darf ein Ziel nicht von der offenen Liste nehmen. Flüge
zwischen eigenen Planeten werden ebenfalls ausgefiltert.

Auf schmalen Bildschirmen (≤ 820 px) wird aus der Desktop-Tabellen-Matrix eine
Kartenansicht pro Planet, und die Tab-Leiste wird zum Burger-Menü.

## Architektur

```
index.html        Grundgerüst (Topbar, Paste-Feld, #view, Drawer)
styles.css         Theme „Deep Orbit"
src/
  state.js         zentraler Zustand: Paste-Erkennung, Merge, Persistenz, Serverzeit
  analysis.js       Ableitungen: Bedrohungen, Online-/Save-Fenster, Rohstoff-Prognose & Beute, kritische Stellen, freie Kapazität, gemeinsame Zeitachse (für den Lage-Tab)
  radar.js          Farmradar: Entfernungen im Universum, Filter und Bewertung der Ziele
  farmstats.js      Beute-Archiv: Tagesachse, Stapel nach Rohstoff/Planet, Kennzahlen
  domain.js         kanonische Keys ↔ deutsche Bezeichnungen (Gebäude/Schiffe/Rohstoffe), Speicher-/Sockel-Mathematik
  demo.js           Beispieldaten für „Beispiel laden"
  data/
    production.js    Förderraten je Gebäudestufe (nur für Ausbau-Differenzen)
  parse/
    detect.js        erkennt Übersichtsseite, Gesamtübersicht, Highscore-Listen und Farmberichte
    farmberichte.js   parst Angriffsberichte und verdichtet Farmen je Ziel
    highscore.js      parst die Highscore-Reiter „Spieler" und „Planeten" (mehrseitig)
    uebersicht.js     parst Flotten, Bauaufträge, Rohstoffe des aktiven Planeten
    gesamt.js         parst die Planeten-Matrix (Gebäude/Schiffe/Verteidigung/Rohstoffe)
  sync/
    supabase.js       Login, Import per RPC, Abfrage der inaktiven Ziele und des Beute-Archivs (lädt supabase-js per CDN)
  util/
    format.js         Zahlen-/Dauer-Parsing, Zellen-Splitting
    time.js           Anzeige-Helfer (Uhrzeit, Countdown, Zahlenformat, Koordinaten-Chip)
  views/
    lage.js, bauen.js, flotten.js, farmen.js, farmradar.js, components.js
    charts.js         gestapelte Balken und Ranglisten als reines SVG (Beute-Archiv)
    timeline.js       Gantt-Renderer für die Zeitachse im Lage-Tab, inkl. Zoom und Fenster-Leiste
  app.js             Bootstrap: Tabs, Tick-Loop, Alarme, Drawer, Toasts
supabase/
  schema.sql         Tabellen, Views, Import-Funktionen und RLS für Farmradar und Beute-Archiv
test/
  parse.test.mjs      Parser-Regressionstest gegen echte Pastes
  state.test.mjs       State-/Analyse-Regressionstest
  radar.test.mjs       Highscore-Parser und Ziel-Bewertung
  farmstats.test.mjs   Beute-Aggregation, SVG-Diagramme und Berichts-Payload
  schema.test.mjs      spielt schema.sql in ein echtes Postgres (PGlite) und prüft die Importlogik
  serve.mjs            winziger statischer Server für die Playwright-Rauchtests
  fixtures/            echte Beispiel-Pastes (uebersicht.txt, gesamt.txt, highscore_*.txt)
```

Kein Build-Schritt, keine Dependencies zur Laufzeit – alles läuft als
natives ES-Modul im Browser. Einzige Ausnahme ist der optionale Farmradar:
er lädt `supabase-js` erst beim ersten Zugriff von einem ESM-CDN.

## Tests

Optional und nur für die Entwicklung — die Seite selbst braucht kein Node:

```
npm test
```

Prüft Parser, State/Analyse und Farmradar gegen die echten Fixture-Pastes
(`test/fixtures/`) sowie `supabase/schema.sql` gegen ein echtes Postgres
(PGlite, läuft als WASM in Node). Ohne installierte Dev-Dependencies
überspringt der Schema-Test sich selbst. Bei Änderungen an Parsern, am
Datenmodell oder am SQL vorher laufen lassen.

Für einen optischen Rauchtest:

```
node test/serve.mjs        # in einem zweiten Terminal
node shot-radar.mjs        # Farmradar
node shot-loot.mjs         # Beute-Archiv mit Diagrammen
```

## Alarm

Toast + Desktop-Benachrichtigung bei 10 min / 5 min / 60 s / 10 s vor dem
nächsten erfassten Feindeinschlag (kein Ton). Lässt sich oben rechts per
Schalter deaktivieren.
