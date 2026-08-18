"""
browser_multi_copy.py
======================
Kopiert wiederholt den Inhalt einer paginierten Browser-Seite.

Beispiel-URL:
    https://uni5.gigrawars.de/app/12:101:5/highscore/planet?page=2

WARUM DIESE VERSION ANDERS IST (Root Cause der frueheren Fehler)
----------------------------------------------------------------
Frueher wurde die URL ueber die ZWISCHENABLAGE (Strg+V) in die Adresszeile
eingefuegt. Der Browser liest die Zwischenablage aber ASYNCHRON aus. Dadurch
konnte er einen alten Inhalt erwischen - konkret den Konsolentext
"URL: https://..." , der bei einem frueheren Absturz per Strg+A/Strg+C aus dem
Konsolenfenster in die Zwischenablage geraten war. Da dieser Text keine
gueltige URL ist, hat Brave daraus eine SUCHANFRAGE gemacht und die
Suchergebnisseite angezeigt - genau diese Suchseite landete dann in den
Ergebnisdateien.

Konsequenzen in dieser Version:
1. Die Zwischenablage wird zum NAVIGIEREN gar nicht mehr benutzt.
   Die URL wird per Windows-SendInput als Unicode getippt. Das ist
   unabhaengig vom Tastaturlayout (wichtig bei deutscher Tastatur, wo
   /, ?, & und = auf Umschalt-Kombinationen liegen).
2. Vor dem Absenden (Enter) wird der TATSAECHLICHE Inhalt der Adresszeile
   ausgelesen und mit der Soll-URL verglichen. Nur bei exakter
   Uebereinstimmung wird Enter gedrueckt. So kann nie wieder versehentlich
   eine Suche ausgeloest werden.
3. Beim Lesen der Zwischenablage wird sie zuerst geleert und dann aktiv
   gewartet, bis neuer Inhalt ankommt (kein Raten mit festen Wartezeiten,
   keine veralteten Inhalte).
4. Vor JEDEM Tastendruck wird geprueft, ob das Browserfenster wirklich im
   Vordergrund ist. Sonst wird die Runde abgebrochen - damit landen
   Tastenkombinationen nie im Konsolenfenster (das war die Ursache des
   ersten Absturzes: Strg+C in der Konsole = Programmabbruch).

Installation (einmalig):
    py -m pip install pyautogui pygetwindow pyperclip pywin32

Start:
    py browser_multi_copy.py
"""

import ctypes
import random
import re
import sys
import time
from ctypes import wintypes
from datetime import datetime

try:
    import pyautogui
    import pygetwindow as gw
    import pyperclip
except ImportError:
    print("Fehlende Pakete. Bitte zuerst installieren mit:")
    print("    py -m pip install pyautogui pygetwindow pyperclip pywin32")
    sys.exit(1)

import gw_supabase

pyautogui.FAILSAFE = True  # Maus in linke obere Ecke = Notaus
pyautogui.PAUSE = 0.05

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

PAGE_PARAM_RE = re.compile(r"([?&]page=)(\d+)")

# ---------------------------------------------------------------------------
# KONFIGURATION - hier anpassen
# ---------------------------------------------------------------------------

# Fest eingetragene Seiten-URL. Die Seitenzahl (page=...) wird vom Skript
# automatisch ersetzt und hochgezaehlt.
BASE_URL_PLANETS = "https://uni5.gigrawars.de/app/12:101:5/highscore/planet?page=2"
BASE_URL_PLAYERS = "https://uni5.gigrawars.de/app/12:101:5/highscore/player?sort=allPoints&page=2"

START_PAGE = 1  # Es wird immer bei Seite 1 begonnen
LAST_PAGE_PLANETS = 40  # Feste letzte Seite der Planeten-Paginierung
LAST_PAGE_PLAYERS = 9  # Feste letzte Seite der Spieler-Paginierung
LOAD_DELAY = 1  # Wartezeit nach dem Laden: 1s + Bezier-Zufall 0-1s
ROUND_DELAY = 1  # Wartezeit zwischen den Runden: 1s + Bezier-Zufall 0-1s

# Kontrollpunkte der kubischen Bezier-Kurve, nach der die Zufallszeit verteilt
# wird. Start (0,0) und Ende (1,1) sind fest, hier stehen nur P1 und P2.
# Werte < 0.5 verschieben die Verteilung nach unten (haeufiger kurze Pausen),
# Werte > 0.5 nach oben (haeufiger lange Pausen).
BEZIER_P1 = 0.25
BEZIER_P2 = 0.85

