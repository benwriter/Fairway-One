# Fairway One V8

Fairway One V8 expands the app from social rounds into fuller tournament and player-stat workflows.

## V8 highlights
- Tournament Mode supports up to **72 players**.
- A 72-player shotgun can be split into **18 groups of four**, with a starting hole assigned to every group.
- Tee-time tournaments can still use groups of 2, 3 or 4.
- Optional **Track round stats** records putts, sand shots and penalty strokes hole by hole.
- A **Stats** tab totals those figures at the end of the round.
- Penalty strokes are tracked for statistics only; gross score entry should already include the penalty.
- The Fairway One **Course Library** lets golfers select public community courses and tees.
- A signed-in golfer can enter a course once and choose **Share this course with Fairway One** so it becomes selectable by other users.
- Community course records remain editable by their owner; the schema also supports future verified/official course records.
- Hole setup now labels the two values clearly as **Par** and **Index**.
- Existing V7 features remain, including Build Your Round, event points, one-team Ambrose, side-score views and cloud scoring.

## Backend
Supabase now stores optional putts and sand-shot stats alongside the existing penalty-stroke field. Public course, tee and hole records are readable by all app users, while writes remain protected by ownership/RLS.
