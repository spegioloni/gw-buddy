"""Regressionstests fuer browser_multi_copy.

Testet genau die Fehler, die real aufgetreten sind:
1. Der Konsolentext "URL: https://..." darf NIE als gueltige Adresszeile
   akzeptiert werden (sonst wird Enter gedrueckt und eine Suche ausgeloest).
2. Eine echte Suchergebnisseite (die real gespeicherte Datei von 11:09 Uhr)
   muss als solche erkannt und verworfen werden.
3. Die SendInput-Strukturen muessen die vom Windows-API erwartete Groesse
   haben, sonst schlaegt das Tippen der URL fehl.
"""

import ctypes
import sys

import browser_multi_copy as m

failures = []


def check(name, condition):
    print(f"{'OK  ' if condition else 'FAIL'}  {name}")
    if not condition:
        failures.append(name)


URL = "https://uni5.gigrawars.de/app/12:101:5/highscore/player?sort=allPoints&page=1"

# 1) Der reale Fehlerfall: Konsolenzeile darf nicht als URL durchgehen.
check(
    "Konsolentext 'URL: ...' wird als falsche Adresszeile erkannt",
    m.normalize_url("URL: " + URL) != m.normalize_url(URL),
)

# Gueltige Varianten muessen weiterhin akzeptiert werden.
check("identische URL wird akzeptiert", m.normalize_url(URL) == m.normalize_url(URL))
check(
    "URL mit Leerzeichen/End-Slash wird akzeptiert",
    m.normalize_url("  " + URL + "/  ") == m.normalize_url(URL),
)
check(
    "URL ohne Schema wird akzeptiert",
    m.normalize_url(URL.replace("https://", "")) == m.normalize_url(URL),
)

# 2) Erkennung der real aufgetretenen Suchergebnisseite (Datei von 11:09 Uhr).
import os

BAD_CAPTURE = "browser_copies_20260817_110905.txt"
if os.path.exists(BAD_CAPTURE):
    with open(BAD_CAPTURE, encoding="utf-8") as handle:
        real_bad_capture = handle.read()
    check(
        f"reale Fehlkopie ({BAD_CAPTURE}) wird als Suchseite verworfen",
        m.looks_like_search_page(real_bad_capture),
    )
else:
    print(f"SKIP  {BAD_CAPTURE} nicht vorhanden")

GOOD_CAPTURE = "browser_copies_20260817_111950.txt"
if os.path.exists(GOOD_CAPTURE):
    with open(GOOD_CAPTURE, encoding="utf-8") as handle:
        real_good_capture = handle.read()
    check(
        f"echte Highscore-Seite ({GOOD_CAPTURE}) wird NICHT verworfen",
        not m.looks_like_search_page(real_good_capture),
    )

check(
    "normale Seiteninhalte werden NICHT verworfen",
    not m.looks_like_search_page("Platz\tSpieler\tPunkte\n1\tFoo\t123456"),
)

# 3) URL-Vorlage aus den fest eingetragenen Basis-URLs
template = m.build_url_template(m.BASE_URL_PLAYERS)
check(
    "Seitenzahl wird korrekt eingesetzt",
    template.format(page=7).endswith("sort=allPoints&page=7"),
)
check(
    "Planeten-Vorlage bekommt eigene Seitenzahl",
    m.build_url_template(m.BASE_URL_PLANETS).format(page=3).endswith("planet?page=3"),
)
check(
    "beide BASE_URLs zeigen auf gigrawars-Highscore",
    all(
        "uni5.gigrawars.de" in u and "highscore" in u
        for u in (m.BASE_URL_PLAYERS, m.BASE_URL_PLANETS)
    ),
)

# 3b) Bezier-Verteilung: Grenzen 0..1 muessen eingehalten werden.
bezier_values = [m.bezier_random() for _ in range(5000)]
check(
    "Bezier-Zufallswerte bleiben in den Grenzen 0..1",
    all(0.0 <= v <= 1.0 for v in bezier_values),
)
check(
    "Bezier-Zufall liefert unterschiedliche Werte",
    len(set(round(v, 6) for v in bezier_values)) > 100,
)

# 3c) Beide Durchlaeufe sind konfiguriert und schreiben getrennte Dateien.
check("zwei Durchlaeufe konfiguriert", len(m.JOBS) == 2)
check("erst Spieler, dann Planeten", [j["key"] for j in m.JOBS] == ["players", "planets"])
check(
    "getrennte Dateinamen je Durchlauf",
    len({j["file_prefix"] for j in m.JOBS}) == 2,
)

# 4) Zeilenumbrueche: der reale Bug mit doppeltem Zeilenabstand
clipboard_text = "GigraWars\r\nEisen\r\n490.476\r\n\r\nPlanet \r\n1\tcapy\t87.971"

