-- GigraWars · Orbitkommando — Farmradar
-- Komplettes Supabase-Schema. Einmal im SQL-Editor des Projekts ausführen.
--
-- Prinzip: Es werden nicht alle Snapshots komplett gespeichert. Beim Import
-- pflegen die RPC-Funktionen den aktuellen Stand (players/planets) und legen
-- eine History-Zeile nur an, wenn sich die Punkte (bzw. der Besitzer)
-- geändert haben. `points_unchanged_since` ist damit direkt der Zeitpunkt,
-- seit dem sich nichts mehr tut — das ist das Inaktivitätssignal.

-- ============================================================ Tabellen ====

create table if not exists public.players (
  id                     bigserial primary key,
  name                   text not null unique,
  alliance               text,
  rank_pos               int,
  total_points           bigint,
  planet_points          bigint,
  research_points        bigint,
  planet_count           int,
  first_seen_at          timestamptz not null default now(),
  last_seen_at           timestamptz not null default now(),
  points_unchanged_since timestamptz not null default now()
);

create table if not exists public.planets (
  id                     bigserial primary key,
  galaxy                 int not null,
  system                 int not null,
  position               int not null,
  owner_name             text,
  points                 bigint,
  rank_pos               int,
  first_seen_at          timestamptz not null default now(),
  last_seen_at           timestamptz not null default now(),
  points_unchanged_since timestamptz not null default now(),
  unique (galaxy, system, position)
);
create index if not exists planets_sector_idx on public.planets (galaxy, system);
create index if not exists planets_owner_idx  on public.planets (owner_name);

create table if not exists public.player_history (
  player_id       bigint not null references public.players(id) on delete cascade,
  seen_at         timestamptz not null default now(),
  total_points    bigint,
  planet_points   bigint,
  research_points bigint,
  planet_count    int,
  primary key (player_id, seen_at)
);

create table if not exists public.planet_history (
  planet_id  bigint not null references public.planets(id) on delete cascade,
  seen_at    timestamptz not null default now(),
  points     bigint,
  owner_name text,
  primary key (planet_id, seen_at)
);

-- Archiv der eigenen Angriffsberichte. Ein Bericht ist eindeutig über
-- Startplanet + Ziel + Angriffszeitpunkt: von einem Planeten kann nicht
-- zweimal in derselben Sekunde dieselbe Farm getroffen werden. Damit
-- erkennt der Import ohne Zusatzlogik, welche Berichte neu sind — doppelte
-- laufen in `on conflict do nothing`.
create table if not exists public.farm_reports (
  id            bigserial primary key,
  origin        text not null,   -- eigener Planet, von dem der Angriff startete
  target        text not null,   -- angegriffene Farm
  target_player text,
  attacked_at   timestamptz not null,
  iron          bigint not null default 0,
  lutinum       bigint not null default 0,
  water         bigint not null default 0,
  hydrogen      bigint not null default 0,
  total         bigint generated always as (iron + lutinum + water + hydrogen) stored,
  imported_at   timestamptz not null default now(),
  unique (origin, target, attacked_at)
);
create index if not exists farm_reports_at_idx     on public.farm_reports (attacked_at desc);
create index if not exists farm_reports_target_idx on public.farm_reports (target);

create table if not exists public.snapshots (
  id            bigserial primary key,
  kind          text not null,
  taken_at      timestamptz not null default now(),
  row_count     int,
  changed_count int
);

