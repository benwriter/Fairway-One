-- Fairway One: allow an authenticated owner to create and immediately read
-- their own event row. The client creates the event before adding event_members,
-- so a policy that relies only on membership rejects the first upsert.
drop policy if exists events_owner_insert on public.events;
create policy events_owner_insert on public.events
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists events_owner_select on public.events;
create policy events_owner_select on public.events
  for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists events_owner_update on public.events;
create policy events_owner_update on public.events
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
