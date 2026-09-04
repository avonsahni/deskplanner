# Forward plan

## Next actions

1. **Verify the desktop layer on the real machine.** `pin_to_desktop` sets
   `NSWindow.level` to -2147483623. Confirm the board renders behind Finder
   icons and does not appear in Mission Control or the app switcher.
2. **Multi-monitor.** `place_windows` only sizes the wallpaper to the *primary*
   display. Decide: one board on the primary, or one wallpaper window per
   monitor.
3. **Login item.** The app is meant to be always open; it currently has to be
   launched by hand. Add a "start at login" toggle.

## Distribution

The DMG is a **universal binary** (Apple Silicon + Intel), ad-hoc signed only.
Recipients must clear the quarantine flag by hand — see the README.

To remove that friction for everyone:

1. Join the Apple Developer Program (~$99/yr) and create a *Developer ID
   Application* certificate.
2. Set `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
   `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID`, then `npm run tauri build`
   signs and notarises in one pass.
3. Staple the ticket so it validates offline.

Until then, unsigned is a deliberate, documented trade — not an oversight.

## Backlog of ideas

- Date-range filter and search inside the Completed sheet — it currently loads
  the most recent 500 and groups them, which is fine for a year or two of use.

- Reorder cards within a block (the `sort_order` column exists and is written,
  but nothing exposes a drag-to-reorder gesture yet).
- Recurring tasks.
- Export / import (the SQLite file is already a portable backup, but a JSON
  round-trip would be friendlier).
- Wallpaper opacity control, so it can sit under a real photo.
- Windows / Linux desktop-layer implementations in `platform.rs`.

## Decisions taken, and by whom

- **Owner:** Tauri over Electron; true wallpaper layer over a full-screen
  backdrop window.
- **Claude:** SQLite via `rusqlite`; no frontend framework; `LIKE` search
  instead of FTS5; three windows instead of one; Monday-based weeks.
