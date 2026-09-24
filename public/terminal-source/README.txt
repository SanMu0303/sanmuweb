Trend Signal Desk frontend assets

Source: trend-signal-desk-2026-09-25-final.zip supplied by the site owner on 2026-09-25.
Files are the original compiled standalone app. The only deployment integration edits are:
- index.html loads app.css and app.js relative to this directory.
- API URLs use /api/signal-desk/ so the standalone app cannot collide with existing site APIs.
- source-map reference comments were removed because source maps are not published here.

The app is served in an iframe by /terminal/ so its global CSS remains isolated from the main site.