# Die beiden Durchlaeufe in der Reihenfolge, in der sie abgearbeitet werden:
# erst alle Spieler, dann alle Planeten. Jeder Durchlauf bekommt eine
# eigene Ergebnisdatei.
JOBS = (
    {
        "key": "players",
        "name": "Spieler",
        "url": BASE_URL_PLAYERS,
        "last_page": LAST_PAGE_PLAYERS,
        "file_prefix": "highscore_player",
    },
    {
        "key": "planets",
        "name": "Planeten",
        "url": BASE_URL_PLANETS,
        "last_page": LAST_PAGE_PLANETS,
        "file_prefix": "highscore_planet",
    },
)

# Nach jedem Durchlauf direkt nach Supabase hochladen? Der Login erfolgt
# einmal vor dem Start (Zugangsdaten aus GW_SUPABASE_EMAIL /
# GW_SUPABASE_PASSWORD, sonst Abfrage). Die Textdateien werden trotzdem
# geschrieben - sie bleiben die Sicherung, falls der Upload scheitert.
UPLOAD_TO_SUPABASE = True

# --- Grundlage der Laufzeit-Schaetzung ------------------------------------
# Summe der FESTEN Wartezeiten pro Seite (ohne die zufaellige Bezier-Pause):
#   Navigation: 0.35 + 0.10 + 0.15 + 0.25 = 0.85 s
#   Kopieren:   0.30 (Auswahl) + 0.10 (Zwischenablage leeren) = 0.40 s
#   pyautogui.PAUSE nach rund 9 Tastenbefehlen                = 0.45 s
FIXED_PER_PAGE = 1.70
# Zeit fuer das Tippen eines URL-Zeichens (type_unicode).
TYPE_DELAY = 0.004
# Warten auf die Zwischenablage: einmal beim Pruefen der Adresszeile, einmal
# beim Kopieren des Seiteninhalts. Kurze Seiten sind schnell, grosse Listen
# brauchen laenger - daher eine Spanne.
CLIPBOARD_WAIT_MIN = 0.15
CLIPBOARD_WAIT_MAX = 0.60

# Marker, an denen eine versehentlich geladene Suchergebnisseite erkannt wird.
SEARCH_PAGE_MARKERS = (
    "brave logo",
    "google-suche",
    "bing",
    "suchergebnisse",
)


# ---------------------------------------------------------------------------
# Tastatureingabe per SendInput (layout-unabhaengig, ohne Zwischenablage)
# ---------------------------------------------------------------------------

INPUT_KEYBOARD = 1
KEYEVENTF_UNICODE = 0x0004
KEYEVENTF_KEYUP = 0x0002


class KEYBDINPUT(ctypes.Structure):
    _fields_ = (
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", wintypes.WPARAM),
    )


class MOUSEINPUT(ctypes.Structure):
    _fields_ = (
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", wintypes.WPARAM),
    )


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = (
        ("uMsg", wintypes.DWORD),
        ("wParamL", wintypes.WORD),
        ("wParamH", wintypes.WORD),
    )


class INPUT(ctypes.Structure):
    class _INPUTunion(ctypes.Union):
        _fields_ = (("ki", KEYBDINPUT), ("mi", MOUSEINPUT), ("hi", HARDWAREINPUT))

    _anonymous_ = ("_i",)
    _fields_ = (("type", wintypes.DWORD), ("_i", _INPUTunion))


def type_unicode(text, delay=0.004):
    """Tippt Text zeichenweise als echtes Unicode-Zeichen.

    Unabhaengig vom Tastaturlayout: es wird nicht 'die Taste X' gedrueckt,
    sondern direkt das Zeichen eingespeist. Damit werden /, ?, &, =, :
    auf einer deutschen Tastatur korrekt uebertragen.
    """
    for char in text:
        for flags in (KEYEVENTF_UNICODE, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP):
            event = INPUT(
                type=INPUT_KEYBOARD,
                ki=KEYBDINPUT(
                    wVk=0, wScan=ord(char), dwFlags=flags, time=0, dwExtraInfo=0
                ),
            )
            sent = user32.SendInput(1, ctypes.byref(event), ctypes.sizeof(INPUT))
            if sent != 1:
                raise OSError(
                    f"SendInput fehlgeschlagen (Fehlercode {ctypes.get_last_error()})"
                )
        time.sleep(delay)


