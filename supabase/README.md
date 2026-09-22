# Fairway One Cloud

Fairway One uses its dedicated Supabase project for accounts, courses, events, rounds, teams, tournament groups, scoring, custom round segments and profile photos.

V9 adds account-linked self scoring:
- Cloud events have join codes.
- Event players can be claimed by a signed-in Fairway One account.
- Individual score writes are limited to that linked player unless the caller is an event admin.
- Shared team score and selected-drive writes are limited to members of that team unless the caller is an event admin.
- A small `public_profiles` table exposes only the display name and avatar path needed to render linked golfers in scoring and leaderboards.
- The `join-event` Edge Function handles secure event joining and player claiming without exposing privileged keys to the client.

Row Level Security remains enabled for exposed tables. Secret/service credentials must never be shipped in frontend code.
