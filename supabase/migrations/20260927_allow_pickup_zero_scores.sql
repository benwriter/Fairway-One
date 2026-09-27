-- A pickup is stored as zero. Ordinary hole scores remain limited to 1–30.
-- Applied to the dedicated Fairway One database on 27 September 2026.
alter table public.scores drop constraint scores_gross_strokes_check;
alter table public.scores add constraint scores_gross_strokes_check check (gross_strokes between 0 and 30);
alter table public.team_scores drop constraint team_scores_gross_strokes_check;
alter table public.team_scores add constraint team_scores_gross_strokes_check check (gross_strokes between 0 and 30);