# Reproduktion des alten Fehlers: \r\n schreiben ohne Normalisierung
import os
import tempfile

tmp_dir = tempfile.mkdtemp()
buggy = os.path.join(tmp_dir, "buggy.txt")
with open(buggy, "w", encoding="utf-8") as handle:
    handle.write(clipboard_text)
with open(buggy, encoding="utf-8") as handle:
    buggy_result = handle.read()
check(
    "alter Fehler ist reproduzierbar (doppelte Zeilenumbrueche)",
    "\n\n" in buggy_result.replace("\n\n\n", ""),
)

fixed = os.path.join(tmp_dir, "fixed.txt")
with open(fixed, "w", encoding="utf-8", newline="") as handle:
    handle.write(m.normalize_newlines(clipboard_text).replace("\n", "\r\n"))
with open(fixed, encoding="utf-8") as handle:
    fixed_result = handle.read()

check(
    "nach dem Fix: keine Leerzeile zwischen den Zeilen",
    fixed_result.startswith("GigraWars\nEisen\n490.476\n\nPlanet \n1\tcapy\t87.971"),
)
check(
    "Tabulatoren der Tabelle bleiben erhalten",
    "1\tcapy\t87.971" in fixed_result,
)
check(
    "gewollte Leerzeilen bleiben erhalten",
    "490.476\n\nPlanet" in fixed_result,
)

# 4b) Speicherlogik end-to-end: roh, ohne Trennzeilen
page1 = "GigraWars\r\nEisen\r\n490.476\r\n1\tcapy\t87.971"
page2 = "GigraWars\r\nEisen\r\n490.500\r\n101\tfoo\t41.000"
combined = os.path.join(tmp_dir, "combined.txt")
with open(combined, "w", encoding="utf-8", newline="") as handle:
    for content in (page1, page2):
        text = m.normalize_newlines(content)
        if not text.endswith("\n"):
            text += "\n"
        handle.write(text.replace("\n", "\r\n"))
with open(combined, encoding="utf-8") as handle:
    combined_result = handle.read()

check(
    "keine erfundenen Trennzeilen wie '===== Seite'",
    "=====" not in combined_result and "Seite 1" not in combined_result,
)
check(
    "Seiten stehen roh untereinander",
    combined_result
    == "GigraWars\nEisen\n490.476\n1\tcapy\t87.971\n"
    "GigraWars\nEisen\n490.500\n101\tfoo\t41.000\n",
)

# 5) SendInput-Strukturgroessen (sonst tippt Windows nichts).
expected = 40 if ctypes.sizeof(ctypes.c_void_p) == 8 else 28
check(
    f"INPUT-Struktur hat korrekte Groesse ({ctypes.sizeof(m.INPUT)} == {expected})",
    ctypes.sizeof(m.INPUT) == expected,
)
check("KEYBDINPUT passt in die Union", ctypes.sizeof(m.KEYBDINPUT) <= ctypes.sizeof(m.INPUT))

# 6) Supabase-Upload: Parser und Versandlogik (ohne Netzwerk).
import gw_supabase as sb

PLAYER_SAMPLE = (
    "Rang\tName\tPlanetenpunkte\tForschungspunkte\tGesamtpunkte\tPlaneten\n"
    "1\tcapy [Fox-Wing]\t87.971\t18.987\t106.958\t10\n"
    "2\tvossibaer\t80.000\t10.000\t90.000\t9\n"
    "2\tvossibaer\t80.000\t10.000\t90.000\t9\n"
)
players = sb.parse_player_highscore(PLAYER_SAMPLE)
check("Spielerzeilen werden erkannt", len(players) == 2)
check(
    "Allianz wird aus dem Namen geloest",
    players[0]["name"] == "capy" and players[0]["alliance"] == "Fox-Wing",
)
check("deutsche Zahlen werden umgerechnet", players[0]["total"] == 106958)
check("Spieler ohne Allianz bekommt None", players[1]["alliance"] is None)

PLANET_SAMPLE = (
    "Rang\tKoordinate\tBesitzer\tPunkte\n"
    "1\t10:103:7\tPubsmaus\t10.019\n"
    "2\t10:73:8\tcapy\t9.648\n"
)
planets = sb.parse_planet_highscore(PLANET_SAMPLE)
check("Planetenzeilen werden erkannt", len(planets) == 2)
check(
    "Koordinate wird zerlegt",
    (planets[0]["galaxy"], planets[0]["system"], planets[0]["position"]) == (10, 103, 7),
)

# Kopfzeilen und Menuetext duerfen nie als Datenzeile durchgehen.
check(
    "Kopf- und Menuezeilen werden ignoriert",
    sb.parse_planet_highscore("Koordinate\tBesitzer\tPunkte\nCommunity\nHighscore\n") == [],
)


