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
- **Farmliste** – die aktiv verwaltete Farmrunde je eigenem Planeten: was
  gerade beflogen wird, was es je Tag einbringt und welcher Platz getauscht
  gehört. Siehe „Farmliste" weiter unten.

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
mehr tut. „Inaktiv ab X Stunden" ist nichts weiter als ein Vergleich damit.
Die Datenbank bleibt dadurch winzig: ein täglicher Import von ~900 Spielern
und ~3.900 Planeten erzeugt nur ein paar Dutzend neue Zeilen.

Die View `inactive_farms` liefert die Inaktivität sowohl in ganzen Tagen
(`player_idle_days`) als auch **stundengenau** (`player_idle_hours`). Der
Radar filtert über die Stunden: Zwei Importe im Abstand von 21 Stunden
ergeben in Tagen noch 0 — die Schwelle „Inaktiv ab" lässt sich deshalb bis
auf 1 Stunde herunterziehen, um direkt nach dem zweiten Import zu prüfen, ob
die Kette überhaupt funktioniert. Für den Ernstfall bleiben ein bis mehrere
Tage sinnvoll, weil kurze Pausen noch keine Inaktivität sind.

Aus den Zielen in Reichweite entsteht eine Rangfolge:
`Planetenpunkte × Nähe × Dauer der Inaktivität`. Bezugspunkt sind
standardmäßig **alle** eigenen Planeten aus der Gesamtübersicht; im Dropdown
„Bezugspunkt" lässt sich stattdessen ein einzelner eigener Planet wählen, um
den Radar auf dessen Umgebung einzugrenzen. Fehlt die Gesamtübersicht,
erscheint an derselben Stelle ein Eingabefeld für eine Koordinate.

Eigene Planeten sind nie Ziele: ausgeschlossen werden die Koordinaten aus der
Gesamtübersicht **und** alles, was demselben Spieler gehört — sonst tauchen
Kolonien auf, die noch nicht in der Übersicht standen.

Jedes Ziel trägt ein Abzeichen aus dem Beute-Archiv: entweder **neu** (noch nie
in einem Kampfbericht aufgetaucht) oder die bisherige Bilanz —
`4× angegriffen · Ø 45.000 je Flug · vor 2 T`. Ziele, die heute schon dran
waren, sind farblich abgesetzt. Zwei Schalter räumen die Liste auf:

- **nur nie angegriffene** — blendet alles aus, was schon im Archiv steht, und
  zeigt damit ausschließlich wirklich neue Ziele.
- **heute noch nicht angeflogen** — blendet nur die Ziele der heutigen Runde
  aus; die Grenze ist die lokale Mitternacht, wie in der Farmstatistik.

Beide filtern rein lokal, also ohne neue Abfrage. Wie viele Ziele sie
verschlucken, steht in der Kachel „Ziele in Reichweite".

### Auswahl in die Farmliste

Unter den Filtern steht **Auswahl in die Farmliste**. Jedes Ziel in „Beste
Ziele" ist eine Karte mit einem Haken oben links; alles, was angehakt ist, wird
übernommen. Voreingestellt ist alles ausgewählt — abwählen ist die Ausnahme.
Drei Schnellwege gibt es dazu: *Alle auswählen*, *Keine* und *nur neue* (nur
Ziele ohne Eintrag im Beute-Archiv). Einzeln geht es auch: der Knopf
**→ zur Farmliste** an der Karte nimmt genau dieses Ziel auf — auf den
Bezugspunkt, sonst auf den nächstgelegenen eigenen Planeten.

Ziele, die bereits einen Platz belegen — egal auf welchem Planeten —, tragen
das Abzeichen **◆ auf der Farmliste** samt Startplanet, sind farblich
abgesetzt und lassen sich nicht doppelt aufnehmen; auch die Sammelübernahme
überspringt sie. Früher abgelegte Ziele werden mit **↺ früher abgelegt**
gekennzeichnet, bleiben aber aufnehmbar. Die Kachel „Schon auf einer Liste"
zählt beides zusammen. Standardmäßig zeigt der Radar die besten 40
Ziele; „alle N Ziele zeigen" klappt den Rest auf, falls tiefer unten noch
etwas abgewählt werden soll.

**→ N Farmen übernehmen** schreibt die Auswahl in die verwaltete Runde (siehe
unten). Ohne einzelnen Bezugspunkt wird jedes Ziel dem nächstgelegenen
eigenen Planeten zugeordnet. Heruntergeladen wird nicht hier, sondern im Tab
**Farmliste** — der Radar sucht Ziele, die Farmliste entscheidet, welche
davon die Runde wirklich wert sind.

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
   Ab dem zweiten Import zeigt der Radar Ergebnisse — mit einer kleinen
   Schwelle (z. B. 1 h) schon wenige Stunden nach dem ersten Import.

