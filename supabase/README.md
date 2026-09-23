# Fairway One Cloud

Fairway One uses its dedicated Supabase project for authentication, profiles, courses, events, tournament groups, teams, rounds, scores and realtime state.

## V12 Tournament Ready

V12 adds an operational layer around the existing tournament scoring model.

### Event operations
- `events.registration_open` controls new player joins.
- `events.scoring_locked` freezes ordinary player/team score writes at RLS level.
- `events.results_published` records final publication state.
- `events.spectator_enabled` and `events.spectator_code` power the separate read-only public tournament view.
- `event_players.claimed_at` records account/player linking time.
- `event_groups.last_activity_at` and `updated_at` support group monitoring.

### Announcements and audit
- `event_announcements` stores organiser messages shown to players and spectators.
- `event_audit_log` records operational actions such as joins, claims, card transitions, score corrections, locks and result publication.
- Audit writes are server-side only. Event managers may read their event audit log.

### Edge Functions
- `join-event`: join + race-safe player claim, with registration enforcement and audit logging.
- `scorecard-action`: submit, verify and reopen digital scorecards, with audit logging.
- `tournament-admin`: authenticated organiser-only controls for registration, scoring lock, spectator access, announcements, claim release, official score corrections, results publish/reopen.
- `tournament-public`: read-only spectator snapshot using a separate spectator token. It deliberately returns no account IDs, emails, player join code or write capabilities.

### Realtime and concurrency
- Scores, team scores, scorecards, rounds, events, players, groups and announcements are included in realtime updates.
- Live organiser sync writes only score rows explicitly changed on that organiser device. It does not rewrite the whole tournament field.
- Tournament group activity/status is maintained server-side as confirmed player scores arrive.
- First tournament scoring activity moves a draft tournament/round to live state server-side.

## V10 / V11 retained

V10 introduced account-linked joining, `event_scorecards`, marker verification and digital-card locking. V11 added optional `fairway_result`, `green_in_regulation` and `up_and_down` score fields.

Row Level Security remains enabled for exposed tables. Secret/service credentials must never be shipped in frontend code.

### Final V12 hardening
- New tournaments remain `draft` until first scoring activity. The server-side scoring trigger promotes them to `live`.
- Group completion checks ignore players whose `competition_status` is not `active`.
- A player-status trigger immediately recalculates their group when an organiser marks WD, DQ, NS or restores Active.
- Result publication requires a `final` digital card for every active player.
- `tournament-admin.finalize_player_card` gives the organiser an audited fallback for a completed card checked outside the normal marker flow.
