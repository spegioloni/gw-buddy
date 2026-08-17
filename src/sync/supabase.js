// Supabase-Anbindung: Login, Import der Highscore-Listen, Abfrage der
// inaktiven Ziele. Die Bibliothek wird erst beim ersten Zugriff per ESM-CDN
// geladen — ohne konfiguriertes Projekt bleibt die Seite komplett offline.
//
// URL und anon-Key sind öffentlich (sie stehen in jeder Supabase-Web-App im
// Quelltext). Der Schutz liegt in Row Level Security: lesen darf nur, wer
// eingeloggt ist, schreiben geht ausschließlich über die RPC-Funktionen.

const CDN = 'https://esm.sh/@supabase/supabase-js@2';
const LS_KEY = 'gw_supabaseCfg';

/**
 * Voreinstellung für dieses Projekt. Der anon-Key ist bewusst öffentlich:
 * Er identifiziert nur das Projekt. Ohne Login lässt das Schema (siehe
 * supabase/schema.sql) weder Lesen noch Schreiben zu — `anon` hat auf keine
 * Tabelle, View oder Funktion Rechte. Wer den Key hat, kommt an keine Daten.
 */
export const DEFAULT_CONFIG = {
  url: 'https://covkoxamxzzpagphvair.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvdmtveGFteHp6cGFncGh2YWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5NTUxODIsImV4cCI6MjEwMjUzMTE4Mn0.PaN0zq-I7GVGgs6ZOmTdLjlWAmXHZbkHJmOYHXL83aA',
};

export function getConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (raw && raw.url && raw.anonKey) return { url: raw.url, anonKey: raw.anonKey };
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG };
}

export function setConfig(url, anonKey) {
  const cfg = {
    // Toleriert die REST-URL aus dem Supabase-Dashboard
    // (".../rest/v1/") — supabase-js will die nackte Projekt-URL.
    url: String(url || '').trim().replace(/\/+$/, '').replace(/\/rest\/v\d+$/i, ''),
    anonKey: String(anonKey || '').trim(),
  };
  localStorage.setItem(LS_KEY, JSON.stringify(cfg));
  client = null;
  return cfg;
}

export const isConfigured = () => {
  const c = getConfig();
  return !!(c.url && c.anonKey);
};

let client = null;
async function getClient() {
  if (client) return client;
  const cfg = getConfig();
  if (!cfg.url || !cfg.anonKey) throw new Error('Supabase ist noch nicht konfiguriert.');
  const { createClient } = await import(CDN);
  client = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'gw_supabaseAuth' },
  });
  return client;
}

/* ---------- Auth ---------- */

export async function currentUser() {
  if (!isConfigured()) return null;
  const sb = await getClient();
  const { data } = await sb.auth.getSession();
  return data?.session?.user ?? null;
}

export async function signIn(email, password) {
  const sb = await getClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data.user;
}

export async function signOut() {
  const sb = await getClient();
  await sb.auth.signOut();
}

/* ---------- Import ---------- */

/** In Häppchen, damit ein Import nicht an der Request-Größe scheitert. */
const CHUNK = 1000;

async function rpcChunked(fn, kind, rows) {
  const sb = await getClient();
  let total = 0, changed = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data, error } = await sb.rpc(fn, { rows: rows.slice(i, i + CHUNK) });
    if (error) throw new Error(error.message);
    total += data?.rows ?? 0;
    changed += data?.changed ?? 0;
  }
  // Ein Import = eine Zeile im Protokoll, egal wie viele Häppchen es waren.
  const { error } = await sb.rpc('log_snapshot', { kind, rows: total, changed });
  if (error) throw new Error(error.message);
  return { rows: total, changed };
}

/** Zeilen aus parsePlayerHighscore -> JSON für ingest_players. */
export const playerPayload = (rows) => rows.map((r) => ({
  name: r.name, alliance: r.alliance, rank: r.rank,
  total: r.totalPoints, planet: r.planetPoints,
  research: r.researchPoints, planets: r.planetCount,
}));

/** Zeilen aus parsePlanetHighscore -> JSON für ingest_planets. */
export const planetPayload = (rows) => rows.map((r) => ({
  galaxy: r.galaxy, system: r.system, position: r.position,
  owner: r.owner, points: r.points, rank: r.rank,
}));

/** Zeilen aus parseFarmReports -> JSON für ingest_farm_reports. */
export const farmReportPayload = (rows) => rows
  .filter((r) => r.at != null && r.start && r.target)
  .map((r) => ({
    origin: r.start, target: r.target, player: r.player,
    at: new Date(r.at).toISOString(),
    iron: r.resources.iron, lutinum: r.resources.lutinum,
    water: r.resources.water, hydrogen: r.resources.hydrogen,
  }));

/** Spieler-Highscore hochladen. */
export function pushPlayers(rows) {
  return rpcChunked('ingest_players', 'spieler', playerPayload(rows));
}

/** Planeten-Highscore hochladen. */
export function pushPlanets(rows) {
  return rpcChunked('ingest_planets', 'planeten', planetPayload(rows));
}

/**
 * Angriffsberichte archivieren. `changed` sind die wirklich neuen Berichte —
 * schon bekannte fallen serverseitig am Unique-Index ab.
 */
export function pushFarmReports(rows) {
  const payload = farmReportPayload(rows);
  const skipped = rows.length - payload.length;
  if (!payload.length) return Promise.resolve({ rows: 0, changed: 0, skipped });
  return rpcChunked('ingest_farm_reports', 'farmberichte', payload)
    .then((res) => ({ ...res, skipped }));
}

/* ---------- Abfragen ---------- */

/**
 * Inaktive Ziele holen. Vorfilterung passiert serverseitig, damit nie die
 * ganze Tabelle über die Leitung geht.
 * @param opts {idleDays, galaxies:number[], systemFrom, systemTo, maxPoints}
 */
export async function fetchFarms(opts = {}) {
  const sb = await getClient();
  let q = sb.from('inactive_farms').select('*').limit(2000);
  if (opts.idleDays != null) q = q.gte('player_idle_days', opts.idleDays);
  if (opts.galaxies?.length) q = q.in('galaxy', opts.galaxies);
  if (opts.systemFrom != null) q = q.gte('system', opts.systemFrom);
  if (opts.systemTo != null) q = q.lte('system', opts.systemTo);
  if (opts.maxPoints != null) q = q.lte('total_points', opts.maxPoints);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

/** Kopfzahlen: letzte Importe. */
export async function fetchSnapshots(limit = 8) {
  const sb = await getClient();
  const { data, error } = await sb.from('snapshots')
    .select('kind, taken_at, row_count, changed_count')
    .order('taken_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

/** Punkteverlauf eines Spielers (für die Detailansicht). */
export async function fetchPlayerHistory(name, limit = 30) {
  const sb = await getClient();
  const { data, error } = await sb.from('player_history_named')
    .select('seen_at, total_points')
    .eq('name', name)
    .order('seen_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

/** Tagesbeute je eigenem Planeten für die Diagramme. */
export async function fetchLootDaily(days = 30) {
  const sb = await getClient();
  const from = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
  const { data, error } = await sb.from('farm_loot_daily')
    .select('*').gte('day', from).order('day', { ascending: true }).limit(5000);
  if (error) throw new Error(error.message);
  return data || [];
}

/** Gesamtertrag je Farm für die Rangliste und den Farmatlas. */
export async function fetchLootTargets(limit = 500) {
  const sb = await getClient();
  const { data, error } = await sb.from('farm_loot_targets')
    .select('*').order('total', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}
