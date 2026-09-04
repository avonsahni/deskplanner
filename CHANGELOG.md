# Changelog

## 0.1.0 — 2026-09-04

First working build. Everything in the spec is implemented.

### Shipped

- **Stack.** Tauri 2 + SQLite (`rusqlite`, bundled) + hand-written TypeScript.
  Chosen over Electron because "lite, not resource hungry" was an explicit
  requirement, and because the wallpaper layer needs native macOS window calls
  that Electron cannot make without a custom addon.
- **Data layer** (`src-tauri/src/db.rs`). Single `tasks` table, WAL mode, four
  indexes. `scope` discriminates day vs month tasks; normalisation on write
  means the frontend never has to clear unused fields.
- **Windows.** Three: `wallpaper` at `kCGDesktopWindowLevel` (-2147483623,
  below the Finder icon layer), `launcher` at `NSFloatingWindowLevel`, and
  `planner`, hidden until summoned. Closing `planner` hides it instead of
  quitting.
- **Board.** Mon–Fri with two fixed blocks each, weekend as one amber column
  with no time split, drag-and-drop between any blocks, backlog panel with
  quick-move and bulk sweep, monthly panel, live search, task editor.
- **Search.** `LIKE` over title and notes rather than FTS5 — one less compile
  flag to depend on, and instant at personal-planner scale.

### Revised mid-build, at the owner's request: how completion works

- **Completed tasks leave the board.** `in_range` and `in_month` now carry
  `done = 0`, matching `backlog`, which always did. The week, the backlog and
  the monthly panel show only open work.
- **Completion history.** New `completed_tasks` command and a **✓ Completed**
  sheet (`D`), listing everything ticked off, newest first, grouped under the
  day it was actually finished with a relative label ("yesterday", "3 days
  ago"). Cards there are not greyed out, carry a `✓ 16:20` stamp beside the day
  they were *scheduled* for, and unticking one returns it to its block.
- **Completion date is the day you tick, not the day it was planned.**
  `set_done` stamps the system clock. `TaskInput` gained `completed_at`, and
  the editor shows a *Completed on* date field whenever a task is marked done,
  so a Monday task cleared on Thursday can be recorded as Thursday — or
  back-dated if you are catching up. Precedence in SQL is
  `COALESCE(?explicit, completed_at, ?now)`: an explicit date wins, otherwise
  an existing stamp is preserved, otherwise the clock.
- **Column tallies** now show the number of open tasks. A `done/total` tally
  was meaningless once done cards stopped appearing.
- **Wallpaper "done" stat** now comes from `day_counts`, which counts all rows,
  rather than from the board query that no longer returns completed ones.

### Fixed during verification

Bugs found by running the app and screenshotting its own windows, not by
reading the code:

- **`[hidden]` did nothing.** `.btn { display: inline-flex }` and
  `.field { display: flex }` outrank the UA stylesheet's
  `[hidden] { display: none }`, so the editor showed a Delete button on brand
  new tasks and the Month field alongside Date. Settled with one global
  `[hidden] { display: none !important }`.
- **Mojibake.** Vite serves the HTML entry points without a charset, so every
  `‹ › ＋ ⌕ ⇥` rendered as `â€¹`-style garbage. Added `<meta charset="utf-8">`
  to all three pages.
- **Launcher pill was not transparent.** The window is transparent but the
  shared stylesheet painted an opaque body behind it; the pill sat on a dark
  rectangle. Overridden per page.
- **Redundant slot pill.** Every board card carried a "09:00 – 17:00" tag
  inside a block already headed "WORK · 9–5". Now shown only in the backlog and
  search results, where there is no surrounding column.
- **Monthly panel header overflowed** its 300px panel; the ＋ button was pushed
  off the edge. Shortened to "Sep 2026" and tightened the header.
- **Weekend tint too faint** to read as "separately coloured". Strengthened.
- **Double-handled drops.** Lists sit inside blocks and both were drop targets,
  so a drop fired two reschedules on the way up. Added `stopPropagation`.
- **Search sheet covered the topbar,** including the search box that opened it.
  Moved inside `.main`.
- **`LIKE` wildcards were not escaped,** so searching `50%` matched everything
  starting `50`.

### Verified

- `cargo build` clean (7 warnings, all `cfg` noise from the `objc` macro).
- `tsc --noEmit` clean; `vite build` produces ~20 KB JS + ~15 KB CSS.
- **Window levels read back from the window server**, which is the real test of
  the wallpaper layer:
  `wallpaper` at `-2147483623`, above the system wallpaper (`-2147483625`) and
  below Finder's icon layer (`-2147483603`) — so it *is* the desktop, with
  icons on top. `launcher` at level 3, parked at 1332,902 on a 1512x982 screen.
- Wallpaper, planner and editor windows screenshotted against 24 seeded tasks:
  week board, two blocks per weekday, weekend column, backlog with relative
  dates and quick-moves, monthly panel, tallies and stats all correct.
  Seed data was deleted afterwards.
- The completion model re-verified against seeded data that deliberately
  included cross-day completions: a task planned Wed and finished Fri, and one
  planned for next Sunday but finished on Wednesday. Both grouped under the day
  they were actually completed, not the day they were scheduled. Completed
  tasks were absent from the board, backlog, monthly panel and wallpaper.
- `npm run tauri build` produces a **4.0 MB** `Planner.app` and a 2.0 MB DMG —
  against roughly 180 MB for the Electron equivalent.

### Not verified — inspected only

- Drag-and-drop between blocks, the launcher → planner click path, and closing
  the planner back to the wallpaper. macOS Accessibility permission is not
  granted to the terminal, so synthetic clicks and keystrokes were refused; the
  editor was reached with a temporary boot hook instead, since reverted.
- Multi-monitor placement.

### Packaging

- **Universal binary** (Apple Silicon + Intel) — the first build was arm64 only,
  which would simply not run for anyone on an Intel Mac. `lipo -info` confirms
  `x86_64 arm64`. 8.1 MB app, **4.09 MB DMG**.
- **Ad-hoc signed only.** No Apple Developer ID, so recipients must clear the
  quarantine flag or use *Open Anyway*. Documented in the README rather than
  left as a surprise; the notarisation path is written up in PLAN.md.
- **First-run hint on the wallpaper.** An empty board told a new user nothing
  about how to get in. It now names the launcher pill and the `N` shortcut, and
  disappears as soon as anything is planned.
- MIT licensed.

### Deliberately not done

- No FTS5 virtual table. Revisit only if a real dataset makes `LIKE` slow.
- No global hotkey. The floating pill covers "a special button to enter the
  Planner"; a hotkey would add a plugin dependency.
- Wallpaper mode is macOS-only. `platform.rs` has no-op stubs for other
  platforms, so the app still builds and runs there — just without the desktop
  layer.
