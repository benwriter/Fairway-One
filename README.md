# Fairway One V12 — Tournament Ready

V12 keeps the V11 Elite Round experience intact and hardens the V10 tournament architecture for real event operations.

## Tournament operations

- **Tournament Control.** Organisers now have one command centre for registration, scoring locks, player/account readiness, card verification, official score corrections, announcements, spectator access, CSV export and final result publishing.
- **Field readiness.** See how many entrants have linked accounts, completed 18 holes, are awaiting verification and have final signed cards.
- **Registration control.** Close player registration once the field is set. Existing members can still resume their event, while new joins are blocked until registration reopens.
- **Scoring lock.** Freeze player scoring at database-policy level. Organisers retain controlled correction access.
- **Official corrections + audit trail.** Organiser score overrides require a reason and store before/after information in the event audit log.
- **Player claim recovery.** An organiser can release an incorrect account/player link and allow the correct golfer to claim it again. Final cards must be reopened first.
- **Tournament announcements.** Important or normal updates appear on player event passes and the spectator view.
- **Publish / reopen results.** Publishing closes registration, locks scoring and marks the event and round complete. Incomplete cards or cards awaiting verification block publication.
- **Results export.** Tournament Control can export a field CSV with H1–H18, gross, net, relation to par, Stableford and card state.

## Live reliability

- **Concurrent score protection.** An organiser device no longer rewrites the entire tournament field when it syncs. Only score rows actually changed on that organiser device are written.
- **Server-owned group activity.** Tournament group status and last activity are updated server-side as confirmed scores arrive, reducing stale-device conflicts.
- **Realtime operations.** Events, players, groups, announcements, scorecards and scoring tables participate in live updates.
- **Offline recovery.** Pending cloud changes are persisted locally. Reconnect attempts flush local scoring changes before accepting a fresh remote state.
- **Automatic live state.** The first tournament scoring activity can promote the event/round into live state server-side.
- **Structural-change guard.** Once a tournament is live, Fairway One asks the organiser to lock scoring before changing field/group/course setup.
- **Race-safe player claiming.** Two accounts attempting to claim the same player entry at the same moment cannot overwrite one another.

## Spectator experience

Tournament organisers can issue a separate **spectator link + QR code**. It is deliberately different from the player join link.

The public view exposes only tournament-safe information: event/course details, display names, handicaps, groups, confirmed scores, card status, announcements and live/final standings. It exposes no email addresses, account IDs, player join code or scoring controls. The spectator link can be disabled or rotated by the organiser.

## Security model

- Player scoring remains protected by Row Level Security.
- Linked golfers can write only their own individual scores.
- Team members can write only their shared team score where applicable.
- Submitted/final scorecards remain locked.
- The tournament scoring lock blocks ordinary score writes while allowing controlled organiser corrections.
- Tournament audit rows are readable only by event managers and writable only by trusted server-side functions.
- Admin tournament actions run through authenticated Edge Functions.
- The spectator endpoint is read-only and uses a separate high-entropy spectator code.
- New player join codes use a longer 12-character token.

## V11 retained

Elite live scoring, personal performance, Course Memory, Round Recap, course records, rival history, advanced stats, social side competitions, 16 standalone formats and Build Your Round remain included.

## Before a major event

V12 is feature-complete for the intended tournament workflow, but a production tournament should still have a dress rehearsal. Test at least 6–8 separate accounts/devices across multiple groups: join, claim, simultaneous score entry, temporary offline scoring, reconnect, marker verification, official correction, scoring lock, spectator view, publish results and CSV export.

## Cache / storage

V12 uses the `fairway-one-v12` service-worker cache and `fairwayOneV12` local-storage key. V11 and earlier local state is migrated forward.

## Final event-day hardening pass

The final V12 pass adds several protections that matter in a real field:

- Tournaments are created in **Setup** state. Opening a scorecard does not prematurely freeze the event structure; the first synced score promotes the tournament to Live server-side.
- The organiser command centre now includes an **Event-day preflight** for course/index integrity, valid groups, cloud/join-code readiness, linked-player coverage and pending-sync/connection warnings.
- Tee-time groups are balanced automatically to avoid accidental one-player groups. Two-player grouping requires an even field.
- Shotgun groups must have unique starting holes before the tournament can be saved.
- Tournament stroke indexes are validated as a complete unique 1–18 set before saving.
- Duplicate display names are blocked at tournament setup so players cannot accidentally claim an ambiguous roster entry.
- Withdrawn, DQ and no-show players no longer block group completion; group state refreshes immediately when a competition status changes.
- Final result publication now requires every **active** player scorecard to be final, not merely complete.
- Organisers have an audited **Finalize card** fallback for a completed scorecard that has been checked outside the standard player/marker workflow, such as a verified paper card.
- Spectator pages distinguish pre-event **Upcoming** state from Live and Final Results.