# ---------------------------------------------------------------------------
# Fensterverwaltung
# ---------------------------------------------------------------------------


def choose_window():
    windows = [w for w in gw.getAllWindows() if w.title.strip()]
    if not windows:
        print("Keine offenen Fenster gefunden.")
        sys.exit(1)

    print("\nOffene Fenster:")
    for i, w in enumerate(windows):
        print(f"  [{i}] {w.title}")

    while True:
        choice = input("\nNummer des Browserfensters waehlen: ").strip()
        if choice.isdigit() and 0 <= int(choice) < len(windows):
            selected = windows[int(choice)]
            # Das Handle wird EINMAL gemerkt. Der Fenstertitel aendert sich mit
            # jeder geladenen Seite - eine Suche per Titel waere unzuverlaessig.
            return selected._hWnd, selected.title
        print("Ungueltige Eingabe, bitte erneut versuchen.")


def is_foreground(hwnd):
    return user32.GetForegroundWindow() == hwnd


def activate_window(hwnd, retries=6, delay=0.25):
    """Holt das Fenster in den Vordergrund und BESTAETIGT das anschliessend.

    Windows verweigert SetForegroundWindow, wenn der aufrufende Prozess nicht
    der aktive ist. Deshalb: Alt-Tap plus AttachThreadInput, danach pruefen.
    """
    SW_RESTORE = 9
    for _ in range(retries):
        if is_foreground(hwnd):
            return True

        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, SW_RESTORE)

        foreground = user32.GetForegroundWindow()
        thread_fg = user32.GetWindowThreadProcessId(foreground, None)
        thread_self = kernel32.GetCurrentThreadId()

        attached = False
        if thread_fg and thread_fg != thread_self:
            attached = bool(user32.AttachThreadInput(thread_self, thread_fg, True))
        try:
            # Alt-Tap hebt die Vordergrund-Sperre von Windows auf.
            user32.keybd_event(0x12, 0, 0, 0)
            user32.keybd_event(0x12, 0, KEYEVENTF_KEYUP, 0)
            user32.BringWindowToTop(hwnd)
            user32.SetForegroundWindow(hwnd)
        finally:
            if attached:
                user32.AttachThreadInput(thread_self, thread_fg, False)

        time.sleep(delay)
        if is_foreground(hwnd):
            return True
    return False


def get_window_title(hwnd):
    length = user32.GetWindowTextLengthW(hwnd)
    buffer = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buffer, length + 1)
    return buffer.value


# ---------------------------------------------------------------------------
# Zwischenablage (nur noch zum LESEN von kopiertem Inhalt)
# ---------------------------------------------------------------------------


def clear_clipboard():
    try:
        pyperclip.copy("")
    except Exception:
        pass


def normalize_newlines(text):
    """Vereinheitlicht Zeilenenden auf '\\n'.

    Die Windows-Zwischenablage liefert '\\r\\n'. Beim Schreiben der Datei
    wandelt Python '\\n' erneut in '\\r\\n' um - aus '\\r\\n' wuerde also
    '\\r\\r\\n', was beim Lesen wie eine zusaetzliche LEERZEILE nach jeder
    Zeile aussieht. Genau das war die Ursache des doppelten Zeilenabstands.
    """
    return (text or "").replace("\r\n", "\n").replace("\r", "\n")


def copy_and_wait(hwnd, timeout=5.0, poll=0.15):
    """Leert die Zwischenablage, loest Strg+C aus und wartet aktiv, bis
    tatsaechlich neuer Inhalt ankommt. Verhindert das Lesen veralteter Daten."""
    if not is_foreground(hwnd):
        return None
    clear_clipboard()
    time.sleep(0.1)
    pyautogui.hotkey("ctrl", "c")

    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(poll)
        try:
            content = pyperclip.paste()
        except Exception:
            continue
        if content:
            return normalize_newlines(content)
    return None


# ---------------------------------------------------------------------------
# URL-Hilfsfunktionen
# ---------------------------------------------------------------------------


