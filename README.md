# MDGA Tournament Bracket Generator

A single-page web app for generating **single-elimination arena tournament brackets** for the guild **Make Durotar Great Again (MDGA)**.

Supports the standard WoW arena compositions:

| Mode | Team size |
|------|-----------|
| 2v2  | 2 players |
| 3v3  | 3 players |
| 5v5  | 5 players |

You pick the number of teams and enter your own player rosters; the app builds a properly seeded bracket (with byes for non-power-of-two team counts) and lets you click through match results to crown a champion.

## How to run

No build step, no dependencies. Any one of these works:

**Option A — just open it:**
Double-click `index.html` in your file explorer. That's it.

**Option B — local server (most reliable):**
```bash
cd "C:\GITHUB PROJECTS\Tournament Generator"
python -m http.server 8000
```
Then visit <http://localhost:8000>.

## How to use

1. **Choose the format** — 2v2, 3v3, or 5v5.
2. **Set the number of teams.**
3. **Enter each team's players.** Give each team a name and list its members (the app pre-fills the right number of player slots for the chosen mode).
4. **Generate the bracket.** Teams are seeded in standard tournament order; byes go to the top seeds when the team count isn't a power of two.
5. **Record results** as matches happen — click a team to mark the winner, and the next round fills in automatically. Keep going until you have a champion.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page structure |
| `app.js`     | Bracket logic, seeding, byes, result tracking |
| `styles.css` | Styling (including print styles for the bracket) |

## Notes
- Seeding follows standard bracket order (e.g. for 8 teams: 1v8, 4v5, 2v7, 3v6 in round one).
- Byes are assigned to the highest seeds so the field rounds up to the next power of two.
- Everything runs locally in your browser — no data is sent anywhere.
