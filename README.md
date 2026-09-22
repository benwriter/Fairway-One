# Fairway One — Functional Prototype V4.3

V4 is the first cloud-connected Fairway One prototype. It keeps the premium mobile design, removes the hard-coded segment concept, and builds around complete 18-hole formats first.

## Playable format library

16 formats are represented in the engine:

- Stroke Play
- Stableford
- Match Play
- Par / Bogey
- Modified Stableford
- Skins
- Four-Ball Stableford
- Four-Ball Match Play
- Best Ball
- Team Aggregate
- Best 2 of 4
- Ambrose / Scramble
- Foursomes
- Greensomes
- Chapman / Pinehurst
- Shamble

The score-entry model changes by format. Individual formats store player scores. Shared-ball formats store team scores. Ambrose, Greensomes, Chapman and Shamble can track the selected drive.

## Cloud backend

V4 is local-first but can connect to Fairway One's dedicated Supabase backend.

When signed in, the prototype can:

- create/sync events in Supabase
- sync course and round-hole data
- sync players and teams
- sync individual and team scores
- sync selected-drive data
- reload cloud events on another signed-in device
- receive realtime scoring changes for the active round

Local storage remains as a fallback so the prototype still works if the network drops.

## Authentication note

Hosted Supabase projects require email confirmation by default. For production use, set the Supabase Auth Site URL / allowed redirect URLs to the final Vercel domain. Until then, the app can still be tested locally, and existing confirmed accounts can sign in normally.

## Architecture

The underlying database stores raw hole data and scores separately from the scoring format. This is intentional. Once the standalone format library is stable, a future Format Builder can assign different formats to any selected holes without duplicating the score data.

## Separation

Fairway One has its own Supabase project, data, frontend files and deployment path. No code or data is shared with Writer Cup.

## Deploy

Upload the contents of this folder to the root of the Fairway One GitHub repository. Vercel can deploy it as a static app with no build step.


## V4.3 mobile usability pass
- Larger touch targets throughout the app
- 16px form controls to prevent iOS focus zoom
- Global `touch-action: manipulation` to suppress double-tap zoom while preserving normal panning/pinch gestures
- Larger bottom navigation icons and labels
- Larger typography throughout scoring, forms, cards and learning content
- New premium raster PWA / Apple home-screen icon assets


## V4.3 mobile usability pass
- Larger mobile typography throughout
- Full-width scoring controls on phones
- Larger action buttons and navigation targets
- Proper SVG bottom-navigation icons
- New premium Fairway One F1/flag app icon
- PWA cache bumped so refreshed assets deploy cleanly


## V4.3 mobile balance pass

- Reduced score controls and row height so four-player cards can fit comfortably on one scoring view.
- Reduced global button scale from V4.2 while keeping readable touch targets.
- Reduced bottom navigation height and icon size.
- Changed the iOS/PWA safe-area background to Fairway One cream so the bottom system area blends into the navigation rather than showing a dark green strip.
- Updated the F1 icon so the flagstick uses the same gold treatment as the F.