-- Die aktiv beflogene Farmliste je eigenem Planeten. Die Schiffszahl ist
-- begrenzt: ein Planet bedient nur eine Handvoll Ziele, und wer nichts mehr
-- abwirft, muss einem besseren Ziel weichen. Genau diese Belegung steht
-- hier — inklusive der abgelegten Ziele, damit man nicht im Kreis läuft
-- und dieselbe taube Farm nächste Woche erneut aufnimmt.
create table if not exists public.farm_roster (
  id            bigserial primary key,
  origin        text not null,   -- eigener Planet, von dem geflogen wird
  target        text not null,   -- Farmkoordinate
  target_player text,
  slot_note     text,            -- freie Notiz ("Deuterium", "nur nachts")
  active        boolean not null default true,
  added_at      timestamptz not null default now(),
  removed_at    timestamptz,
  drop_reason   text,
  unique (origin, target),
  constraint farm_roster_origin_fmt check (origin ~ '^[0-9]+:[0-9]+:[0-9]+$'),
  constraint farm_roster_target_fmt check (target ~ '^[0-9]+:[0-9]+:[0-9]+$')
);
create index if not exists farm_roster_origin_idx on public.farm_roster (origin) where active;

-- Kapazität eines eigenen Planeten: so viele Farmen kann die dort
-- stationierte Flotte in einer Runde bedienen.
create table if not exists public.farm_slots (
  origin     text primary key,
  slots      int not null default 8 check (slots between 0 and 200),
  note       text,
  updated_at timestamptz not null default now(),
  constraint farm_slots_origin_fmt check (origin ~ '^[0-9]+:[0-9]+:[0-9]+$')
);

-- Nachträglich erweiterbar, ohne die Tabelle neu anzulegen.
alter table public.snapshots drop constraint if exists snapshots_kind_check;
alter table public.snapshots add constraint snapshots_kind_check
  check (kind in ('spieler', 'planeten', 'farmberichte'));

-- ============================================================== Views ====

-- security_invoker: die View rechnet mit den Rechten des Aufrufers, damit
-- Row Level Security der Basistabellen auch hier greift.

-- Vor dem Neuanlegen werden die Views verworfen. Grund: 'create or replace
-- view' darf Spalten nur HINTEN anhaengen — Umbenennen oder Umsortieren
-- scheitert mit 'ERROR 42P16: cannot change name of view column'. Genau das
-- passiert, sobald hier eine Spalte in der Mitte dazukommt. Views halten
-- keine Daten, das Verwerfen ist gefahrlos; die Rechte werden am Ende der
-- Datei ohnehin neu vergeben.
drop view if exists public.inactive_farms;
drop view if exists public.player_history_named;
drop view if exists public.farm_loot_daily;
drop view if exists public.farm_loot_targets;
drop view if exists public.farm_roster_stats;

create or replace view public.inactive_farms
with (security_invoker = on) as
select
  pl.galaxy,
  pl.system,
  pl."position",
  pl.points,
  pl.owner_name,
  floor(extract(epoch from now() - pl.points_unchanged_since) / 86400)::int as planet_idle_days,
  floor(extract(epoch from now() - coalesce(p.points_unchanged_since, pl.points_unchanged_since)) / 86400)::int as player_idle_days,
  p.total_points,
  p.alliance,
  p.planet_count,
  p.last_seen_at as player_last_seen_at,
  pl.last_seen_at as planet_last_seen_at,
  -- Stundengenaue Variante derselben Werte: unter 24 h stehen die Tage noch
  -- auf 0, die Stunden zeigen die Inaktivitaet aber bereits an.
  floor(extract(epoch from now() - pl.points_unchanged_since) / 3600)::int as planet_idle_hours,
  floor(extract(epoch from now() - coalesce(p.points_unchanged_since, pl.points_unchanged_since)) / 3600)::int as player_idle_hours,
  -- Ist die Inaktivität belegt? Beim allerersten Import bekommt jeder Spieler
  -- `points_unchanged_since = now()` — das sieht aus wie „gerade eben aktiv",
  -- ist aber nur der Startpunkt der Beobachtung. Erst wenn danach einmal eine
  -- Punkteänderung gesehen wurde, sagt die Uhr etwas über den Spieler aus.
  (coalesce(p.points_unchanged_since, pl.points_unchanged_since)
     > coalesce(p.first_seen_at, pl.first_seen_at)) as idle_confirmed
from public.planets pl
left join public.players p on p.name = pl.owner_name;

