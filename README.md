# MDGA Arena — Tournament Bracket Generator

A single-page tournament bracket generator for the guild **Make Durotar Great Again (MDGA)**. No build step, no dependencies — just open `index.html` in any modern browser.

## Quick start
1. Double-click `index.html`, or serve the folder (`python -m http.server`) and open it.
2. Pick a format (**2v2 / 3v3 / 5v5**) and a team count (2–32).
3. Enter each team's players, then **Generate Bracket**.
4. Score matches by typing or clicking a team name; winners advance automatically.

## Features
- **Formats:** 2v2, 3v3, 5v5 — roster fields auto-resize per team size.
- **Team count:** stepper from 2 to 32 teams.
- **Seeding & byes:** top seeds get byes when the count isn't a power of 2; a live *Bye preview* in Setup shows exactly who gets one (with a lopsided-count warning and quick-fix chips).
- **Match format:** Best of 1 / 3 / 5.
- **Roster editing:** reorder players (up/down), shuffle, add/remove teams and players.
- **Scoring:** type scores or click a team to mark the winner; winners auto-advance through every round. A hover **✕** on any decided match clears its result and re-opens downstream rounds.
- **Champion banner** once the final is decided.
- **Copy Results:** one-click plain-text bracket + champion summary to your clipboard.
- **Print / Save PDF** with MDGA title header.
- **Roster presets:** save, load, and delete named team rosters (stored in your browser).
- **JSON backup:** export the full tournament state to a `.json` file, or import one to restore it.
- **Persistence:** everything is saved to `localStorage`, so a refresh keeps your setup — and you land back on the view you were last on.

## Files
| File | Purpose |
|------|---------|
| `index.html` | Page structure (Setup + Bracket views). |
| `app.js` | All logic: seeding, bracket math, scoring, persistence, presets, export/import. |
| `styles.css` | Gold arena theme, layout, print styles. |

## Notes
- Data lives in your browser's `localStorage`; use **Export JSON** for a portable backup or to move between machines.
- Pure front-end — no server, no account, nothing leaves your machine.
