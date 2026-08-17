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
BASE_URL = "https://uni5.gigrawars.de/app/12:101:5/highscore/planet?page=2"

START_PAGE = 1  # Es wird immer bei Seite 1 begonnen
LAST_PAGE = 9  # Standard fuer die letzte Seite der Paginierung
LOAD_DELAY = 1  # Wartezeit nach dem Laden: 1s + zufaellig 0-1s
ROUND_DELAY = 1  # Wartezeit zwischen den Runden: 1s + zufaellig 0-1s

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


def build_url_template(url=BASE_URL):
    """Baut aus der fest eingetragenen URL eine Vorlage mit Platzhalter."""
    match = PAGE_PARAM_RE.search(url)
    if not match:
        print(
            "FEHLER: In BASE_URL wurde kein 'page=<Zahl>' gefunden.\n"
            f"BASE_URL = {url}\n"
            "Bitte oben im Skript eine URL mit z.B. '...&page=2' eintragen."
        )
        sys.exit(1)
    return PAGE_PARAM_RE.sub(r"\g<1>{page}", url, count=1)


def get_int(prompt, default=None):
    while True:
        raw = input(prompt).strip()
        if not raw and default is not None:
            return default
        if raw.isdigit():
            return int(raw)
        print("Bitte eine Zahl eingeben.")


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


def main():
    print("=== Browser Multi-Copy (getippte URL, mit Verifikation) ===")

    hwnd, title = choose_window()
    print(f"Gewaehltes Fenster: {title}")

    template = build_url_template()
    print(f"URL-Vorlage: {template}")

    last_page = get_int(
        f"\nBis zu welcher Seite geht die Paginierung? (Enter = {LAST_PAGE}): ",
        default=LAST_PAGE,
    )
    start_page = START_PAGE
    iterations = last_page - start_page + 1
    if iterations < 1:
        print("Die letzte Seite muss mindestens 1 sein.")
        sys.exit(1)
    load_delay = LOAD_DELAY
    round_delay = ROUND_DELAY
    print(f"Es werden die Seiten {start_page} bis {last_page} kopiert.")

    input(
        "\nAlles bereit. Waehrend des Laufs bitte weder Maus noch Tastatur "
        "benutzen.\nDruecke Enter um zu starten..."
    )

    captures = []

    def save_results():
        if not captures:
            print("\nKeine Kopien vorhanden, es wird nichts gespeichert.")
            return
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_path = f"browser_copies_{timestamp}.txt"
        # newline="" verhindert, dass Python die Zeilenenden nochmals umschreibt.
        # Es werden ausschliesslich die Rohinhalte untereinander geschrieben -
        # keine Trennzeilen, keine Ueberschriften.
        with open(out_path, "w", encoding="utf-8", newline="") as handle:
            for _, content in captures:
                text = normalize_newlines(content)
                if not text.endswith("\n"):
                    text += "\n"
                handle.write(text.replace("\n", "\r\n"))
        print(f"\n{len(captures)} Kopie(n) gespeichert in:\n  {out_path}")
        try:
            import os

            os.startfile(out_path)
        except Exception:
            pass

    try:
        for index in range(iterations):
            page_number = start_page + index
            url = template.format(page=page_number)
            print(f"\n--- Runde {index + 1}/{iterations} | Seite {page_number} ---")

            if not activate_window(hwnd):
                print(
                    "Fenster konnte nicht in den Vordergrund geholt werden - "
                    "Runde uebersprungen (es werden keine Tasten gesendet)."
                )
                continue

            if not navigate_to(hwnd, url):
                print("Navigation fehlgeschlagen - Runde uebersprungen.")
                continue

            time.sleep(load_delay + random.uniform(0, 1))

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
                time.sleep(round_delay + random.uniform(0, 1))
    except (KeyboardInterrupt, pyautogui.FailSafeException):
        print("\nAbgebrochen - sichere bisher gesammelte Kopien...")
    finally:
        save_results()


if __name__ == "__main__":
    main()
