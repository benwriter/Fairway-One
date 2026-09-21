# Fairway One — Prototype 01

This is the first interactive visual prototype for Fairway One.

## What works now

- Premium mobile app-style home dashboard
- Live round card
- Five-tab app navigation
- Four-player interactive scoring
- Score changes visibly update Stableford / Match / Team impact
- Live leaderboard view
- Events view
- Player profile view
- Installable-style web app metadata / manifest
- Responsive desktop presentation and full-screen mobile experience

## Deploy to Vercel

This prototype has **no build step**.

1. Upload all files in this folder to the root of the dedicated Fairway One GitHub repository.
2. Import that repository into the dedicated Fairway One Vercel project.
3. Use the default/static project settings. No environment variables are needed.
4. Deploy.

Vercel will serve `index.html` directly.

## Important

This is deliberately separate from Writer Cup. There are no shared files, databases, environment variables or dependencies.

This prototype uses local demo data only. The next engineering phase is to create the separate Fairway One Supabase backend and connect:

- users and player profiles
- courses / tees / holes
- events and groups
- raw score entries
- competition definitions and format segments
- real-time multi-device score entry
- permissions and score audit history

## Files

- `index.html` — app shell
- `styles.css` — visual design system
- `app.js` — prototype UI and scoring interaction
- `manifest.json` — installable web-app metadata
- `fairway-one-mark.svg` — temporary prototype app mark
- `vercel.json` — simple Vercel config
