# Planner

A calendarised weekly planner that lives on your desktop wallpaper.

## What it does

- **Weekly board.** Monday–Friday columns, each split into exactly two blocks —
  `09:00 – 17:00` and `Evening`. No hourly grid.
- **Weekend column.** Saturday and Sunday share one amber-highlighted column
  with no time bifurcation.
- **Cards.** Every task is a card. Click it to edit; click its checkbox to mark
  done. Drag it to any other block, day, or the monthly panel.
- **Completed work leaves the board.** Ticking a card removes it from the week,
  the backlog and the monthly panel, so what you see is what is still open.
  Nothing is deleted — the **✓ Completed** button opens the full history,
  grouped by the day each task was actually finished. Untick a card there and
  it goes straight back to its block.
- **Completion dates are real dates.** Tick a card and it is stamped with the
  system date at that moment — so a task planned for Monday but finished on
  Thursday is recorded as Thursday, not Monday. If you are catching up on the
  paperwork later, the editor has a *Completed on* field to set the day it
  actually happened.
- **Backlog.** Anything still undone with a date before today is collected in
  the backlog panel, with `→ Today` / `→ Tomorrow` quick moves and a bulk
  "move everything to today" sweep.
- **Monthly panel.** A separate month-scoped task list, navigable month by month.
- **Future planning.** Navigate to any week or month and add tasks there.
- **Search.** Live search across every task's title and notes, past and future.
- **Wallpaper mode.** A read-only board painted at the macOS desktop window
  level — behind every app *and* behind your Finder icons. A floating "Planner"
  pill (with a count of what's outstanding) opens the interactive window.

## Running it

```bash
npm install
npm run tauri dev      # development
npm run tauri build    # produces a .app and .dmg in src-tauri/target/release/bundle
```

The release bundle is about **4 MB**; the app idles at roughly 70 MB of RAM
because it uses the system WebView rather than shipping a browser.

Requires Node 18+ and a Rust toolchain (`rustup`).

## Where the data lives

One SQLite file, on your machine only, nothing over the network:

```
~/Library/Application Support/com.avonsahni.planner/planner.sqlite3
```

It is a plain SQLite database in WAL mode — readable with any SQLite client,
and trivial to back up by copying the file.

## Keyboard

| Key | Action |
| --- | --- |
| `N` | New task |
| `D` | Completed history |
| `T` | Jump to this week |
| `←` / `→` | Previous / next week |
| `/` or `⌘F` | Search |
| `⌘↵` | Save the open task |
| `Esc` | Close the editor, or clear the search |

## Architecture

| Piece | What it is |
| --- | --- |
| [src-tauri/src/db.rs](src-tauri/src/db.rs) | SQLite schema and every query. One connection behind a mutex. |
| [src-tauri/src/lib.rs](src-tauri/src/lib.rs) | Tauri commands, window placement, the `tasks-changed` broadcast. |
| [src-tauri/src/platform.rs](src-tauri/src/platform.rs) | macOS `NSWindow` levels: desktop layer for the wallpaper, floating for the launcher. |
| [src/planner.ts](src/planner.ts) | The interactive board, backlog, monthly panel, editor, search. |
| [src/wallpaper.ts](src/wallpaper.ts) | The read-only desktop board. |
| [src/launcher.ts](src/launcher.ts) | The floating pill. |
| [src/dates.ts](src/dates.ts) | Local-time date maths. Nothing here touches UTC. |

Three windows run in one process: `wallpaper` (desktop level), `launcher`
(floating), and `planner` (hidden until you ask for it). Closing the planner
window hides it rather than quitting, so the wallpaper survives.

Every mutation emits `tasks-changed`, and all three windows re-read on it — so
ticking a task in the planner updates the wallpaper immediately.

### Why it stays small

No UI framework. The frontend is hand-written DOM against the system WebView:
roughly 20 KB of JavaScript and 15 KB of CSS, no runtime dependencies beyond
`@tauri-apps/api`. The database is a single embedded SQLite file. There is no
polling loop — windows redraw on an event, with a 15-minute backstop and a
one-minute date-rollover check.

## Data model

One table, `tasks`. `scope` is either `day` (with a `date`, and a `slot` of
`work`, `evening`, or NULL for weekends) or `month` (with a `month`). The
backlog is a query, not a state: `done = 0 AND scope = 'day' AND date < today`.
