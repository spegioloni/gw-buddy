# GigraWars · Flotten-Kommandozentrale

Nachfolger des alten `flotten_analysator.html` (liegt als `flotten_analysator.alt.html` daneben).

## Starten

**Mit Live-API (empfohlen)** – Doppelklick auf `START.cmd`, dann öffnet sich
<http://localhost:8787>. Voraussetzung: [Node.js](https://nodejs.org).

**Ohne API** – `flotten_analysator.html` einfach im Browser öffnen. Alles außer den
API-Funktionen (Planetennamen, Rohstoffe, Gebäude, Serverzeit-Sync) funktioniert.

> Die GigraWars-API sendet keine CORS-Header. Ein Browser darf sie deshalb von
> `file://` aus nicht direkt aufrufen – `gw-server.mjs` liefert die Seite aus und
> reicht `/gw/*` an `https://<uni>.gigrawars.de/api/*` weiter.

## Bedienung

1. Flottenansicht im Spiel markieren und kopieren – **inklusive** der Kopfzeile
   `Nachrichten HH:MM:SS - TT.MM.JJJJ`, daraus kommt der Snapshot-Zeitpunkt.
2. Oben einfügen, `Strg`+`Enter` (oder „Auswerten").
3. Die Countdowns laufen live gegen die echte Serverzeit weiter – auch wenn der
   eingefügte Stand schon ein paar Minuten alt ist.

## Was die Seite kann

- **Robuster Parser** – Sektionen, Aufträge, Koordinaten und Spielernamen in
  beliebiger Reihenfolge; eckige Klammern, Tabs und fehlende Zeilen sind egal.
  Start/Ziel werden anhand der eigenen Planeten aus der API korrekt zugeordnet.
- **Live-Dashboard** – nächster Einschlag, bedrohte Planeten, offene Save-Aktionen,
  eigene Flotten unterwegs, Rohstoffe im Feuer.
- **Master-Zeitachse & Online-Plan** – alle Planeten auf einer gemeinsamen Achse
  plus daraus abgeleitete Online-Blöcke: „von wann bis wann muss ich am Rechner
  sein und was ist dann zu tun" (Pflicht / wichtig / optional, kopierbar).
- **Save-Fenster je Planet** – für jede eigene Landung die Lücke bis zum nächsten
  Feindeinschlag inklusive Deadline; verspätete Rückflüge werden markiert.
- **Zeitachse** – alle Ereignisse eines Planeten mit „Jetzt"-Marker und grün
  hinterlegten Save-Fenstern.
- **Rohstoff-Prognose** – Bestand zum Zeitpunkt des Einschlags, hochgerechnet aus
  Produktion und Lagerkapazität, plus geschätzter plünderbarer Anteil.
- **Alarm** – Toast + Desktop-Benachrichtigung bei 10 min / 5 min / 60 s / 10 s (kein Ton).
- **Export** – Zusammenfassung in die Zwischenablage oder Lage als JSON.

## API-Token

Der Token steht in `gw-token.txt` (eine Zeile, `#` = Kommentar). Alternativ:

```
node gw-server.mjs --token uni5-xxxx --port 8787
```

oder direkt in der Oberfläche unter „GigraWars API → Einstellungen" eintragen
(wird dann nur im Browser gespeichert).

Neuen Token erstellen: **Einstellungen → Account → Externe Anwendungen**.
Benötigte Berechtigungen: *Account-Daten*.

Genutzte Endpunkte: `accounts/me`, `accounts/me/planets`, `accounts/me/battle-balance`
(letzterer liefert über `createdAt` die exakte Serverzeit).

## Dateien

| Datei | Zweck |
|---|---|
| `flotten_analysator.html` | die komplette App (eine Datei, kein Build) |
| `gw-server.mjs` | lokaler Webserver + API-Brücke |
| `START.cmd` | Server starten und Browser öffnen |
| `gw-token.txt` | API-Token |
| `flotten_analysator.alt.html` | alte Version als Backup |
