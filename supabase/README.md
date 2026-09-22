# Fairway One Cloud

Fairway One uses its dedicated Supabase project for accounts, courses, events, rounds, teams, tournament groups, scoring and custom round segments.

Database changes are applied as versioned migrations. Row Level Security protects user and event data. Tournament Mode stores scoring groups and group membership separately so a large field can be scored group-by-group while retaining one overall event leaderboard.
