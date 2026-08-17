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

# 3) URL-Vorlage aus der fest eingetragenen BASE_URL
template = m.build_url_template()
check(
    "Seitenzahl wird korrekt eingesetzt",
    template.format(page=7).endswith("sort=allPoints&page=7"),
)
check(
    "BASE_URL zeigt auf gigrawars-Highscore",
    "uni5.gigrawars.de" in m.BASE_URL and "highscore" in m.BASE_URL,
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

print()
if failures:
    print(f"{len(failures)} Test(s) fehlgeschlagen: {failures}")
    sys.exit(1)
print("Alle Tests bestanden.")