create or replace view public.player_history_named
with (security_invoker = on) as
select p.name, h.seen_at, h.total_points, h.planet_points, h.research_points, h.planet_count
from public.player_history h
join public.players p on p.id = h.player_id;

-- Beute pro Spieltag und eigenem Planeten. Der Tageswechsel richtet sich
-- nach der Spielzeit (Europe/Berlin), nicht nach UTC — sonst lägen die
-- Nachtangriffe im falschen Balken.
create or replace view public.farm_loot_daily
with (security_invoker = on) as
select
  ((attacked_at at time zone 'Europe/Berlin')::date)::text as day,
  origin,
  sum(iron)::bigint     as iron,
  sum(lutinum)::bigint  as lutinum,
  sum(water)::bigint    as water,
  sum(hydrogen)::bigint as hydrogen,
  sum(total)::bigint    as total,
  count(*)::int         as reports
from public.farm_reports
group by 1, 2;

-- Ertrag je Farm über die gesamte Zeit, plus der jeweils jüngste Angriff.
-- Damit weiß der Farmatlas auch für Ziele Bescheid, die im gerade
-- eingefügten Berichtsblatt gar nicht mehr auftauchen.
create or replace view public.farm_loot_targets
with (security_invoker = on) as
select
  target,
  (array_agg(target_player order by attacked_at desc))[1] as target_player,
  sum(iron)::bigint     as iron,
  sum(lutinum)::bigint  as lutinum,
  sum(water)::bigint    as water,
  sum(hydrogen)::bigint as hydrogen,
  sum(total)::bigint    as total,
  count(*)::int         as reports,
  round(avg(total))::bigint as avg_total,
  max(total)::bigint    as best_total,
  min(attacked_at)      as first_at,
  max(attacked_at)      as last_at,
  (array_agg(origin   order by attacked_at desc))[1]         as last_origin,
  (array_agg(total    order by attacked_at desc))[1]::bigint as last_total,
  (array_agg(iron     order by attacked_at desc))[1]::bigint as last_iron,
  (array_agg(lutinum  order by attacked_at desc))[1]::bigint as last_lutinum,
  (array_agg(water    order by attacked_at desc))[1]::bigint as last_water,
  (array_agg(hydrogen order by attacked_at desc))[1]::bigint as last_hydrogen
from public.farm_reports
group by target;

-- Die Farmliste mit allem, was für ein Austauschen nötig ist: was das Ziel
-- seit der Aufnahme wirklich abgeworfen hat (nur Angriffe von genau diesem
-- Planeten), wie lange es her ist, und ob das Ziel überhaupt noch schläft.
-- `per_day` ist der Maßstab für den Vergleich: Gesamtbeute geteilt durch die
-- Tage in der Liste — eine Farm, die man seit 20 Tagen mitschleppt und
-- dreimal angeflogen hat, sieht damit schlechter aus als eine frische.
create or replace view public.farm_roster_stats
with (security_invoker = on) as
select
  r.origin,
  r.target,
  coalesce(pl.owner_name, r.target_player)                as target_player,
  r.slot_note,
  r.active,
  r.added_at,
  r.removed_at,
  r.drop_reason,
  coalesce(s.reports, 0)                                  as reports,
  coalesce(s.total, 0)::bigint                            as total,
  coalesce(s.avg_total, 0)::bigint                        as avg_total,
  coalesce(s.best_total, 0)::bigint                       as best_total,
  coalesce(s.last_total, 0)::bigint                       as last_total,
  coalesce(s.iron, 0)::bigint                             as iron,
  coalesce(s.lutinum, 0)::bigint                          as lutinum,
  coalesce(s.water, 0)::bigint                            as water,
  coalesce(s.hydrogen, 0)::bigint                         as hydrogen,
  s.first_at,
  s.last_at,
  floor(extract(epoch from now() - r.added_at) / 86400)::int as days_listed,
  round(coalesce(s.total, 0)
    / greatest(1, extract(epoch from now() - r.added_at) / 86400))::bigint as per_day,
  case when s.last_at is null then null
       else floor(extract(epoch from now() - s.last_at) / 3600)::int end   as hours_since_last,
  -- Was das Ziel jemals gebracht hat, egal von welchem Planeten und egal,
  -- wie oft es schon auf einer Liste stand. Das ist der ehrliche Blick auf
  -- eine Farm, die man gerade erst (wieder) aufgenommen hat.
  coalesce(l.reports, 0)                                  as life_reports,
  coalesce(l.total, 0)::bigint                            as life_total,
  coalesce(l.avg_total, 0)::bigint                        as life_avg,
  coalesce(l.best_total, 0)::bigint                       as life_best,
  coalesce(l.last_total, 0)::bigint                       as life_last,
  l.last_at                                               as life_last_at,
  pl.points                                               as planet_points,
  floor(extract(epoch from now() - coalesce(p.points_unchanged_since, pl.points_unchanged_since)) / 3600)::int as player_idle_hours,
  (coalesce(p.points_unchanged_since, pl.points_unchanged_since)
     > coalesce(p.first_seen_at, pl.first_seen_at)) as idle_confirmed,
  floor(extract(epoch from now() - pl.points_unchanged_since) / 3600)::int as planet_idle_hours,
  p.total_points,
  p.planet_count,
  p.alliance
