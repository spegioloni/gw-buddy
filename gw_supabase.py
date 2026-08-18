"""
gw_supabase.py
==============
Parst die kopierten Highscore-Seiten und laedt sie direkt nach Supabase -
genau so, wie es sonst die Weboberflaeche per Copy&Paste tut.

Warum eigener Code und nicht die JS-Dateien?
--------------------------------------------
Die Weboberflaeche (src/parse/highscore.js + src/sync/supabase.js) laeuft im
Browser. Fuer den Upload aus dem Python-Skript wird dieselbe Logik hier
nachgebaut: gleiche Spaltenerkennung, gleiche Nutzlast, dieselben
RPC-Funktionen (ingest_players / ingest_planets / log_snapshot).

Sicherheit
----------
* Es wird ausschliesslich der oeffentliche anon-Key benutzt (derselbe, der im
  Web-Quelltext steht). Er allein darf laut Schema NICHTS - weder lesen noch
  schreiben.
* Geschrieben wird nur nach einem Login per E-Mail/Passwort; der Zugriff
  laeuft ueber die RPC-Funktionen, die nur 'authenticated' aufrufen darf.
* Zugangsdaten stehen NICHT im Code. Sie kommen aus den Umgebungsvariablen
  GW_SUPABASE_EMAIL / GW_SUPABASE_PASSWORD oder werden abgefragt.

Nur Standardbibliothek - keine zusaetzlichen Pakete noetig.
"""

import getpass
import json
import os
import re
import sys
import urllib.error
import urllib.request

# ---------------------------------------------------------------------------
# Konfiguration
# ---------------------------------------------------------------------------

# Quelle fuer Projekt-URL und anon-Key: die Weboberflaeche. So gibt es nur
# EINE Stelle, an der die Projektdaten gepflegt werden.
WEB_CONFIG_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "src", "sync", "supabase.js"
)

# Wie in src/sync/supabase.js: in Haeppchen senden, damit ein grosser Import
# nicht an der maximalen Request-Groesse scheitert.
CHUNK = 1000

HTTP_TIMEOUT = 30


class SupabaseError(RuntimeError):
    pass


def _read_web_config():
    """Liest url und anonKey aus DEFAULT_CONFIG in src/sync/supabase.js."""
    try:
        with open(WEB_CONFIG_FILE, encoding="utf-8") as handle:
            source = handle.read()
    except OSError:
        return None, None
    url = re.search(r"url:\s*'([^']+)'", source)
    key = re.search(r"anonKey:\s*'([^']+)'", source)
    return (url.group(1) if url else None), (key.group(1) if key else None)


def get_project_config():
    """Projekt-URL und anon-Key; Umgebungsvariablen haben Vorrang."""
    url, key = _read_web_config()
    url = (os.environ.get("SUPABASE_URL") or url or "").strip().rstrip("/")
    key = (os.environ.get("SUPABASE_ANON_KEY") or key or "").strip()
    if not url or not key:
        raise SupabaseError(
            "Projekt-URL/anon-Key nicht gefunden. Entweder src/sync/supabase.js "
            "bereitstellen oder SUPABASE_URL und SUPABASE_ANON_KEY setzen."
        )
    return url, key


# ---------------------------------------------------------------------------
# Parser - Spiegel von src/parse/highscore.js
# ---------------------------------------------------------------------------

HEAD_PLAYERS = re.compile(
    r"Name\s+Planetenpunkte\s+Forschungspunkte\s+Gesamtpunkte\s+Planeten", re.I
)
HEAD_PLANETS = re.compile(r"Koordinate\s+Besitzer\s+Punkte", re.I)

# Ab Rang 1000 traegt die Rangspalte einen Tausenderpunkt ("3.401").
RANK_RE = re.compile(r"^\d{1,3}(\.\d{3})*$")
COORD_RE = re.compile(r"^(\d{1,3}):(\d{1,3}):(\d{1,3})$")
ALLIANCE_RE = re.compile(r"^(.*?)\s*\[([^\]]+)\]\s*$")


def parse_gw_int(raw):
    """Deutsche Zahl ('344.761') -> int. '-' und '' -> None."""
    text = str(raw if raw is not None else "").strip()
    if text in ("", "-"):
        return None
    normalized = text.replace(".", "").replace(",", ".")
    try:
        return round(float(normalized))
    except ValueError:
        return None


def split_cells(line):
    """Zeile in Spalten: Tab bevorzugt, sonst 2+ Leerzeichen."""
    parts = line.split("\t") if "\t" in line else re.split(r" {2,}", line)
    return [p.replace("\u00a0", " ").strip() for p in parts]


def split_player_name(raw):
    """'capy [Fox-Wing]' -> ('capy', 'Fox-Wing'); ohne Tag -> (name, None)."""
    text = str(raw if raw is not None else "").replace("\u00a0", " ").strip()
    match = ALLIANCE_RE.match(text)
    if match:
        return match.group(1).strip(), (match.group(2).strip() or None)
    return text, None


def parse_player_highscore(text):
    """Spieler-Highscore -> Liste von Zeilen (Duplikate fallen weg)."""
    seen = {}
    for line in str(text or "").splitlines():
        if HEAD_PLAYERS.search(line):
            continue
        if "\t" not in line:
            continue
        cells = split_cells(line)
        if len(cells) < 6 or not RANK_RE.match(cells[0]):
            continue
        name, alliance = split_player_name(cells[1])
        if not name:
            continue
        total = parse_gw_int(cells[4])
        if total is None:
            continue
        if name in seen:
            continue
        seen[name] = {
            "name": name,
            "alliance": alliance,
            "rank": parse_gw_int(cells[0]),
            "planet": parse_gw_int(cells[2]) or 0,
            "research": parse_gw_int(cells[3]) or 0,
            "total": total,
            "planets": parse_gw_int(cells[5]) or 0,
        }
    return list(seen.values())


