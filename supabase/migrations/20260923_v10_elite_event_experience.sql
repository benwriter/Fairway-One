-- Fairway One V10 — Elite Event Experience
-- This migration mirrors the production schema change already applied.

create table if not exists public.event_scorecards (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  event_player_id uuid references public.event_players(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  scope text not null check (scope in ('player','team')),
  status text not null default 'playing' check (status in ('playing','awaiting_verification','final')),
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  marker_player_id uuid references public.event_players(id) on delete set null,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    (scope='player' and event_player_id is not null and team_id is null)
    or
    (scope='team' and team_id is not null and event_player_id is null)
  )
);

create unique index if not exists event_scorecards_player_uidx
  on public.event_scorecards(round_id,event_player_id)
  where scope='player';

create unique index if not exists event_scorecards_team_uidx
  on public.event_scorecards(round_id,team_id)
  where scope='team';

create index if not exists event_scorecards_marker_idx
  on public.event_scorecards(marker_player_id,status);

alter table public.event_scorecards enable row level security;

drop policy if exists event_scorecards_read on public.event_scorecards;
create policy event_scorecards_read
  on public.event_scorecards
  for select
  to authenticated
  using ((select private.can_access_round(round_id)));

revoke insert, update, delete on public.event_scorecards from anon, authenticated;
grant select on public.event_scorecards to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='event_scorecards'
  ) then
    alter publication supabase_realtime add table public.event_scorecards;
  end if;
end $$;

-- Lock submitted/final digital scorecards for normal players.
-- Organisers keep can_manage_round() override so corrections can be handled by reopening a card.
drop policy if exists scores_insert on public.scores;
drop policy if exists scores_update on public.scores;
drop policy if exists scores_delete on public.scores;

create policy scores_insert on public.scores for insert to authenticated
with check (
  (select private.can_manage_round(round_id)) or (
    exists (
      select 1 from public.rounds r
      join public.event_players ep on ep.event_id=r.event_id
      where r.id=scores.round_id and ep.id=scores.event_player_id and ep.user_id=(select auth.uid())
    ) and not exists (
      select 1 from public.event_scorecards c
      where c.round_id=scores.round_id and c.event_player_id=scores.event_player_id
        and c.status in ('awaiting_verification','final')
    )
  )
);

create policy scores_update on public.scores for update to authenticated
using (
  (select private.can_manage_round(round_id)) or (
    exists (
      select 1 from public.rounds r
      join public.event_players ep on ep.event_id=r.event_id
      where r.id=scores.round_id and ep.id=scores.event_player_id and ep.user_id=(select auth.uid())
    ) and not exists (
      select 1 from public.event_scorecards c
      where c.round_id=scores.round_id and c.event_player_id=scores.event_player_id
        and c.status in ('awaiting_verification','final')
    )
  )
)
with check (
  (select private.can_manage_round(round_id)) or (
    exists (
      select 1 from public.rounds r
      join public.event_players ep on ep.event_id=r.event_id
      where r.id=scores.round_id and ep.id=scores.event_player_id and ep.user_id=(select auth.uid())
    ) and not exists (
      select 1 from public.event_scorecards c
      where c.round_id=scores.round_id and c.event_player_id=scores.event_player_id
        and c.status in ('awaiting_verification','final')
    )
  )
);

create policy scores_delete on public.scores for delete to authenticated
using (
  (select private.can_manage_round(round_id)) or (
    exists (
      select 1 from public.rounds r
      join public.event_players ep on ep.event_id=r.event_id
      where r.id=scores.round_id and ep.id=scores.event_player_id and ep.user_id=(select auth.uid())
    ) and not exists (
      select 1 from public.event_scorecards c
      where c.round_id=scores.round_id and c.event_player_id=scores.event_player_id
        and c.status in ('awaiting_verification','final')
    )
  )
);

-- Shared team cards lock once final. The organiser can reopen the card before correction.
drop policy if exists team_scores_insert on public.team_scores;
drop policy if exists team_scores_update on public.team_scores;
drop policy if exists team_scores_delete on public.team_scores;

create policy team_scores_insert on public.team_scores for insert to authenticated
with check (
  (select private.can_manage_round(round_id)) or (
    exists (
      select 1 from public.rounds r
      join public.teams t on t.event_id=r.event_id
      join public.team_members tm on tm.team_id=t.id
      join public.event_players ep on ep.id=tm.event_player_id
      where r.id=team_scores.round_id and t.id=team_scores.team_id and ep.user_id=(select auth.uid())
    ) and not exists (
      select 1 from public.event_scorecards c
      where c.round_id=team_scores.round_id and c.team_id=team_scores.team_id and c.status='final'
    )
  )
);