from public.farm_roster r
left join public.planets pl
  on pl.galaxy = split_part(r.target, ':', 1)::int
 and pl.system = split_part(r.target, ':', 2)::int
 and pl."position" = split_part(r.target, ':', 3)::int
left join public.players p on p.name = pl.owner_name
left join lateral (
  select count(*)::int            as reports,
         sum(fr.total)            as total,
         round(avg(fr.total))     as avg_total,
         max(fr.total)            as best_total,
         (array_agg(fr.total order by fr.attacked_at desc))[1] as last_total,
         sum(fr.iron)             as iron,
         sum(fr.lutinum)          as lutinum,
         sum(fr.water)            as water,
         sum(fr.hydrogen)         as hydrogen,
         min(fr.attacked_at)      as first_at,
         max(fr.attacked_at)      as last_at
  from public.farm_reports fr
  where fr.origin = r.origin and fr.target = r.target
    and fr.attacked_at >= r.added_at
) s on true
left join lateral (
  select count(*)::int        as reports,
         sum(fr.total)        as total,
         round(avg(fr.total)) as avg_total,
         max(fr.total)        as best_total,
         (array_agg(fr.total order by fr.attacked_at desc))[1] as last_total,
         max(fr.attacked_at)  as last_at
  from public.farm_reports fr
  where fr.target = r.target
) l on true;

-- ======================================================== RPC: Import ====

