# Fairway One Supabase backend

Dedicated project: `Fairway One`
Region: Sydney (`ap-southeast-2`)

This backend is completely separate from Writer Cup.

Applied live migrations include:

1. `initial_fairway_one_schema`
2. `optimize_rls_and_indexes`
3. `add_event_tee_time`
4. `tighten_round_hole_permissions`
5. `add_custom_round_segments`

The live public schema includes:

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
- round_segments
- scores
- team_scores
- ambrose_drives

`round_segments` is the V5 custom-format layer. Each row stores a segment name, scoring format, selected holes, competition-points value, settings and display order while raw scores remain in the existing score tables.

Row Level Security is enabled on all public Fairway One tables. The V5 security advisor check reports no security findings.

The browser app uses only the Supabase publishable key. Never place a service-role or secret key in frontend code.