def parse_planet_highscore(text):
    """Planeten-Highscore -> Liste von Zeilen (Duplikate fallen weg)."""
    seen = {}
    for line in str(text or "").splitlines():
        if HEAD_PLANETS.search(line):
            continue
        if "\t" not in line:
            continue
        cells = split_cells(line)
        if len(cells) < 4 or not RANK_RE.match(cells[0]):
            continue
        match = COORD_RE.match(cells[1].strip())
        if not match:
            continue
        points = parse_gw_int(cells[3])
        if points is None:
            continue
        galaxy, system, position = (int(match.group(i)) for i in (1, 2, 3))
        coord = f"{galaxy}:{system}:{position}"
        if coord in seen:
            continue
        owner, _ = split_player_name(cells[2])
        seen[coord] = {
            "galaxy": galaxy,
            "system": system,
            "position": position,
            "owner": owner,
            "points": points,
            "rank": parse_gw_int(cells[0]),
        }
    return list(seen.values())


# Zuordnung Durchlauf -> Parser, RPC-Funktion und Protokoll-Art.
# 'kind' muss zum CHECK-Constraint der Tabelle snapshots passen.
JOB_KINDS = {
    "players": {
        "parse": parse_player_highscore,
        "rpc": "ingest_players",
        "kind": "spieler",
    },
    "planets": {
        "parse": parse_planet_highscore,
        "rpc": "ingest_planets",
        "kind": "planeten",
    },
}


# ---------------------------------------------------------------------------
# HTTP / Supabase REST
# ---------------------------------------------------------------------------


def _post_json(url, payload, headers):
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST")
    request.add_header("Content-Type", "application/json")
    for name, value in headers.items():
        request.add_header(name, value)
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
            body = response.read().decode("utf-8") or "null"
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:400]
        raise SupabaseError(f"HTTP {exc.code} von {url}\n  {detail}") from None
    except urllib.error.URLError as exc:
        raise SupabaseError(f"Verbindung zu {url} fehlgeschlagen: {exc.reason}") from None
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return body


class SupabaseSession:
    """Angemeldete Sitzung; haelt das Zugriffstoken fuer die RPC-Aufrufe."""

    def __init__(self, url, anon_key, access_token):
        self.url = url
        self.anon_key = anon_key
        self.access_token = access_token

    @property
    def _headers(self):
        return {
            "apikey": self.anon_key,
            "Authorization": f"Bearer {self.access_token}",
        }

    def rpc(self, function_name, params):
        return _post_json(
            f"{self.url}/rest/v1/rpc/{function_name}", params, self._headers
        )


def sign_in(email=None, password=None):
    """Login per E-Mail/Passwort. Ohne Argumente werden die Umgebungs-
    variablen GW_SUPABASE_EMAIL / GW_SUPABASE_PASSWORD genutzt, sonst wird
    interaktiv gefragt (Passworteingabe bleibt verdeckt)."""
    url, anon_key = get_project_config()

    email = email or os.environ.get("GW_SUPABASE_EMAIL") or ""
    password = password or os.environ.get("GW_SUPABASE_PASSWORD") or ""
    if not email:
        email = input("Supabase E-Mail: ").strip()
    if not email:
        raise SupabaseError("Keine E-Mail angegeben - kein Login moeglich.")
    if not password:
        password = getpass.getpass("Supabase Passwort: ")
    if not password:
        raise SupabaseError("Kein Passwort angegeben - kein Login moeglich.")

    result = _post_json(
        f"{url}/auth/v1/token?grant_type=password",
        {"email": email, "password": password},
        {"apikey": anon_key},
    )
    token = (result or {}).get("access_token")
    if not token:
        raise SupabaseError("Login fehlgeschlagen: kein Zugriffstoken erhalten.")
    return SupabaseSession(url, anon_key, token)


def upload(session, job_key, text):
    """Parst den kopierten Text und schickt ihn an die passende RPC-Funktion.

    Rueckgabe: dict mit rows (erkannte Zeilen) und changed (echte Aenderungen).
    """
    spec = JOB_KINDS.get(job_key)
    if spec is None:
        raise SupabaseError(f"Unbekannter Durchlauf: {job_key!r}")

    rows = spec["parse"](text)
    if not rows:
        return {"rows": 0, "changed": 0}

    total = 0
    changed = 0
    for start in range(0, len(rows), CHUNK):
        result = session.rpc(spec["rpc"], {"rows": rows[start:start + CHUNK]}) or {}
        total += result.get("rows") or 0
        changed += result.get("changed") or 0

    # Ein Import = eine Zeile im Protokoll, egal wie viele Haeppchen es waren.
    session.rpc("log_snapshot", {"kind": spec["kind"], "rows": total, "changed": changed})
    return {"rows": total, "changed": changed, "parsed": len(rows)}


# ---------------------------------------------------------------------------
# Manueller Nachschub: bereits gespeicherte Dateien hochladen
# ---------------------------------------------------------------------------


def main(argv):
    if len(argv) != 2 or argv[0] not in JOB_KINDS:
        print("Aufruf: py gw_supabase.py <players|planets> <datei.txt>")
        return 2
    job_key, path = argv
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    session = sign_in()
    result = upload(session, job_key, text)
    print(f"{result['rows']} Zeile(n) gesendet, {result['changed']} geaendert.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