class FakeSession:
    """Ersetzt die HTTP-Schicht, damit der Versand ohne Netz testbar ist."""

    def __init__(self):
        self.calls = []

    def rpc(self, function_name, params):
        self.calls.append((function_name, params))
        if function_name == "log_snapshot":
            return 1
        return {"rows": len(params["rows"]), "changed": len(params["rows"])}


fake = FakeSession()
result = sb.upload(fake, "players", PLAYER_SAMPLE)
check("Upload meldet die gesendeten Zeilen", result["rows"] == 2)
check(
    "Upload nutzt die richtige RPC-Funktion",
    fake.calls[0][0] == "ingest_players",
)
check(
    "Nutzlast hat die vom Schema erwarteten Schluessel",
    set(fake.calls[0][1]["rows"][0]) == {
        "name", "alliance", "rank", "planet", "research", "total", "planets"
    },
)
check(
    "Import wird genau einmal protokolliert",
    [c[0] for c in fake.calls].count("log_snapshot") == 1
    and fake.calls[-1][1]["kind"] == "spieler",
)

# Grosse Importe muessen in Haeppchen zerlegt werden (Request-Groesse).
big = "Rang\tKoordinate\tBesitzer\tPunkte\n" + "".join(
    # Rang wie im Spiel mit deutschem Tausenderpunkt ("1.000").
    f"{i:,}".replace(",", ".") + f"\t{1 + i // 900}:{i % 900}:{i % 12 + 1}\towner{i}\t{i}\n"
    for i in range(1, 2501)
)
fake_big = FakeSession()
res_big = sb.upload(fake_big, "planets", big)
ingest_calls = [c for c in fake_big.calls if c[0] == "ingest_planets"]
check("2500 Zeilen werden in 3 Haeppchen gesendet", len(ingest_calls) == 3)
check("kein Haeppchen ist groesser als CHUNK",
      all(len(c[1]["rows"]) <= sb.CHUNK for c in ingest_calls))
check("alle Zeilen kommen an", res_big["rows"] == 2500)
check(
    "Planeten werden als 'planeten' protokolliert",
    fake_big.calls[-1][1]["kind"] == "planeten",
)

# Leere Eingabe darf keinen Request und keinen Protokolleintrag ausloesen.
fake_empty = FakeSession()
res_empty = sb.upload(fake_empty, "players", "nur Menuetext ohne Tabelle")
check("leerer Import sendet nichts", res_empty["rows"] == 0 and not fake_empty.calls)

# Der Parser muss auf den echten Dateien dasselbe liefern wie die Weboberflaeche.
if os.path.exists(GOOD_CAPTURE):
    with open(GOOD_CAPTURE, encoding="utf-8") as handle:
        real_text = handle.read()
    parsed = sb.parse_player_highscore(real_text) or sb.parse_planet_highscore(real_text)
    check(f"echte Kopie ({GOOD_CAPTURE}) liefert Datenzeilen", len(parsed) > 0)


# 7) Laufzeit-Schaetzung und Startbestaetigung.
fast, slow = m.estimate_job_seconds(m.JOBS[0])
check("Schaetzung: 'von' ist kleiner als 'bis'", fast < slow)
check(
    "Schaetzung deckt mindestens die festen Pausen ab",
    fast >= (m.JOBS[0]["last_page"] - m.START_PAGE + 1) * m.LOAD_DELAY,
)
check(
    "Schaetzung waechst mit der Seitenzahl",
    m.estimate_job_seconds({**m.JOBS[0], "last_page": 100})[0] > fast,
)
check(
    "Schaetzung fuer eine einzelne Seite enthaelt keine Rundenpause",
    m.estimate_job_seconds({**m.JOBS[0], "last_page": m.START_PAGE})[0]
    < m.estimate_job_seconds({**m.JOBS[0], "last_page": m.START_PAGE + 1})[0]
    - m.ROUND_DELAY,
)
check("leerer Durchlauf schaetzt 0", m.estimate_job_seconds({**m.JOBS[0], "last_page": 0}) == (0.0, 0.0))
check("Dauer wird lesbar formatiert", m.format_duration(3725) == "1:02:05 h")
check("kurze Dauer ohne Stunden", m.format_duration(95) == "1:35 min")


import builtins

real_input = builtins.input
try:
    for answer in ("j", "ja", "J", "y", "yes"):
        builtins.input = lambda *_a, _v=answer: _v
        check(f"Bestaetigung {answer!r} startet den Lauf", m.confirm("?") is True)
    for answer in ("", "n", "nein", "abbrechen"):
        builtins.input = lambda *_a, _v=answer: _v
        check(f"Eingabe {answer!r} bricht ab", m.confirm("?") is False)
finally:
    builtins.input = real_input

print()
if failures:
    print(f"{len(failures)} Test(s) fehlgeschlagen: {failures}")
    sys.exit(1)
print("Alle Tests bestanden.")
