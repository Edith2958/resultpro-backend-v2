# ResultPro — Project Notes

## Stack
- Backend: Node + Express + Postgres (Neon)
- Hosting: Render
- Uploads: Cloudinary
- Frontend: 3 static HTML files in `public/`

## Recent state (2026-11)
- Migrated all score/id/timestamp columns from text to proper types (integer, numeric, timestamptz)
- Rotated Neon, Render, Cloudinary credentials after git history leak
- Removed one-off migration scripts (`routes/migration.js`, `run-migration.js`, `export.js`, `seed-*.js`, `db/run-settings-migration.js`)
- Added `/api/student/active-session`, `/api/student/available-terms`
- Added `/api/verify/:pin` + `public/verify.html` (public PIN verification, QR codes link here)
- Result view redesigned: certificate style, mobile card layout, session persistence, dark mode, A4 print
- Deadline save fixed (missing unique constraint + missing deadline_overrides table)
- Release date must be strictly after teacher deadline (validated both frontend + backend)

## Pending / known good
- Everything in the "Recent state" block is tested and working.
- No known bugs.