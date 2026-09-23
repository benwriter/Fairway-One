-- Fairway One V11 — Elite Round advanced performance stats

alter table public.scores
  add column if not exists fairway_result text,
  add column if not exists green_in_regulation boolean,
  add column if not exists up_and_down boolean;

alter table public.team_scores
  add column if not exists fairway_result text,
  add column if not exists green_in_regulation boolean,
  add column if not exists up_and_down boolean;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'scores_fairway_result_check'
      and conrelid = 'public.scores'::regclass
  ) then
    alter table public.scores
      add constraint scores_fairway_result_check
      check (fairway_result is null or fairway_result in ('left','hit','right'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'team_scores_fairway_result_check'
      and conrelid = 'public.team_scores'::regclass
  ) then
    alter table public.team_scores
      add constraint team_scores_fairway_result_check
      check (fairway_result is null or fairway_result in ('left','hit','right'));
  end if;
end $$;
