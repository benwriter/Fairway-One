-- Run once in the dedicated Fairway One project's SQL editor before uploading this app.
-- Zero is a pickup marker, not a gross stroke count. Existing RLS is unchanged.
begin;
do $$
declare c record; gross_att smallint;
begin
  select attnum into strict gross_att from pg_attribute
    where attrelid='public.scores'::regclass and attname='gross_strokes' and not attisdropped;
  -- Extend only checks exclusively concerning gross_strokes; preserve original bounds.
  for c in select conname, pg_get_expr(conbin,conrelid) as expression
    from pg_constraint where conrelid='public.scores'::regclass and contype='c'
      and conkey=array[gross_att]::smallint[]
  loop
    execute format('alter table public.scores drop constraint %I',c.conname);
    execute format('alter table public.scores add constraint %I check (gross_strokes = 0 or (%s))',c.conname,c.expression);
  end loop;
end $$;
commit;
