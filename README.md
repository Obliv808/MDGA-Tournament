# MDGA Arena — Tournament Bracket Generator

A single-page tournament bracket generator for the guild **Make Durotar Great Again (MDGA)**. No build step, no dependencies — just open `index.html` in any modern browser.

## Quick start
1. Double-click `index.html`, or serve the folder (`python -m http.server`) and open it.
2. Pick a format (**2v2 / 3v3 / 5v5**) and a team count (2–32).
3. Enter each team's players, then **Generate Bracket**.
4. Score matches by typing or clicking a team name; winners advance automatically.

## Features
- **Two modes**, switchable any time from the top mode bar:
  - **⚔️ Arena Bracket** — seeded single-elimination tournament.
  - **🎲 Solo Shuffle Wargames** — dump a list of individual players and deal them at random into teams.
- **Formats:** 2v2, 3v3, 5v5 — roster fields auto-resize per team size.
- **Team count:** stepper from 2 to 32 teams.
- **Seeding & byes:** top seeds get byes when the count isn't a power of 2; a live *Bye preview* in Setup shows exactly who gets one (with a lopsided-count warning and quick-fix chips).
- **Match format:** Best of 1 / 3 / 5.
- **Roster editing:** reorder players (up/down), shuffle, add/remove teams and players.
- **Scoring:** type scores or click a team to mark the winner; winners auto-advance through every round. A hover **✕** on any decided match clears its result and re-opens downstream rounds.
- **Champion banner** once the final is decided.
- **Copy Results:** one-click plain-text bracket + champion summary to your clipboard.
- **Print / Save PDF** with MDGA title header.
- **Solo Shuffle Wargames:** add players one at a time or paste a whole list (one per line or comma-separated), pick a team size (with quick-select chips for 2/3/5), then shuffle. Any players left over once teams are filled are called out as byes rather than silently dropped. Add/remove players and re-shuffle as many times as you like.
- **Solo Shuffle → Bracket:** once you've shuffled, hit **Generate Bracket** on the results panel to seed those exact teams straight into the Arena Bracket flow (works for any team size, not just 2v2/3v3/5v5). Any leftover byes are excluded and you're prompted before they're dropped.
- **Roles (Healer / DPS):** every player — in Arena Bracket rosters and in the Solo Shuffle pool — gets a role toggle (**H**/**D**). Turn on **Require 1 Healer per team** in either mode:
  - In **Solo Shuffle**, the shuffle algorithm guarantees each team gets exactly 1 healer plus the right number of DPS (e.g. 1 healer + 2 DPS for a 3v3). If there aren't enough healers or DPS to go around, the extras sit out as byes.
  - In **Arena Bracket**, rosters are entered manually, so the toggle instead flags any team that doesn't have exactly 1 healer marked, right on its team card, and warns you before generating a bracket if any team is off.
  - Healers are marked with an **H** badge throughout — team cards, bracket match cards, the champion banner, and the Copy Results text.
- **Persistence:** everything — including the solo shuffle player list — is saved to `localStorage`, so a refresh keeps your setup and lands you back on the mode/view you were last on.

## Files
| File | Purpose |
|------|---------|
| `index.html` | Page structure (Setup + Bracket views). |
| `app.js` | All logic: seeding, bracket math, scoring, persistence, presets, export/import. |
| `styles.css` | Gold arena theme, layout, print styles. |

## Notes
- Data lives in your browser's `localStorage`; use **Export JSON** for a portable backup or to move between machines.
- Pure front-end — no server, no account, nothing leaves your machine.