`schema.sql` ist idempotent (`create table if not exists`, `create or replace`)
— nach einem Update der Datei einfach erneut komplett im SQL-Editor ausführen.
Bestehende Daten bleiben erhalten. Die **Views** werden dabei vorher verworfen
(`drop view if exists`) und neu angelegt: `create or replace view` kann Spalten
nur hinten anhängen, nicht umbenennen oder umsortieren, und scheitert sonst mit
`ERROR 42P16: cannot change name of view column`. Views halten keine Daten, das
Verwerfen ist gefahrlos.

Geschrieben wird ausschließlich über die `security definer`-Funktionen
`ingest_players`, `ingest_planets`, `ingest_farm_reports`, `log_snapshot`
sowie die Farmlisten-Funktionen `roster_add`, `roster_remove`,
`roster_forget` und `roster_set_slots`; die Tabellen selbst haben bewusst
*keine* Insert-Policy. Ein gestohlener anon-Key erlaubt damit weder Lesen
noch Schreiben.

## Farmliste (Supabase)

Der Radar findet Ziele, die Farmliste verwaltet sie. Hintergrund: Die
Transporter eines Planeten reichen nur für eine feste Zahl an Zielen pro
Runde. Wer schlecht besetzte Plätze mitschleppt, verschenkt genau diese
Kapazität.

Je eigenem Planeten hält der Tab fest:

- **Farmplätze** – wie viele Ziele die Flotte von hier aus schafft. Die Zahl
  liegt in Supabase (`farm_slots`), gilt also auf allen Geräten.
- **Belegte Plätze** – die aktiven Ziele, sortiert nach *Ertrag je Flug*: was
  ein einzelner Anflug typischerweise bringt. Gezählt werden die Angriffe von
  genau diesem Planeten aus (aus dem Beute-Archiv); fehlen die noch, zählt
  der Schnitt aus dem Archiv, damit ein frisch aufgenommenes Topziel nicht
  grundlos ganz unten steht. Der *Ertrag je Tag* — Beute seit der Aufnahme,
  geteilt durch die Tage in der Liste — bleibt der Maßstab für „schwach" und
  steht in der Kontextzeile der Karte.
- **Nachrücker** – Radar-Kandidaten für diesen Planeten, die noch nie auf der
  Liste standen. Es werden so viele vorgeschlagen, wie Plätze frei oder
  schwach belegt sind.

Jeder Platz bekommt ein Urteil:

| Zustand | Bedeutung |
| --- | --- |
| **trägt** | über dem Median der Liste — bleibt |
| **neu** | keine drei Tage dabei, wird noch nicht bewertet |
| **kalt** | seit über vier Tagen nicht mehr angeflogen |
| **schwach** | unter 40 % des Median-Tagesertrags |
| **nie geflogen** | seit über drei Tagen auf der Liste, nie ein Bericht |
| **wieder aktiv** | der Besitzer spielt wieder — sofort raus |

„wieder aktiv" richtet sich nach **deiner** Radar-Schwelle („Inaktiv ab"): Wer
laut Filter inaktiv genug ist, um überhaupt vorgeschlagen zu werden, gilt hier
nicht als aufgewacht. Steht der Regler auf 6 h, ist ein Spieler erst unterhalb
von 6 h wach; ohne Radareinstellung bleibt es bei 24 h.

Zusätzlich braucht „wieder aktiv" eine *belegte* Punkteänderung. Nach dem
allerersten Import steht die Inaktivitätsuhr jedes Spielers auf null, weil
vorher niemand hingesehen hat — das ist Unwissen, kein Aufwachen. Bis zum
zweiten Import steht in den Karten deshalb „21 h **beobachtet**" statt
„inaktiv", und der Radar weist oben darauf hin.

„schwach", „nie geflogen" und „wieder aktiv" gelten als Tauschkandidaten; mit
*n schwache entfernen* fliegen sie in einem Rutsch von der Liste. Abgelegte
Ziele bleiben mit Grund und Datum im Archiv stehen — sie werden nicht erneut
als Nachrücker vorgeschlagen, lassen sich aber jederzeit zurückholen. Beim
Zurückholen beginnt die Ertragsrechnung von vorn, damit die alte Flaute nicht
mitzählt.

**⬇ Farmen exportieren** liefert die JSON-Datei für den Farmbot — nur die
aktiven Ziele dieses Planeten, sortiert nach Ertrag je Flug, bei Gleichstand
nach Tagesertrag und dann das nähere Ziel zuerst:

