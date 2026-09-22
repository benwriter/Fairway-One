# Fairway One V9.1

V9.1 is a focused mobile polish release on top of V9.

- The Home profile badge now displays the golfer’s uploaded profile photo, with centred initials only as a fallback.
- Start Round / setup sheets are locked to vertical scrolling so diagonal iOS swipes cannot make the sheet drift sideways.
- Cache versions are bumped so installed PWAs receive the fixes promptly.

Fairway One V9 makes cloud events account-linked and gives each golfer their own scorecard while preserving shared team scoring where the format requires it.

## V9 highlights
- **Individual golf is self-scoring by default.** A signed-in golfer sees and edits their own score and personal stats while the live leaderboard continues to use everybody's scores.
- **Join codes** are generated for cloud events. Golfers can choose **Join an event**, enter the organiser's code, then claim their player entry once.
- The claimed player entry links to the golfer's Fairway One account, profile photo, handicap and tournament group.
- **Personal stats stay personal.** Putts, sand shots and penalty strokes are entered only on the signed-in golfer's individual card.
- **Shared-ball formats stay shared.** Ambrose, Foursomes, Greensomes and Chapman use the team's scorecard. A linked team member can enter the team score and optional team stats.
- **Shamble keeps individual scoring** while the selected drive remains a shared team input.
- Mixed-format **Build Your Round** supports switching between personal and shared-team scoring hole by hole without losing the golfer's progress.
- Tournament golfers automatically open their assigned scoring group after claiming their player entry.
- Organisers retain an admin/group-scoring fallback for exceptional cases.
- A golfer's own completed card is treated as complete in their personal Round History even if the wider tournament is still running.
- Public player profile data is limited to display name and avatar path so linked golfers' profile photos can appear in scoring and leaderboards.

## Existing V8 features retained
- Tournament Mode supports up to **72 players**.
- A 72-player shotgun can use **18 groups of four**, with a starting hole assigned to every group.
- Tee-time tournaments can use groups of 2, 3 or 4.
- Optional stats track putts, sand shots and penalty strokes.
- Shared Fairway One Course Library for public community courses and tees.
- Community course ownership plus groundwork for Verified and Official course records.
- Hole setup clearly labels **Par** and **Index**.
- One-team Ambrose, side-score views, Build Your Round, event points and realtime cloud scoring remain available.
- Profile photos use Supabase Storage, with centred initials as the fallback avatar.

## Cloud security model
- Event members can read the event and leaderboard data they have joined.
- Individual score writes are restricted to the linked player's own score row unless the caller is an event admin.
- Shared team-score and Ambrose-drive writes are restricted to members of that team unless the caller is an event admin.
- Profile photos and basic public profile display data are separated from private profile information.