def normalize_url(value):
    """Vergleichsform: ohne Schema, ohne Rand-Leerzeichen, ohne End-Slash."""
    value = (value or "").strip()
    for prefix in ("https://", "http://"):
        if value.lower().startswith(prefix):
            value = value[len(prefix):]
            break
    return value.rstrip("/")


def looks_like_search_page(content):
    lowered = (content or "")[:2000].lower()
    return any(marker in lowered for marker in SEARCH_PAGE_MARKERS)


def build_url_template(url):
    """Baut aus einer fest eingetragenen URL eine Vorlage mit Platzhalter."""
    match = PAGE_PARAM_RE.search(url)
    if not match:
        print(
            "FEHLER: In der URL wurde kein 'page=<Zahl>' gefunden.\n"
            f"URL = {url}\n"
            "Bitte oben im Skript eine URL mit z.B. '...&page=2' eintragen."
        )
        sys.exit(1)
    return PAGE_PARAM_RE.sub(r"\g<1>{page}", url, count=1)


def bezier_random(p1=BEZIER_P1, p2=BEZIER_P2):
    """Zufallswert zwischen 0 und 1, verteilt nach einer kubischen Bezier-Kurve.

    Es wird ein gleichverteilter Parameter t aus [0,1] gezogen und durch die
    Bezier-Funktion mit den Kontrollpunkten (0, p1, p2, 1) geschickt:

        B(t) = 3*(1-t)^2*t*p1 + 3*(1-t)*t^2*p2 + t^3

    Start- und Endpunkt sind 0 und 1, die Grenzen bleiben also erhalten. Die
    Kurvenform bestimmt lediglich, welche Werte dazwischen haeufiger auftreten -
    dadurch wirken die Pausen weniger maschinell als bei Gleichverteilung.
    """
    t = random.random()
    inv = 1.0 - t
    value = 3 * inv * inv * t * p1 + 3 * inv * t * t * p2 + t ** 3
    return min(1.0, max(0.0, value))


# ---------------------------------------------------------------------------
# Navigation
# ---------------------------------------------------------------------------


def navigate_to(hwnd, url, attempts=3):
    """Tippt die URL in die Adresszeile, VERIFIZIERT sie und sendet erst dann
    Enter. Gibt True zurueck, wenn die Navigation ausgeloest wurde."""
    for attempt in range(1, attempts + 1):
        if not is_foreground(hwnd):
            print("  Browser nicht im Vordergrund - Navigation abgebrochen.")
            return False

        pyautogui.hotkey("ctrl", "l")  # Adresszeile fokussieren
        time.sleep(0.35)
        pyautogui.hotkey("ctrl", "a")
        time.sleep(0.1)
        pyautogui.press("delete")
        time.sleep(0.15)

        try:
            type_unicode(url)
        except OSError as exc:
            print(f"  Tastatureingabe fehlgeschlagen: {exc}")
            return False
        time.sleep(0.25)

        # Adresszeile markieren und ihren echten Inhalt zurueckkopieren.
        pyautogui.hotkey("ctrl", "a")
        time.sleep(0.1)
        actual = copy_and_wait(hwnd, timeout=2.0)

        if actual is not None and normalize_url(actual) == normalize_url(url):
            pyautogui.press("enter")
            return True

        shown = "(leer)" if not actual else actual[:90]
        print(
            f"  Adresszeile stimmt nicht (Versuch {attempt}/{attempts}). "
            f"Gefunden: {shown!r} - es wird KEIN Enter gesendet."
        )
        pyautogui.hotkey("ctrl", "a")
        time.sleep(0.1)
        pyautogui.press("delete")
        time.sleep(0.3)

    pyautogui.press("escape")
    return False


# ---------------------------------------------------------------------------
# Hauptprogramm
# ---------------------------------------------------------------------------


def captures_to_text(captures):
    """Rohinhalte aller Seiten untereinander - ohne Trennzeilen."""
    parts = []
    for _, content in captures:
        text = normalize_newlines(content)
        if not text.endswith("\n"):
            text += "\n"
        parts.append(text)
    return "".join(parts)


