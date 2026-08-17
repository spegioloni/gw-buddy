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

-- Nachträglich erweiterbar, ohne die Tabelle neu anzulegen.
alter table public.snapshots drop constraint if exists snapshots_kind_check;
alter table public.snapshots add constraint snapshots_kind_check
  check (kind in ('spieler', 'planeten', 'farmberichte'));

-- ============================================================== Views ====

-- security_invoker: die View rechnet mit den Rechten des Aufrufers, damit
-- Row Level Security der Basistabellen auch hier greift.

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
  pl.last_seen_at as planet_last_seen_at
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

-- ================================================ Row Level Security ====

alter table public.players        enable row level security;
alter table public.planets        enable row level security;
alter table public.player_history enable row level security;
alter table public.planet_history enable row level security;
alter table public.snapshots      enable row level security;
alter table public.farm_reports   enable row level security;

-- Lesen nur für eingeloggte Nutzer. Schreiben hat *keine* Policy und ist
-- damit für jeden Client gesperrt — Importe laufen ausschließlich über die
-- security-definer-Funktionen oben.
do $$
declare t text;
begin
  foreach t in array array['players','planets','player_history','planet_history','snapshots','farm_reports'] loop
    execute format('drop policy if exists "read for authenticated" on public.%I', t);
    execute format('create policy "read for authenticated" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

-- Anonyme Besucher bekommen nichts — auch nicht über die Views.
revoke all on public.players, public.planets, public.player_history,
              public.planet_history, public.snapshots, public.farm_reports,
              public.inactive_farms, public.player_history_named,
              public.farm_loot_daily, public.farm_loot_targets
  from anon;

grant select on public.players, public.planets, public.player_history,
                public.planet_history, public.snapshots, public.farm_reports,
                public.inactive_farms, public.player_history_named,
                public.farm_loot_daily, public.farm_loot_targets
  to authenticated;

revoke execute on function public.ingest_players(jsonb) from public, anon;
revoke execute on function public.ingest_planets(jsonb) from public, anon;
revoke execute on function public.ingest_farm_reports(jsonb) from public, anon;
revoke execute on function public.log_snapshot(text, int, int) from public, anon;
grant  execute on function public.ingest_players(jsonb) to authenticated;
grant  execute on function public.ingest_planets(jsonb) to authenticated;
grant  execute on function public.ingest_farm_reports(jsonb) to authenticated;
grant  execute on function public.log_snapshot(text, int, int) to authenticated;
