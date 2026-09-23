-- Fairway One V12 — Tournament Ready
-- Idempotent operational hardening over the V10/V11 schema.

alter table public.events
  add column if not exists registration_open boolean not null default true,
  add column if not exists scoring_locked boolean not null default false,
  add column if not exists results_published boolean not null default false,
  add column if not exists spectator_enabled boolean not null default true,
  add column if not exists spectator_code text;

update public.events
set spectator_code = upper(substr(md5(id::text || gen_random_uuid()::text || clock_timestamp()::text),1,16))
where spectator_code is null or char_length(spectator_code) < 16;

alter table public.events alter column spectator_code set not null;
alter table public.events alter column spectator_code set default upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text),1,16));
alter table public.events alter column join_code set default upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text),1,12));

update public.events
set join_code = upper(substr(md5(id::text || gen_random_uuid()::text || clock_timestamp()::text),1,12))
where char_length(join_code) < 12;

create unique index if not exists events_spectator_code_uidx on public.events(spectator_code);

alter table public.event_players add column if not exists claimed_at timestamptz;
update public.event_players set claimed_at=coalesce(claimed_at,created_at) where user_id is not null and claimed_at is null;

alter table public.event_groups
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists last_activity_at timestamptz;

create table if not exists public.event_announcements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 500),
  kind text not null default 'info' check (kind in ('info','important')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists event_announcements_event_created_idx on public.event_announcements(event_id,created_at desc);
alter table public.event_announcements enable row level security;
drop policy if exists event_announcements_read on public.event_announcements;
create policy event_announcements_read on public.event_announcements for select to authenticated using ((select private.can_access_event(event_id)));
drop policy if exists event_announcements_insert on public.event_announcements;
create policy event_announcements_insert on public.event_announcements for insert to authenticated with check ((select private.can_manage_event(event_id)));
drop policy if exists event_announcements_update on public.event_announcements;
create policy event_announcements_update on public.event_announcements for update to authenticated using ((select private.can_manage_event(event_id))) with check ((select private.can_manage_event(event_id)));
drop policy if exists event_announcements_delete on public.event_announcements;
create policy event_announcements_delete on public.event_announcements for delete to authenticated using ((select private.can_manage_event(event_id)));
grant select,insert,update,delete on public.event_announcements to authenticated;

create table if not exists public.event_audit_log (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  reason text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists event_audit_log_event_created_idx on public.event_audit_log(event_id,created_at desc);
alter table public.event_audit_log enable row level security;
drop policy if exists event_audit_log_read on public.event_audit_log;
create policy event_audit_log_read on public.event_audit_log for select to authenticated using ((select private.can_manage_event(event_id)));
revoke insert,update,delete on public.event_audit_log from authenticated,anon;
grant select on public.event_audit_log to authenticated;

create or replace function private.event_scoring_open(p_round_id uuid)
returns boolean language sql stable security definer set search_path=public,private as $$
  select coalesce((select not e.scoring_locked from public.rounds r join public.events e on e.id=r.event_id where r.id=p_round_id),false);
$$;
revoke all on function private.event_scoring_open(uuid) from public;
grant execute on function private.event_scoring_open(uuid) to authenticated;

-- Individual score writes: organiser override, or linked golfer while scoring is open and card is not submitted/final.
drop policy if exists scores_insert on public.scores;
drop policy if exists scores_update on public.scores;
drop policy if exists scores_delete on public.scores;
create policy scores_insert on public.scores for insert to authenticated with check (
  (select private.can_manage_round(round_id)) or (
    (select private.event_scoring_open(round_id)) and
    exists (select 1 from public.rounds r join public.event_players ep on ep.event_id=r.event_id where r.id=scores.round_id and ep.id=scores.event_player_id and ep.user_id=(select auth.uid())) and
    not exists (select 1 from public.event_scorecards c where c.round_id=scores.round_id and c.event_player_id=scores.event_player_id and c.status in ('awaiting_verification','final'))
  )
);
create policy scores_update on public.scores for update to authenticated using (
  (select private.can_manage_round(round_id)) or (
    (select private.event_scoring_open(round_id)) and
    exists (select 1 from public.rounds r join public.event_players ep on ep.event_id=r.event_id where r.id=scores.round_id and ep.id=scores.event_player_id and ep.user_id=(select auth.uid())) and
    not exists (select 1 from public.event_scorecards c where c.round_id=scores.round_id and c.event_player_id=scores.event_player_id and c.status in ('awaiting_verification','final'))
  )
) with check (
  (select private.can_manage_round(round_id)) or (
    (select private.event_scoring_open(round_id)) and
    exists (select 1 from public.rounds r join public.event_players ep on ep.event_id=r.event_id where r.id=scores.round_id and ep.id=scores.event_player_id and ep.user_id=(select auth.uid())) and
    not exists (select 1 from public.event_scorecards c where c.round_id=scores.round_id and c.event_player_id=scores.event_player_id and c.status in ('awaiting_verification','final'))
  )
);
create policy scores_delete on public.scores for delete to authenticated using (
  (select private.can_manage_round(round_id)) or (
    (select private.event_scoring_open(round_id)) and
    exists (select 1 from public.rounds r join public.event_players ep on ep.event_id=r.event_id where r.id=scores.round_id and ep.id=scores.event_player_id and ep.user_id=(select auth.uid())) and
    not exists (select 1 from public.event_scorecards c where c.round_id=scores.round_id and c.event_player_id=scores.event_player_id and c.status in ('awaiting_verification','final'))
  )
);

-- Shared team score writes obey the same tournament scoring lock.
drop policy if exists team_scores_insert on public.team_scores;
drop policy if exists team_scores_update on public.team_scores;
drop policy if exists team_scores_delete on public.team_scores;
create policy team_scores_insert on public.team_scores for insert to authenticated with check (
  (select private.can_manage_round(round_id)) or (
    (select private.event_scoring_open(round_id)) and
    exists (select 1 from public.rounds r join public.teams t on t.event_id=r.event_id join public.team_members tm on tm.team_id=t.id join public.event_players ep on ep.id=tm.event_player_id where r.id=team_scores.round_id and t.id=team_scores.team_id and ep.user_id=(select auth.uid())) and
    not exists (select 1 from public.event_scorecards c where c.round_id=team_scores.round_id and c.team_id=team_scores.team_id and c.status='final')
  )
);
create policy team_scores_update on public.team_scores for update to authenticated using (
  (select private.can_manage_round(round_id)) or (
    (select private.event_scoring_open(round_id)) and
    exists (select 1 from public.rounds r join public.teams t on t.event_id=r.event_id join public.team_members tm on tm.team_id=t.id join public.event_players ep on ep.id=tm.event_player_id where r.id=team_scores.round_id and t.id=team_scores.team_id and ep.user_id=(select auth.uid())) and
    not exists (select 1 from public.event_scorecards c where c.round_id=team_scores.round_id and c.team_id=team_scores.team_id and c.status='final')
  )
) with check (
  (select private.can_manage_round(round_id)) or (
    (select private.event_scoring_open(round_id)) and
    exists (select 1 from public.rounds r join public.teams t on t.event_id=r.event_id join public.team_members tm on tm.team_id=t.id join public.event_players ep on ep.id=tm.event_player_id where r.id=team_scores.round_id and t.id=team_scores.team_id and ep.user_id=(select auth.uid())) and
    not exists (select 1 from public.event_scorecards c where c.round_id=team_scores.round_id and c.team_id=team_scores.team_id and c.status='final')
  )
);
create policy team_scores_delete on public.team_scores for delete to authenticated using (
  (select private.can_manage_round(round_id)) or (
    (select private.event_scoring_open(round_id)) and
    exists (select 1 from public.rounds r join public.teams t on t.event_id=r.event_id join public.team_members tm on tm.team_id=t.id join public.event_players ep on ep.id=tm.event_player_id where r.id=team_scores.round_id and t.id=team_scores.team_id and ep.user_id=(select auth.uid())) and
    not exists (select 1 from public.event_scorecards c where c.round_id=team_scores.round_id and c.team_id=team_scores.team_id and c.status='final')
  )
);

-- Selected-drive writes are also frozen with scoring.
drop policy if exists ambrose_drives_insert on public.ambrose_drives;
drop policy if exists ambrose_drives_update on public.ambrose_drives;
drop policy if exists ambrose_drives_delete on public.ambrose_drives;
create policy ambrose_drives_insert on public.ambrose_drives for insert to authenticated with check (
  (select private.can_manage_round(round_id)) or (
    (select private.event_scoring_open(round_id)) and
    exists (select 1 from public.rounds r join public.teams t on t.event_id=r.event_id join public.team_members tm on tm.team_id=t.id join public.event_players ep on ep.id=tm.event_player_id where r.id=ambrose_drives.round_id and t.id=ambrose_drives.team_id and ep.user_id=(select auth.uid())) and
    not exists (select 1 from public.event_scorecards c where c.round_id=ambrose_drives.round_id and c.team_id=ambrose_drives.team_id and c.status='final')
  )
);
create policy ambrose_drives_update on public.ambrose_drives for update to authenticated using (
  (select private.can_manage_round(round_id)) or (
    (select private.event_scoring_open(round_id)) and
    exists (select 1 from public.rounds r join public.teams t on t.event_id=r.event_id join public.team_members tm on tm.team_id=t.id join public.event_players ep on ep.id=tm.event_player_id where r.id=ambrose_drives.round_id and t.id=ambrose_drives.team_id and ep.user_id=(select auth.uid())) and
    not exists (select 1 from public.event_scorecards c where c.round_id=ambrose_drives.round_id and c.team_id=ambrose_drives.team_id and c.status='final')
  )
) with check (
  (select private.can_manage_round(round_id)) or (
    (select private.event_scoring_open(round_id)) and
    exists (select 1 from public.rounds r join public.teams t on t.event_id=r.event_id join public.team_members tm on tm.team_id=t.id join public.event_players ep on ep.id=tm.event_player_id where r.id=ambrose_drives.round_id and t.id=ambrose_drives.team_id and ep.user_id=(select auth.uid())) and
    not exists (select 1 from public.event_scorecards c where c.round_id=ambrose_drives.round_id and c.team_id=ambrose_drives.team_id and c.status='final')
  )
);
create policy ambrose_drives_delete on public.ambrose_drives for delete to authenticated using (
  (select private.can_manage_round(round_id)) or (
    (select private.event_scoring_open(round_id)) and
    exists (select 1 from public.rounds r join public.teams t on t.event_id=r.event_id join public.team_members tm on tm.team_id=t.id join public.event_players ep on ep.id=tm.event_player_id where r.id=ambrose_drives.round_id and t.id=ambrose_drives.team_id and ep.user_id=(select auth.uid())) and
    not exists (select 1 from public.event_scorecards c where c.round_id=ambrose_drives.round_id and c.team_id=ambrose_drives.team_id and c.status='final')
  )
);

create or replace function private.touch_tournament_group()
returns trigger language plpgsql security definer set search_path=public,private as $$
declare
  v_round_id uuid := coalesce(new.round_id,old.round_id);
  v_player_id uuid := coalesce(new.event_player_id,old.event_player_id);
  v_event_id uuid;
  v_hole_count integer;
begin
  select r.event_id,e.hole_count into v_event_id,v_hole_count
  from public.rounds r join public.events e on e.id=r.event_id
  where r.id=v_round_id and e.event_mode='tournament';
  if v_event_id is null then return coalesce(new,old); end if;

  update public.events set status=case when status='draft' then 'live' else status end,updated_at=now() where id=v_event_id;
  update public.rounds set status=case when status='not_started' then 'live' else status end,started_at=coalesce(started_at,now()),updated_at=now() where id=v_round_id;

  update public.event_groups g
  set last_activity_at=now(),updated_at=now(),
      status=case when not exists (
        select 1 from public.event_group_members gm
        where gm.group_id=g.id and (
          select count(*) from public.scores s
          where s.round_id=v_round_id and s.event_player_id=gm.event_player_id and s.is_confirmed=true
        ) < v_hole_count
      ) then 'completed' else 'live' end
  where g.event_id=v_event_id and exists (
    select 1 from public.event_group_members gm where gm.group_id=g.id and gm.event_player_id=v_player_id
  );
  return coalesce(new,old);
end;
$$;

drop trigger if exists scores_touch_tournament_group on public.scores;
create trigger scores_touch_tournament_group after insert or update or delete on public.scores for each row execute function private.touch_tournament_group();

-- Add live operational tables to realtime only when they are not already present.
do $$
declare t text;
begin
  foreach t in array array['events','event_players','event_groups','event_announcements'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end $$;

-- Cover foreign keys used by tournament operations and card control.
create index if not exists event_announcements_created_by_idx on public.event_announcements(created_by);
create index if not exists event_audit_log_actor_user_id_idx on public.event_audit_log(actor_user_id);
create index if not exists event_scorecards_event_player_id_idx on public.event_scorecards(event_player_id);
create index if not exists event_scorecards_submitted_by_idx on public.event_scorecards(submitted_by);
create index if not exists event_scorecards_team_id_idx on public.event_scorecards(team_id);
create index if not exists event_scorecards_verified_by_idx on public.event_scorecards(verified_by);
create index if not exists scorecard_signoffs_event_player_id_idx on public.scorecard_signoffs(event_player_id);