create policy team_scores_update on public.team_scores for update to authenticated
using (
  (select private.can_manage_round(round_id)) or (
    exists (
      select 1 from public.rounds r
      join public.teams t on t.event_id=r.event_id
      join public.team_members tm on tm.team_id=t.id
      join public.event_players ep on ep.id=tm.event_player_id
      where r.id=team_scores.round_id and t.id=team_scores.team_id and ep.user_id=(select auth.uid())
    ) and not exists (
      select 1 from public.event_scorecards c
      where c.round_id=team_scores.round_id and c.team_id=team_scores.team_id and c.status='final'
    )
  )
)
with check (
  (select private.can_manage_round(round_id)) or (
    exists (
      select 1 from public.rounds r
      join public.teams t on t.event_id=r.event_id
      join public.team_members tm on tm.team_id=t.id
      join public.event_players ep on ep.id=tm.event_player_id
      where r.id=team_scores.round_id and t.id=team_scores.team_id and ep.user_id=(select auth.uid())
    ) and not exists (
      select 1 from public.event_scorecards c
      where c.round_id=team_scores.round_id and c.team_id=team_scores.team_id and c.status='final'
    )
  )
);

create policy team_scores_delete on public.team_scores for delete to authenticated
using (
  (select private.can_manage_round(round_id)) or (
    exists (
      select 1 from public.rounds r
      join public.teams t on t.event_id=r.event_id
      join public.team_members tm on tm.team_id=t.id
      join public.event_players ep on ep.id=tm.event_player_id
      where r.id=team_scores.round_id and t.id=team_scores.team_id and ep.user_id=(select auth.uid())
    ) and not exists (
      select 1 from public.event_scorecards c
      where c.round_id=team_scores.round_id and c.team_id=team_scores.team_id and c.status='final'
    )
  )
);

-- Ambrose selected-drive data is part of the team card and follows the same lock.
drop policy if exists ambrose_drives_insert on public.ambrose_drives;
drop policy if exists ambrose_drives_update on public.ambrose_drives;
drop policy if exists ambrose_drives_delete on public.ambrose_drives;

create policy ambrose_drives_insert on public.ambrose_drives for insert to authenticated
with check (
  (select private.can_manage_round(round_id)) or (
    exists (
      select 1 from public.rounds r
      join public.teams t on t.event_id=r.event_id
      join public.team_members tm on tm.team_id=t.id
      join public.event_players ep on ep.id=tm.event_player_id
      where r.id=ambrose_drives.round_id and t.id=ambrose_drives.team_id and ep.user_id=(select auth.uid())
    ) and not exists (
      select 1 from public.event_scorecards c
      where c.round_id=ambrose_drives.round_id and c.team_id=ambrose_drives.team_id and c.status='final'
    )
  )
);

create policy ambrose_drives_update on public.ambrose_drives for update to authenticated
using (
  (select private.can_manage_round(round_id)) or (
    exists (
      select 1 from public.rounds r
      join public.teams t on t.event_id=r.event_id
      join public.team_members tm on tm.team_id=t.id
      join public.event_players ep on ep.id=tm.event_player_id
      where r.id=ambrose_drives.round_id and t.id=ambrose_drives.team_id and ep.user_id=(select auth.uid())
    ) and not exists (
      select 1 from public.event_scorecards c
      where c.round_id=ambrose_drives.round_id and c.team_id=ambrose_drives.team_id and c.status='final'
    )
  )
)
with check (
  (select private.can_manage_round(round_id)) or (
    exists (
      select 1 from public.rounds r
      join public.teams t on t.event_id=r.event_id
      join public.team_members tm on tm.team_id=t.id
      join public.event_players ep on ep.id=tm.event_player_id
      where r.id=ambrose_drives.round_id and t.id=ambrose_drives.team_id and ep.user_id=(select auth.uid())
    ) and not exists (
      select 1 from public.event_scorecards c
      where c.round_id=ambrose_drives.round_id and c.team_id=ambrose_drives.team_id and c.status='final'
    )
  )
);

create policy ambrose_drives_delete on public.ambrose_drives for delete to authenticated
using (
  (select private.can_manage_round(round_id)) or (
    exists (
      select 1 from public.rounds r
      join public.teams t on t.event_id=r.event_id
      join public.team_members tm on tm.team_id=t.id
      join public.event_players ep on ep.id=tm.event_player_id
      where r.id=ambrose_drives.round_id and t.id=ambrose_drives.team_id and ep.user_id=(select auth.uid())
    ) and not exists (
      select 1 from public.event_scorecards c
      where c.round_id=ambrose_drives.round_id and c.team_id=ambrose_drives.team_id and c.status='final'
    )
  )
);
