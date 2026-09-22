# Fairway One — Functional Prototype V5.2

Version 5.1 builds on the first major product/design milestone for Fairway One.

It keeps the working V4 scoring, event and cloud foundation, but moves the visual direction toward the premium mobile mock-up selected as the Fairway One design reference. It also introduces the first working **Build Your Round** engine.

## V5 visual direction

The Home screen now follows the premium reference more closely:

- Large Fairway One wordmark and flag/fairway mark
- PLAY · COMPETE · TOGETHER brand line
- Player/profile badge in the header
- Scenic golf-course live-round hero card
- Gold primary Resume Round action
- Premium stat blocks and event chips
- Four-card format engine: Individual, Team, Match Play and Custom
- Consistent premium bottom navigation icons
- New matching installed-app icon

The inner screens retain the same working structure, with V4.3's balanced mobile sizing so the scoring controls remain practical on an iPhone.

## 16 standalone formats

1. Stroke Play
2. Stableford
3. Match Play
4. Par / Bogey
5. Modified Stableford
6. Skins
7. Four-Ball Stableford
8. Four-Ball Match Play
9. Best Ball
10. Team Aggregate
11. Best 2 of 4
12. Ambrose / Scramble
13. Foursomes
14. Greensomes
15. Chapman / Pinehurst
16. Shamble

## New: Build Your Round

A custom event can now be split however the organiser wants.

The organiser can:

- Create as many segments as required, up to 18
- Give each segment a name
- Choose one of the 16 scoring formats for each segment
- Assign any combination of holes to each segment
- Reassign holes between segments by tapping them
- Give each segment a competition-points value for future event aggregation

Example:

- Holes 1–4: Ambrose
- Holes 5–8: Four-Ball Stableford
- Hole 9: Match Play
- Holes 10–15: Stableford
- Holes 16–18: Foursomes

The live scorecard looks up the active segment for the current hole and changes the required score entry automatically. Shared-ball formats use team scores; individual formats use player scores; drive-selection formats keep their existing selected-drive tracking.

The Scores tab shows a live segment board for custom events.

## Cloud / Supabase

Fairway One V5 uses the existing dedicated Fairway One Supabase project in Sydney. The backend is completely separate from Writer Cup.

V5 adds a real `round_segments` table with Row Level Security. Custom segment definitions therefore sync to Fairway One Cloud rather than existing only in local browser storage.

The latest Supabase security advisor check after the V5 migration reports no security findings.

## Deployment

Upload the **contents of this folder** to the root of the `Fairway-One` GitHub repository. Vercel should redeploy automatically from `main`.

Because V5 changes the PWA icon and service-worker cache, remove the existing Fairway One Home Screen shortcut after deployment and add it again from Safari to ensure iOS picks up the new icon.

## Testing priorities

1. Check the V5 Home screen against the premium reference image.
2. Resume the demo round and confirm the scoring controls still fit comfortably.
3. Create a normal Stableford event and complete several holes.
4. Create a **Build Your Round** event.
5. Add multiple segments and move holes between them.
6. Include both an individual and a team/shared-ball format in the same custom round.
7. Move through the scorecard and confirm the entry UI changes with the active format.
8. Check the custom Segment Board in Scores.
9. If signed in, sync the custom event to Fairway One Cloud and reload it.

## Important prototype note

V5 stores a competition-points value for each custom segment and shows segment leaders, but it does not yet force a single overall winner when a custom event mixes fundamentally different participant units, such as individual Match Play and team Ambrose. That aggregation layer should be designed deliberately rather than inventing an arbitrary rule.


## V5.1 — Custom segment results and competition points

Build Your Round now derives a final result for each completed custom segment. The segment's configured competition points are awarded to the winner, or split evenly between tied winners. These awards are then totalled into an Overall Event Score.

This calculation applies only to `format: custom`. Standalone Stroke, Stableford, Match Play, Ambrose and the other full-round formats are unchanged. Segment points are derived from the underlying scores, so editing a hole automatically recalculates the segment result and overall event score.


## V5.2 fix
- Locks mobile navigation to vertical scrolling and removes unintended horizontal page drift/bounce.
- Constrains premium home cards, event cards, and masthead content to the viewport width.
- Keeps pinch zoom while preventing horizontal panning of the app shell.