def save_captures(captures, file_prefix, label):
    """Schreibt die gesammelten Rohinhalte eines Durchlaufs in eine Datei."""
    if not captures:
        print(f"\n[{label}] Keine Kopien vorhanden, es wird nichts gespeichert.")
        return None
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = f"{file_prefix}_{timestamp}.txt"
    # newline="" verhindert, dass Python die Zeilenenden nochmals umschreibt.
    # Es werden ausschliesslich die Rohinhalte untereinander geschrieben -
    # keine Trennzeilen, keine Ueberschriften.
    with open(out_path, "w", encoding="utf-8", newline="") as handle:
        handle.write(captures_to_text(captures).replace("\n", "\r\n"))
    print(f"\n[{label}] {len(captures)} Kopie(n) gespeichert in:\n  {out_path}")
    return out_path


def upload_captures(session, job, captures):
    """Laedt einen fertigen Durchlauf nach Supabase.

    Ein Fehler beim Upload darf den Lauf nicht abbrechen - die Textdatei ist
    zu diesem Zeitpunkt bereits geschrieben und kann jederzeit nachtraeglich
    per 'py gw_supabase.py <players|planets> <datei>' hochgeladen werden.
    """
    if session is None or not captures:
        return
    label = job["name"]
    try:
        result = gw_supabase.upload(session, job["key"], captures_to_text(captures))
    except gw_supabase.SupabaseError as exc:
        print(f"[{label}] Upload fehlgeschlagen: {exc}")
        print(f"[{label}] Die gespeicherte Datei kann spaeter nachgereicht werden.")
        return
    if not result["rows"]:
        print(f"[{label}] Upload: keine auswertbaren Zeilen gefunden - nichts gesendet.")
        return
    print(
        f"[{label}] Upload nach Supabase: {result['rows']} Zeile(n) gesendet, "
        f"{result['changed']} geaendert."
    )


def run_job(hwnd, job, captures):
    """Arbeitet einen Durchlauf (Spieler oder Planeten) Seite fuer Seite ab.

    Die Liste 'captures' wird von aussen uebergeben, damit bei einem Abbruch
    (Strg+C oder Notaus) die bereits gesammelten Seiten gespeichert werden.
    """
    label = job["name"]
    template = build_url_template(job["url"])
    last_page = job["last_page"]
    iterations = last_page - START_PAGE + 1
    if iterations < 1:
        print(f"[{label}] Ungueltige Seitenzahl ({last_page}) - uebersprungen.")
        return

    print(f"\n==================== {label} ====================")
    print(f"URL-Vorlage: {template}")
    print(f"Es werden die Seiten {START_PAGE} bis {last_page} kopiert.")

    for index in range(iterations):
        page_number = START_PAGE + index
        url = template.format(page=page_number)
        print(f"\n--- {label} | Runde {index + 1}/{iterations} | Seite {page_number} ---")

        if not activate_window(hwnd):
            print(
                "Fenster konnte nicht in den Vordergrund geholt werden - "
                "Runde uebersprungen (es werden keine Tasten gesendet)."
            )
            continue

        if not navigate_to(hwnd, url):
            print("Navigation fehlgeschlagen - Runde uebersprungen.")
            continue

        time.sleep(LOAD_DELAY + bezier_random())

        if not is_foreground(hwnd):
            print("Fokus verloren - Runde uebersprungen.")
            continue

        pyautogui.hotkey("ctrl", "a")
        time.sleep(0.3)
        content = copy_and_wait(hwnd)

        if not content:
            print("Warnung: Es konnte kein Inhalt kopiert werden.")
            continue

        if looks_like_search_page(content):
            print(
                "Warnung: Der kopierte Inhalt sieht nach einer "
                "Suchergebnisseite aus - er wird VERWORFEN."
            )
            continue

        captures.append((page_number, content))
        preview = content[:80].replace("\n", " ")
        print(f"Kopiert ({len(content)} Zeichen): {preview}...")

        if index < iterations - 1:
            time.sleep(ROUND_DELAY + bezier_random())


def format_duration(seconds):
    """Sekunden -> 'h:mm:ss' bzw. 'mm:ss' fuer kurze Laeufe."""
    seconds = int(round(seconds))
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d} h"
    return f"{minutes}:{secs:02d} min"


