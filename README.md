## 27 September cloud and mobile scoring fix

- Applied owner insert/select/update policies to the dedicated Fairway One database. Existing queued events can now retry sync.
- Applied score and team-score constraints accepting zero as the pickup marker. Existing 1–30 strokes remain valid.
- Mobile stats controls use two columns so full-size buttons stay inside the scorecard.
- Unentered scores display the hole par as a starting value; tap the number to save par or use +/− to adjust. Displaying par alone does not record a score.

## 27 September update: pickup cap and nine-hole handicap entry

- A 9-hole round completes when all nine holes have been confirmed. Hole 9 alone does not finish the round if an earlier hole is still unconfirmed; the scorecard shows what remains.
- A Stableford pickup is stored as a distinct pickup marker (zero Stableford points). The scorecard shows the net double bogey cap followed by `*`: hole par + 2 + that player's strokes received on the hole. The adjusted gross total is starred too, and is not a holed-out stroke score. For example, par 4 with two strokes displays `8*` and 0 points.
- New nine-hole rounds offer two setup choices. Enter the normal **18-hole playing/daily handicap** to estimate a nine-hole allowance by halving and rounding, or enter the course's **official 9-hole playing/daily handicap** directly. The course's official value can differ because its rating and slope matter. The scorecard applies that nine-hole allowance to indexes 1–9.
- Existing nine-hole rounds without this setting keep the previously stored nine-hole playing handicap; their points are not silently recalculated. The selected mode and original 18-hole figure are carried through cloud round settings and player fields for new synced rounds.
- Cloud join links still require successful event sync. This package does not prove the observed pending cloud event is fixed.

---

## Nine-hole field test fixes (27 September 2026)

- Nine-hole playing handicaps are entered for the chosen nine; no extra halving. Plus handicaps such as +2 use -2 in the player handicap box.
- Larger putts, sand, penalties, fairway, GIR and up/down controls on phones.
- Live Impact Total Strokes displays the signed-in golfer’s gross total. If they pick up, it shows no complete gross total and explains why.
- The scorecard displays remaining unconfirmed holes, a finish label when the last hole is ready, and takes the scorer to the next unfinished hole. Saving locally is explicitly labelled.
- The sync banner shows the last error and offers Retry sync. Players join through Events → My Event → Player invite, after the organiser’s event is synced.
- Live cloud sync and joining still require testing with two distinct signed-in devices. A persistent Sync pending warning means the event is not yet available for others to join.

---

## V12 update: nine-hole rounds

In **Create Round → Course → Holes**, choose **9 holes** or **18 holes**. A nine-hole course has holes 1–9, with stroke indexes 1–9. Hole setup includes par, stroke index and distance in metres. This works with individual, team and custom round formats; custom segments and the scorecard follow the selected number of holes. The round completes after hole 9, and course records distinguish nine-hole rounds from eighteen-hole rounds. Enter the playing handicap for the selected nine holes. It is allocated directly across stroke indexes 1–9 and is never halved again. For a player whose nine-hole playing handicap is 12, indexes 1–3 receive two strokes and indexes 4–9 receive one. A plus-two playing handicap is entered as -2 and gives back one stroke on indexes 9 and 8. Tournament setup remains eighteen holes.

Once scoring starts, the hole count is locked to protect existing scores. Cloud rounds save `hole_count` and only the selected `round_holes`; switching an unscored synced round to nine holes removes old holes 10–18 on the next sync. The cloud scorecard service was not tested against a live database in this package.

Validation: JavaScript syntax and isolated checks for switching nine/eighteen holes, custom segments, stroke indexes, hole progression, Stableford scoring and pickups passed.

---

## V12 update: Stableford pickups

- Tap **Pick Up / Wipe** for 0 points. The card displays **P/U**, distinct from an unentered hole.
- Available in Stableford, Four-Ball Stableford and Modified Stableford, including custom-round segments and tournaments. Modified Stableford pickups use the requested zero-point convention; holed-out scores retain the existing modified points table.
- Confirm the hole normally. Tap the score to replace a pickup with par, use +/- to adjust, or × to clear it.
- Pickups do not count as zero-stroke eagles or qualify for gross records. Gross totals are unavailable when a round contains a pickup.

### Installation for cloud scoring

The pickup constraint is now applied to the dedicated Fairway One project. The frontend continues using the existing score sync and spectator payloads. Do not run Fairway One migrations against Writer Cup.

The equivalent migration is included in `supabase/migrations/20260927_allow_pickup_zero_scores.sql` for reproducibility. The separately deployed tournament-admin Edge Function is not included in the original V12 ZIP. Its official override endpoint may still require positive gross scores: to change a finalized card to a pickup, reopen the card and use normal Pick Up entry, then finalize again.

Validation: JavaScript syntax and automated scoring/UI-handler checks passed for zero points, handicaps, team best-ball, missing versus picked-up holes, editing/clearing, locked cards and local JSON persistence. Live cloud and browser end-to-end checks have not been performed.

---

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

## V12.3 distance and cloud-policy fix

- Event and tournament setup now accepts an optional distance in metres for every hole. It is already carried through to the live scorecard and cloud `distance_m` fields.
- The screenshot error `new row violates row-level security policy for table "events"` is caused by the initial event upsert happening before the owner is inserted into `event_members`. The owner policy in `supabase/migrations/20260924_fix_owner_event_rls.sql` was applied to the dedicated Fairway One database on 27 September 2026. Queued local events should sync on the next retry.
- Adding 18 distance values is negligible for Luna usage. It is a small UI/data change, not an AI generation or large model task. Luna usage is driven by the coding session itself, not by the metres stored in the app.
