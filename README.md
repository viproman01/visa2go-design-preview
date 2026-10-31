# Visa2Go — phase 1

Russian-language visa and relocation service interface: a three-field solution finder, compact application step, popular destinations, interactive world map and a synchronized train-window video.

## Current release

The public GitHub Pages deployment remains a **design preview**, not an operational visa business. Form data stays only in page memory. No application is transmitted or persisted, and no third-party analytics runs there. The demo shows an explicit preview receipt, never a false submission success.

Production intake is not enabled because company details, actual contact channels, a verified service matrix, final legal documents and an authenticated server host have not been supplied. `privacy.html` and `terms.html` describe the preview only.

## Structure

- `config/site.json`: shared country/service catalogue and public connection settings; contains no secrets.
- `admin.html`: catalogue editor. Static preview exports/imports a config file. With the same-origin API it signs in and manages the shared catalogue and leads.
- `backend/`: Cloudflare Worker + D1 implementation, local SQLite adapter, API integration tests, safe static bundler and deployment instructions.
- `train-windows.js`: one decoded video frame drawn to both side windows.
- `assets/world-map.js`: Natural Earth world boundaries; the source and public-domain attribution are in `assets/world-map-source.md`.
- `credits.html`: image, video and font credits.

## Check and preview

Requires Node 24; no installation is needed.

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm run check
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm test
PATH=/opt/homebrew/opt/node@24/bin:$PATH node backend/dev.mjs
```

The local server listens only on 127.0.0.1:4173. Intake is disabled by default. Local databases and build output are ignored by Git. Backend tests use temporary/in-memory synthetic data and mocked notification delivery.

Production API supports idempotent application storage, a notification outbox with retries, authenticated lead/status management, editable catalogue and aggregate analytics without contact data. See `backend/README.md` for the exact launch requirements. Browser passwords and client contact data must never be placed in public configuration.

## Release separation

The source branch is `codex/visa2go-phase1`. The existing `codex/visa2go-pages` branch receives only the reviewed output of `backend/build.mjs`, plus public release metadata. Backend code, tests, secrets and SQLite are excluded from the published static bundle. GitHub Pages is retained only as a preview; live commercial intake needs the configured server host.