def estimate_job_seconds(job):
    """Kuerzeste und laengste erwartete Laufzeit eines Durchlaufs in Sekunden.

    Grundlage sind die tatsaechlich im Code stehenden Wartezeiten. Der
    Unterschied zwischen 'von' und 'bis' entsteht durch die Bezier-Pause
    (0-1 s nach dem Laden und 0-1 s zwischen den Runden) und durch die
    Wartezeit auf die Zwischenablage. Nicht enthalten sind Ladezeiten des
    Servers und fehlgeschlagene Runden, die wiederholt werden.
    """
    pages = job["last_page"] - START_PAGE + 1
    if pages < 1:
        return 0.0, 0.0

    typing = len(job["url"]) * TYPE_DELAY
    base = FIXED_PER_PAGE + typing + LOAD_DELAY
    # Die Pause zwischen den Runden entfaellt nach der letzten Seite.
    gaps = pages - 1

    fastest = pages * (base + 2 * CLIPBOARD_WAIT_MIN) + gaps * ROUND_DELAY
    # Schlimmster Fall: Bezier liefert 1 s nach dem Laden und 1 s pro Pause.
    slowest = pages * (base + 2 * CLIPBOARD_WAIT_MAX + 1.0) + gaps * (ROUND_DELAY + 1.0)
    return fastest, slowest


def print_estimate():
    """Zeigt je Durchlauf und in Summe, wie lange der Lauf dauern wird."""
    total_min = 0.0
    total_max = 0.0
    print("\nGeplante Durchlaeufe:")
    for job in JOBS:
        pages = job["last_page"] - START_PAGE + 1
        fastest, slowest = estimate_job_seconds(job)
        total_min += fastest
        total_max += slowest
        print(
            f"  - {job['name']}: Seiten {START_PAGE} bis {job['last_page']} "
            f"({pages} Seiten) -> {format_duration(fastest)} bis "
            f"{format_duration(slowest)}"
        )

    now = time.time()
    ende_min = datetime.fromtimestamp(now + total_min).strftime("%H:%M")
    ende_max = datetime.fromtimestamp(now + total_max).strftime("%H:%M")
    print(
        f"\nGeschaetzte Gesamtdauer: {format_duration(total_min)} bis "
        f"{format_duration(total_max)}"
    )
    print(f"Voraussichtlich fertig zwischen {ende_min} und {ende_max} Uhr.")
    print(
        "Hinweis: ohne Server-Ladezeiten und ohne Wiederholungen "
        "fehlgeschlagener Runden."
    )
    return total_min, total_max


def confirm(prompt):
    """Startet nur bei ausdruecklicher Zustimmung (j/ja/y/yes)."""
    answer = input(prompt).strip().lower()
    return answer in ("j", "ja", "y", "yes")


def connect_supabase():
    """Meldet sich VOR dem Lauf an, damit falsche Zugangsdaten sofort
    auffallen und nicht erst nach 50 kopierten Seiten. Bei Fehlschlag laeuft
    das Skript ohne Upload weiter - die Dateien entstehen trotzdem."""
    if not UPLOAD_TO_SUPABASE:
        return None
    print("\nSupabase-Login (Enter ohne Eingabe = ohne Upload fortfahren):")
    try:
        session = gw_supabase.sign_in()
    except gw_supabase.SupabaseError as exc:
        print(f"  Kein Upload: {exc}")
        return None
    print("  Login erfolgreich - die Ergebnisse werden hochgeladen.")
    return session


def main():
    print("=== Browser Multi-Copy (getippte URL, mit Verifikation) ===")

    hwnd, title = choose_window()
    print(f"Gewaehltes Fenster: {title}")

    print_estimate()

    session = connect_supabase()

    print(
        "\nWaehrend des Laufs bitte weder Maus noch Tastatur benutzen "
        "(Notaus: Maus in die linke obere Bildschirmecke)."
    )
    if not confirm("Jetzt starten? [j/n]: "):
        print("Abgebrochen - es wurde nichts kopiert und nichts hochgeladen.")
        return

    written_files = []
    for job in JOBS:
        captures = []
        aborted = False
        try:
            run_job(hwnd, job, captures)
        except (KeyboardInterrupt, pyautogui.FailSafeException):
            aborted = True
            print("\nAbgebrochen - sichere bisher gesammelte Kopien...")
        finally:
            # Erst speichern, dann hochladen: die Datei ist die Sicherung.
            path = save_captures(captures, job["file_prefix"], job["name"])
            if path:
                written_files.append(path)
            upload_captures(session, job, captures)
        if aborted:
            print("Die weiteren Durchlaeufe werden nicht mehr gestartet.")
            break

    for path in written_files:
        try:
            import os

            os.startfile(path)
        except Exception:
            pass


if __name__ == "__main__":
    main()
