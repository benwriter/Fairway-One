# Fairway One Supabase backend

Dedicated project: `Fairway One`
Project ref: `lqjpervpfgevycpxowgc`
Region: Sydney (`ap-southeast-2`)

This backend is completely separate from Writer Cup.

Applied migrations in the live project:

1. `initial_fairway_one_schema`
2. `optimize_rls_and_indexes`
3. `add_event_tee_time`
4. `tighten_round_hole_permissions`

The live schema contains:

- competition_formats
- profiles
- courses
- course_tees
- holes
- events
- event_members
- event_players
- teams
- team_members
- rounds
- round_holes
- scores
- team_scores
- ambrose_drives

Row Level Security is enabled on all public tables. Realtime is enabled for rounds, individual scores, team scores and Ambrose drive selections.

The browser app uses only the public/publishable Supabase key. Never place a service-role or secret key in frontend code.
