# Smoke Crawler

The smoke crawler is a Playwright-based discovery script that exercises key MavMeta UI areas and writes a report bundle to `docs/smoke-reports/<timestamp>/`.

## Run

```bash
npm run smoke -- --depth=2
```

Prerequisites:

- `npm run dev:local` is already running.
- You are authenticated to at least one org in MavMeta.

## Output

Each run writes:

- `report.json` (canonical machine-readable run data)
- `report.html` (self-contained viewer with embedded JSON)
- `screenshots/` (coverage gap and error evidence)

## CLI options

- `--areas <list>`: comma-separated areas to crawl.
  - Allowed: `metadata-explorer`, `object-explorer`, `lwc-editor`, `rest-explorer`, `soql-explorer`
- `--depth <N>`: max component clicks per metadata/object row (`0` = list only).
- `--delay-ms <N>`: interaction delay in milliseconds between click steps.
- `--jump <text>`: start at first matching row/API name in metadata/object lists.
- `--org <alias-or-username>`: switch active org before crawling.
- `--app-url <url>`: override app URL (default `http://localhost:5173`).
- `--quiet`: suppress per-row progress logs.

## Area behavior

### metadata-explorer

- Walks each metadata type row.
- Detects populated/empty/timeout outcomes.
- Optionally clicks component links up to `--depth`.
- Handles grouped rows (for example Dashboard folders) by expanding collapsed groups.

### object-explorer

- Walks each object row with the same populated/empty/timeout classification.
- Optionally clicks child component links up to `--depth`.
- Special handling for `Account`: sweeps each category tab (Fields & Relationships, Validation Rules, etc.).

### lwc-editor

- Waits for bundle list to settle (loaded/empty/timeout).
- Selects the first bundle.
- Appends smoke comments to first `.js` and `.html` files.
- Clicks `Deploy to Org` and records outcome errors/timeouts.

### rest-explorer

- Sends `GET /services/data/v66.0/limits`.
- Verifies response/history render.
- Clicks remove on the request history row.

### soql-explorer

Runs two scripted builder workflows:

1. REST + `Account`

- clear fields, select all fields
- add filter `Name != null`
- sort by `Name DESC`
- set `LIMIT 10`
- click `Copy`
- collapse Filters, Sort & Limit, Query
- click `Run`

1. Tooling + `LightningComponentBundle`

- clear fields, select all fields
- add filter `ApiVersion > 50`
- sort by `CreatedDate DESC`
- set `LIMIT 10`
- click `Copy`
- collapse Filters, Sort & Limit, Query
- click `Run`

## Notes

- The crawler is discovery-oriented, not pass/fail assertion-oriented.
- It continues on per-row/per-area errors and records findings in `report.json`.
- `SIGINT` (Ctrl+C) is handled and flushes an `interrupted` report state.
