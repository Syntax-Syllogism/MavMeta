# MavMeta

MavMeta is a powerful, localhost control center designed specifically for Salesforce Administrators and Developers. It streamlines complex org management and metadata operations into a fast, modern desktop experience.

## Key Features

- **🚀 Effortless Org Management**
  - **Quick-Switch:** Instantly toggle between production, sandbox, and scratch orgs.
  - **Single-Click Login:** Open any authorized org in your default browser without searching for passwords.
  - **Scratch Org Wizard:** Create and configure scratch orgs in seconds with a guided setup.

- **🔍 Deep Metadata Discovery**
  - **Browse & Filter:** Quickly find components across hundreds of metadata types.
  - **XML Preview:** View raw component XML source directly in the app—no need to download or search through local files.
  - **Modified Tracking:** See who changed what and when, directly in the explorer.

- **🛠️ Object Manager (Beta)**
  - **Fast Browsing:** Explore standard and custom objects with a high-performance UI.
  - **Child Metadata:** Inspect fields, validation rules, and other child components with ease.

- **🛒 Metadata Cart Workflow**
  - **Staging:** "Shop" for components from different types and objects, adding them to a unified cart.
  - **Bulk Actions:** Perform operations on your entire "hit list" at once.
  - **Destructive Deploys:** Safely validate and deploy destructive changes with real-time progress and safety checks.
  - **Cross-Org Compare:** Compare your staged items against other orgs to identify differences before you deploy.

- **🧪 Advanced Tools**
  - **REST Explorer:** Test and explore Salesforce APIs with a built-in interactive playground.
  - **SOQL Explorer:** Compose, run, and iterate on SOQL queries against any connected org with instant results. Export results to .csv or .json files.
  - **LWC Playground:** Experiment with and preview Lightning Web Components in a local sandbox.

- **🎨 Modern User Experience**
  - **Dark & Light Modes:** Choose the theme that fits your workflow.
  - **Search Everywhere:** Fast, responsive filtering for types, components, and objects.
  - **Local Privacy:** Runs entirely on your machine; your credentials and metadata stay local.

## Technical Overview

The frontend is Svelte 5. The backend is a local Node server (Fastify) that uses Salesforce TypeScript libraries directly (`@salesforce/core` + Metadata and Tooling API usage).

## Frontend Architecture

`src/mainview/App.svelte` is now the orchestration shell. It composes workflow-oriented components and keeps cross-workflow state orchestration in one place.

Primary UI components:

- `orgs/OrgDirectory.svelte`: org auth form, org directory table, and org row actions.
- `metadata/MetadataExplorer.svelte`: metadata type discovery/filtering, component explorer, grouping, and inspector.
- `cart/MetadataCartWizard.svelte`: staged metadata review, action stepper, destructive confirmation, and result/progress UI.
- `StatusBar.svelte`, `AliasModal.svelte`, `ScratchDeleteModal.svelte`: stable shell/modal primitives extracted from `App.svelte`.

Pure view-model helpers (unit-tested):

- `metadata/metadata-view-model.ts`
- `cart/cart-view-model.ts`
- `deploy/deploy-view-model.ts`

## Security

MavMeta runs entirely on `127.0.0.1`, makes no telemetry calls, and
never persists Salesforce credentials of its own. For the full threat
model and the steps you can run locally to verify those claims, see
[docs/security.md](docs/security.md). To report a vulnerability, see
[SECURITY.md](SECURITY.md).

## Getting Started

### End-user (npm)

```bash
# Run latest published release without installing globally
npx @syntax-syllogism/mavmeta@latest

# Or install globally
npm install -g @syntax-syllogism/mavmeta
mavmeta
```

The npm CLI launch starts the local server in static mode and opens MavMeta in your default browser.

### Developer (from source)

```bash
# Install dependencies
npm install

# Run backend + frontend together (recommended)
npm run dev:local

# Run backend only
npm run dev:server

# Run frontend only (Vite on :5173)
npm run dev:web

# Typecheck + tests
npm run typecheck
npm run test

# Build frontend assets
npm run build

# Run single-process local app (serves built frontend + API)
npm start
```

## Runtime

- Vite frontend runs at `http://localhost:5173`.
- If `5173` is busy, `npm run dev:local` fails fast so the frontend and backend do not disagree about the session bootstrap origin. Free the port or set `MAVMETA_WEB_PORT` for both processes.
- Node backend runs at `http://127.0.0.1:8787` by default.
- Vite proxies `/api/*` requests to the backend in development.
- `npm start` serves the built frontend from the backend process on backend host/port.
- `npx @syntax-syllogism/mavmeta` / `mavmeta` runs the packaged CLI in static mode, requests an ephemeral local port, and opens the browser automatically.

Optional backend env vars:

- `MAVMETA_HOST` (default: `127.0.0.1`)
- `MAVMETA_PORT` (default: `8787`)
- `MAVMETA_WEB_PORT` (default: `5173`)

## Project Structure

```text
├── src/
│   ├── server/             # Node backend (Fastify + Salesforce services)
│   ├── shared/             # Shared DTOs/types
│   └── mainview/
│       ├── App.svelte      # App shell + orchestration
│       ├── StatusBar.svelte
│       ├── AliasModal.svelte
│       ├── ScratchDeleteModal.svelte
│       ├── backend/
│       │   └── backend-client.ts  # HTTP client to /api
│       ├── orgs/
│       │   └── OrgDirectory.svelte
│       ├── metadata/
│       │   ├── MetadataExplorer.svelte
│       │   └── metadata-view-model.ts
│       ├── cart/
│       │   ├── MetadataCartWizard.svelte
│       │   ├── cart-view-model.ts
│       │   └── types.ts
│       ├── deploy/
│       │   └── deploy-view-model.ts
│       ├── App.test.ts     # Component behavior tests for main workflows
│       ├── main.ts
│       ├── index.html
│       └── app.css
├── vite.config.ts
├── svelte.config.js
└── package.json
```

## Notes

- Active development target is Node/npm.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct, and the process for submitting pull requests to us.

## Code of Conduct

We are committed to fostering a welcoming community. Please review our [Code of Conduct](CODE_OF_CONDUCT.md).