create or replace function public.ingest_players(rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total   int := 0;
  v_changed int := 0;
begin
  select count(*) into v_total from jsonb_array_elements(rows);

  with src as (
    select distinct on (name) *
    from (
      select nullif(btrim(r->>'name'), '')     as name,
             nullif(btrim(r->>'alliance'), '') as alliance,
             (r->>'rank')::int                 as rank_pos,
             (r->>'total')::bigint             as total_points,
             (r->>'planet')::bigint            as planet_points,
             (r->>'research')::bigint          as research_points,
             (r->>'planets')::int              as planet_count
      from jsonb_array_elements(rows) r
    ) t
    where name is not null
    order by name
  ),
  prev as (
    select s.*, p.id as old_id, p.total_points as old_total
    from src s
    left join players p on p.name = s.name
  ),
  ups as (
    insert into players as p
      (name, alliance, rank_pos, total_points, planet_points,
       research_points, planet_count, last_seen_at, points_unchanged_since)
    select name, alliance, rank_pos, total_points, planet_points,
           research_points, planet_count, now(), now()
    from src
    on conflict (name) do update set
      alliance     = excluded.alliance,
      rank_pos     = excluded.rank_pos,
      last_seen_at = now(),
      points_unchanged_since = case
        when p.total_points is distinct from excluded.total_points then now()
        else p.points_unchanged_since end,
      total_points    = excluded.total_points,
      planet_points   = excluded.planet_points,
      research_points = excluded.research_points,
      planet_count    = excluded.planet_count
    returning p.id, p.name
  ),
  hist as (
    insert into player_history
      (player_id, seen_at, total_points, planet_points, research_points, planet_count)
    select u.id, now(), pr.total_points, pr.planet_points, pr.research_points, pr.planet_count
    from ups u
    join prev pr on pr.name = u.name
    where pr.old_id is null or pr.old_total is distinct from pr.total_points
    on conflict do nothing
    returning 1
  )
  select count(*) into v_changed from hist;

  -- Protokolliert wird nicht hier, sondern einmal pro Import über
  -- log_snapshot() — sonst bekäme jedes Häppchen eine eigene Zeile.

  return jsonb_build_object('rows', v_total, 'changed', v_changed);
end;
$$;

create or replace function public.ingest_planets(rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total   int := 0;
  v_changed int := 0;
begin
  select count(*) into v_total from jsonb_array_elements(rows);

  with src as (
    select distinct on (galaxy, system, "position") *
    from (
      select (r->>'galaxy')::int             as galaxy,
             (r->>'system')::int             as system,
             (r->>'position')::int           as "position",
             nullif(btrim(r->>'owner'), '')  as owner_name,
             (r->>'points')::bigint          as points,
             (r->>'rank')::int               as rank_pos
      from jsonb_array_elements(rows) r
    ) t
    where galaxy is not null and system is not null and "position" is not null
    order by galaxy, system, "position"
  ),
  prev as (
    select s.*, p.id as old_id, p.points as old_points, p.owner_name as old_owner
    from src s
    left join planets p
      on p.galaxy = s.galaxy and p.system = s.system and p."position" = s."position"
  ),
  ups as (
    insert into planets as p
      (galaxy, system, "position", owner_name, points, rank_pos,
       last_seen_at, points_unchanged_since)
    select galaxy, system, "position", owner_name, points, rank_pos, now(), now()
    from src
    on conflict (galaxy, system, "position") do update set
      rank_pos     = excluded.rank_pos,
      last_seen_at = now(),
      points_unchanged_since = case
        when p.points is distinct from excluded.points
          or p.owner_name is distinct from excluded.owner_name then now()
        else p.points_unchanged_since end,
      owner_name = excluded.owner_name,
      points     = excluded.points
    returning p.id, p.galaxy, p.system, p."position"
  ),
  hist as (
    insert into planet_history (planet_id, seen_at, points, owner_name)
    select u.id, now(), pr.points, pr.owner_name
    from ups u
    join prev pr
      on pr.galaxy = u.galaxy and pr.system = u.system and pr."position" = u."position"
    where pr.old_id is null
       or pr.old_points is distinct from pr.points
       or pr.old_owner is distinct from pr.owner_name
    on conflict do nothing
    returning 1
  )
  select count(*) into v_changed from hist;

  return jsonb_build_object('rows', v_total, 'changed', v_changed);
end;
$$;

-- Angriffsberichte archivieren. `changed` zählt die tatsächlich neuen
-- Berichte; alles, was schon im Archiv liegt, fällt am Unique-Index ab.
create or replace function public.ingest_farm_reports(rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int := 0;
  v_new   int := 0;
begin
  select count(*) into v_total from jsonb_array_elements(rows);

  with src as (
    select distinct on (origin, target, attacked_at) *
    from (
      select nullif(btrim(r->>'origin'), '')       as origin,
             nullif(btrim(r->>'target'), '')       as target,
             nullif(btrim(r->>'player'), '')       as target_player,
             (r->>'at')::timestamptz               as attacked_at,
             coalesce((r->>'iron')::bigint, 0)     as iron,
             coalesce((r->>'lutinum')::bigint, 0)  as lutinum,
             coalesce((r->>'water')::bigint, 0)    as water,
             coalesce((r->>'hydrogen')::bigint, 0) as hydrogen
      from jsonb_array_elements(rows) r
    ) t
    where origin is not null and target is not null and attacked_at is not null
    order by origin, target, attacked_at
  ),
  ins as (
    insert into farm_reports
      (origin, target, target_player, attacked_at, iron, lutinum, water, hydrogen)
    select origin, target, target_player, attacked_at, iron, lutinum, water, hydrogen
    from src
    on conflict (origin, target, attacked_at) do nothing
    returning 1
  )
  select count(*) into v_new from ins;

  return jsonb_build_object('rows', v_total, 'changed', v_new);
end;
$$;

-- Ein Import besteht aus mehreren Häppchen — die Zusammenfassung schreibt
-- der Client danach einmal mit den Gesamtzahlen.
create or replace function public.log_snapshot(kind text, rows int, changed int)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_id bigint;
begin
  insert into snapshots (kind, row_count, changed_count)
  values (kind, rows, changed)
  returning id into v_id;
  return v_id;
end;
$$;

-- ================================================ RPC: Farmverwaltung ====

-- Ziele in die Farmliste eines Planeten aufnehmen. Ein bereits abgelegtes
-- Ziel wird wiederbelebt und bekommt dabei ein neues `added_at` — die
-- Ertragsrechnung beginnt damit von vorn und misst nicht die Flaute aus der
-- Zeit, in der das Ziel gar nicht angeflogen wurde.
create or replace function public.roster_add(rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int := 0;
  v_new   int := 0;
begin
  select count(*) into v_total from jsonb_array_elements(rows);

  with src as (
    select distinct on (origin, target) *
    from (
      select nullif(btrim(r->>'origin'), '') as origin,
             nullif(btrim(r->>'target'), '') as target,
             nullif(btrim(r->>'player'), '') as target_player,
             nullif(btrim(r->>'note'), '')   as slot_note
      from jsonb_array_elements(rows) r
    ) t
    where origin ~ '^[0-9]+:[0-9]+:[0-9]+$'
      and target ~ '^[0-9]+:[0-9]+:[0-9]+$'
    order by origin, target
  ),
  ups as (
    insert into farm_roster as f (origin, target, target_player, slot_note)
    select origin, target, target_player, slot_note from src
    on conflict (origin, target) do update set
      target_player = coalesce(excluded.target_player, f.target_player),
      slot_note     = coalesce(excluded.slot_note, f.slot_note),
      -- Nur ein echtes Comeback setzt die Uhr zurück; ein doppelter Klick
      -- auf ein aktives Ziel darf die Statistik nicht löschen.
      added_at      = case when f.active then f.added_at else now() end,
      removed_at    = case when f.active then f.removed_at else null end,
      drop_reason   = case when f.active then f.drop_reason else null end,
      active        = true
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted) into v_new from ups;

  return jsonb_build_object('rows', v_total, 'changed', v_new);
end;
$$;

-- Ziele aus der Liste nehmen. Die Zeile bleibt stehen (mit Grund und
-- Zeitpunkt), damit die Historie erhalten bleibt.
create or replace function public.roster_remove(rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int := 0;
  v_hit   int := 0;
begin
  select count(*) into v_total from jsonb_array_elements(rows);

  with src as (
    select nullif(btrim(r->>'origin'), '') as origin,
           nullif(btrim(r->>'target'), '') as target,
           nullif(btrim(r->>'reason'), '') as drop_reason
    from jsonb_array_elements(rows) r
  ),
  upd as (
    update farm_roster f set
      active      = false,
      removed_at  = now(),
      drop_reason = coalesce(s.drop_reason, f.drop_reason)
    from src s
    where f.origin = s.origin and f.target = s.target and f.active
    returning 1
  )
  select count(*) into v_hit from upd;

  return jsonb_build_object('rows', v_total, 'changed', v_hit);
end;
$$;

-- Endgültig vergessen (nur für Fehleingaben gedacht).
create or replace function public.roster_forget(rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_hit int := 0;
begin
  with src as (
    select nullif(btrim(r->>'origin'), '') as origin,
           nullif(btrim(r->>'target'), '') as target
    from jsonb_array_elements(rows) r
  ),
  del as (
    delete from farm_roster f using src s
    where f.origin = s.origin and f.target = s.target
    returning 1
  )
  select count(*) into v_hit from del;
  return jsonb_build_object('rows', v_hit, 'changed', v_hit);
end;
$$;

-- Wie viele Farmen die Flotte dieses Planeten bedienen kann. Die Parameter
-- tragen ein Präfix, sonst hält Postgres `origin` für die Tabellenspalte.
create or replace function public.roster_set_slots(p_origin text, p_slots int, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into farm_slots as f (origin, slots, note, updated_at)
  values (p_origin, p_slots, p_note, now())
  on conflict (origin) do update set
    slots = excluded.slots,
    note = coalesce(excluded.note, f.note),
    updated_at = now();
  return jsonb_build_object('origin', p_origin, 'slots', p_slots);
end;
$$;

-- ================================================ Row Level Security ====

alter table public.players        enable row level security;
alter table public.planets        enable row level security;
alter table public.player_history enable row level security;
alter table public.planet_history enable row level security;
alter table public.snapshots      enable row level security;
alter table public.farm_reports   enable row level security;
alter table public.farm_roster    enable row level security;
alter table public.farm_slots     enable row level security;

-- Lesen nur für eingeloggte Nutzer. Schreiben hat *keine* Policy und ist
-- damit für jeden Client gesperrt — Importe laufen ausschließlich über die
-- security-definer-Funktionen oben.
do $$
declare t text;
begin
  foreach t in array array['players','planets','player_history','planet_history','snapshots','farm_reports','farm_roster','farm_slots'] loop
    execute format('drop policy if exists "read for authenticated" on public.%I', t);
    execute format('create policy "read for authenticated" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

-- Anonyme Besucher bekommen nichts — auch nicht über die Views.
revoke all on public.players, public.planets, public.player_history,
              public.planet_history, public.snapshots, public.farm_reports,
              public.farm_roster, public.farm_slots,
              public.inactive_farms, public.player_history_named,
              public.farm_loot_daily, public.farm_loot_targets,
              public.farm_roster_stats
  from anon;

grant select on public.players, public.planets, public.player_history,
                public.planet_history, public.snapshots, public.farm_reports,
                public.farm_roster, public.farm_slots,
                public.inactive_farms, public.player_history_named,
                public.farm_loot_daily, public.farm_loot_targets,
                public.farm_roster_stats
  to authenticated;

revoke execute on function public.ingest_players(jsonb) from public, anon;
revoke execute on function public.ingest_planets(jsonb) from public, anon;
revoke execute on function public.ingest_farm_reports(jsonb) from public, anon;
revoke execute on function public.log_snapshot(text, int, int) from public, anon;
grant  execute on function public.ingest_players(jsonb) to authenticated;
grant  execute on function public.ingest_planets(jsonb) to authenticated;
grant  execute on function public.ingest_farm_reports(jsonb) to authenticated;
grant  execute on function public.log_snapshot(text, int, int) to authenticated;

revoke execute on function public.roster_add(jsonb)      from public, anon;
revoke execute on function public.roster_remove(jsonb)   from public, anon;
revoke execute on function public.roster_forget(jsonb)   from public, anon;
revoke execute on function public.roster_set_slots(text,int,text) from public, anon;
grant  execute on function public.roster_add(jsonb)      to authenticated;
grant  execute on function public.roster_remove(jsonb)   to authenticated;
grant  execute on function public.roster_forget(jsonb)   to authenticated;
grant  execute on function public.roster_set_slots(text,int,text) to authenticated;