```json
[["12:68:5","Manor"],["12:68:7","Necrom"],["12:69:6","loto22"]]
```

Also ein Array aus `[Koordinate, Spielername]`. Der Dateiname enthält Planet
und Tagesdatum: `Farmen-12_101_5-18-08-2026.json`. Der Export ist damit immer
genau die Liste, die hier oben steht — exportiert wird je Planet, nicht
global.

### Was auf einer Karte steht

Jede Farm ist eine Karte, damit sich „lohnt sich der Platz?" ohne Rechnen
beantworten lässt. Groß oben rechts steht der **Ø je Flug** — die Zahl, an der
sich entscheidet, ob das Ziel seinen Schiffsraum wert ist. Darunter der
Zustand. Der Zahlenblock zeigt:

| Kennzahl | Wofür sie gut ist |
| --- | --- |
| **bester Flug** | wie viel im Ziel maximal liegen kann |
| **letzter Flug** | plus Vergleich zum eigenen Schnitt in Prozent |
| **Beute gesamt** | die Summe seit der Aufnahme |
| **Flüge** | Zahl der Berichte seit der Aufnahme |
| **zuletzt** | wie lange der letzte Anflug her ist |
| **Entfernung** | Systemabstand vom Startplaneten |

Die sechs Felder stehen immer an derselben Stelle — nur so lassen sich Karten
nebeneinander vergleichen. Wurde seit der Aufnahme noch nicht geflogen, füllen
sich dieselben Felder blass aus dem Beute-Archiv (Flüge von früher oder von
anderen Planeten); fehlt auch das, stehen dort Striche und die Karte sagt es.
Planetenpunkte, Spielergröße und der Tagesertrag stehen in der Kontextzeile
darüber.

Fällt der letzte Flug unter 60 % des eigenen Schnitts, erscheint ein ▼ —die Lager sind abgeerntet. Über 125 % gibt es ein ▲. Der schmale Balken
darunter zeigt, woraus die Beute besteht (Eisen, Lutinum, Wasser,
Wasserstoff) — nützlich, wenn gerade ein bestimmter Rohstoff fehlt. Die
Kontextzeile nennt Planetenpunkte, Spielerpunkte, Inaktivität, den Ertrag
je Tag seit der Aufnahme und — falls das Ziel schon vorher oder von anderen
Planeten beflogen wurde — die Gesamtzahl aller Flüge samt Schnitt.

Nachrücker im Tab **Farmliste** und die Ziele im **Farmradar** benutzen genau
dieselbe Karte: gleicher Aufbau, gleiche sechs Felder, gleicher Ø je Flug oben
rechts — ein Kandidat und ein belegter Platz sind so Zahl für Zahl
vergleichbar. Statt „entfernen" steht dort der Knopf **→ zur Farmliste**
(bzw. *aufnehmen*), der das Ziel einzeln auf die Liste des Startplaneten setzt.

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
  radar.js          Farmradar: Entfernungen im Universum, Filter, Bewertung der Ziele und Aufbau der Export-Liste
  farmroster.js     Farmliste: Bewertung der belegten Plätze, Tauschvorschläge, Flugreihenfolge
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
    supabase.js       Login, Import per RPC, Abfrage der inaktiven Ziele, des Beute-Archivs und der Farmlisten (lädt supabase-js per CDN)
  util/
    format.js         Zahlen-/Dauer-Parsing, Zellen-Splitting
    time.js           Anzeige-Helfer (Uhrzeit, Countdown, Zahlenformat, Koordinaten-Chip)
  views/
    lage.js, bauen.js, flotten.js, farmen.js, farmradar.js, farmliste.js, components.js
    charts.js         gestapelte Balken und Ranglisten als reines SVG (Beute-Archiv)
    timeline.js       Gantt-Renderer für die Zeitachse im Lage-Tab, inkl. Zoom und Fenster-Leiste
  app.js             Bootstrap: Tabs, Tick-Loop, Alarme, Drawer, Toasts
supabase/
  schema.sql         Tabellen, Views, Import-/Farmlisten-Funktionen und RLS für Farmradar, Beute-Archiv und Farmliste
test/
  parse.test.mjs      Parser-Regressionstest gegen echte Pastes
  state.test.mjs       State-/Analyse-Regressionstest
  radar.test.mjs       Highscore-Parser und Ziel-Bewertung
  farmstats.test.mjs   Beute-Aggregation, SVG-Diagramme und Berichts-Payload
  farmroster.test.mjs  Bewertung der Farmliste, Tauschvorschläge und Flugreihenfolge
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
