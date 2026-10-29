# MavMeta Developer Guide

This guide covers the architecture, development workflows, and how to extend MavMeta.

## Architecture Overview

MavMeta is a **localhost-only desktop app** with three layers:

```text
┌─────────────────────────────────────────────────────┐
│           Browser (Svelte 5 Frontend)               │
│  - UI components (OrgDirectory, MetadataExplorer)   │
│  - View-model helpers (metadata-view-model.ts)      │
│  - HTTP client (backend-client.ts)                  │
└─────────────┬───────────────────────────────────────┘
              │ HTTP (localhost, session token auth)
              ↓
┌─────────────────────────────────────────────────────┐
│       Node.js Server (Fastify, Port 8787)           │
│  - Route handlers (app.ts)                          │
│  - Service layer (org-service, metadata-service)    │
│  - Salesforce API clients                           │
└──────────────┬────────────────────────────────────────┘
               │ Salesforce APIs (OAuth, Metadata, Tooling)
               ↓
        Salesforce Orgs
```

### Key Design Principles

1. **Local security:** Runs only on `127.0.0.1`; no cloud storage or telemetry
1. **Single responsibility:** Each service handles one domain (orgs, metadata, deploy, etc.)
1. **Typed boundaries:** Shared DTOs in `src/shared/` ensure frontend/backend contracts
1. **View models:** Pure functions that transform data for UI rendering
1. **No state management library:** App.svelte orchestrates state; no Redux/Zustand

---

## Project Structure

```text
src/
├── cli.ts                     # Packaged `mavmeta` bin: --help/--version, else starts the server
├── cli-args.ts                # Argument parsing for cli.ts (no side effects)
├── server/                    # Fastify backend
│   ├── index.ts              # Server entry point (reads MAVMETA_* env, --serve-static)
│   ├── app.ts                # Route definitions & security
│   ├── org-service.ts        # Org CRUD, auth, switch
│   ├── metadata-service.ts   # List/get/diff metadata
│   ├── deploy-service.ts     # Destructive/cross-org deploys
│   ├── soql-service.ts       # Query validation, execution
│   ├── rest-service.ts       # REST API proxy
│   ├── object-explorer-service.ts  # Object/field browsing
│   ├── lwc-service.ts        # LWC bundle operations
│   ├── scratch-org-service.ts # Scratch org creation
│   ├── api-error.ts          # Error class
│   ├── redact-secrets.ts     # Security: token/password redaction
│   ├── salesforce-host.ts    # Security: allowlist validation
│   ├── auth-file-write-guard.ts # Security: prevent credential corruption
│   └── *.test.ts             # Unit tests for each service
│
├── mainview/                  # Svelte frontend (http://localhost:5173)
│   ├── App.svelte            # App shell & orchestration
│   ├── app.css               # Design tokens, global styles
│   ├── main.ts               # Entry point
│   ├── StatusBar.svelte      # Global status/feedback surface
│   ├── AliasModal.svelte     # Modal for setting org alias
│   ├── ScratchDeleteModal.svelte # Modal for scratch org deletion
│   │
│   ├── backend/
│   │   └── backend-client.ts # HTTP client to /api
│   │
│   ├── orgs/
│   │   └── OrgDirectory.svelte # Org list, auth, quick-switch
│   │
│   ├── metadata/
│   │   ├── MetadataExplorer.svelte # Browse & filter metadata
│   │   └── metadata-view-model.ts  # Pure helpers for grouping/search
│   │
│   ├── cart/
│   │   ├── MetadataCartWizard.svelte # Staged items, actions, deploy UI
│   │   ├── cart-view-model.ts        # Pure helpers for cart logic
│   │   └── types.ts                  # Cart-specific types
│   │
│   ├── deploy/
│   │   └── deploy-view-model.ts  # Pure helpers for deploy status formatting
│   │
│   └── App.test.ts            # Component tests (Svelte behavior)
│
├── shared/                     # Shared types (frontend & backend)
│   ├── orgs.ts
│   ├── metadata.ts
│   ├── deploy.ts
│   ├── soql.ts
│   ├── rest.ts
│   ├── lwc.ts
│   └── field-access.ts
│
├── vite.config.ts             # Frontend build (Vite)
├── svelte.config.js           # Svelte compiler config
├── tsconfig.json              # TypeScript config
└── package.json               # Dependencies, scripts
```

---

## Backend Architecture

### Service Layer

Each service encapsulates a domain:

**OrgService** (`org-service.ts`)

- Reads org list from Salesforce CLI (`~/.sf`, `~/.sfdx`)
- Authenticates new orgs via OAuth
- Manages the "active org" (stored in memory)
- Handles logout, alias updates, status refresh

```typescript
export interface OrgServiceApi {
  listOrgs(): Promise<OrgListItem[]>;
  setActiveOrg(target: { username: string }): Promise<OrgListItem>;
  authOrg(req: { loginUrl: string; alias?: string }): Promise<OrgListItem>;
  // ... more methods
}
```

**MetadataService** (`metadata-service.ts`)

- Lists all metadata types in an org
- Lists components of a specific type (with search/folder filters)
- Retrieves raw XML source for a component
- Compares components across two orgs

```typescript
export interface MetadataServiceApi {
  listMetadataTypes(req: { target: { username: string } }): Promise<MetadataType[]>;
  listMetadataComponents(req: ListMetadataComponentsRequest): Promise<MetadataComponent[]>;
  getComponentSource(req: GetComponentSourceRequest): Promise<{ source: string }>;
  getCrossOrgComponentDiff(req: CrossOrgDiffRequest): Promise<CrossOrgDiffResult[]>;
}
```

**DeployService** (`deploy-service.ts`)

- Starts destructive deploys (delete components)
- Starts cross-org deploys (copy components between orgs)
- Polls deploy status
- Cancels in-progress deployments

**SoqlService** (`soql-service.ts`)

- Validates SOQL syntax
- Executes queries (with pagination)
- Starts bulk queries (for large result sets)
- Polls bulk job status
- Downloads bulk results as CSV

**RestService** (`rest-service.ts`)

- Executes custom REST calls to Salesforce APIs
- Supports GET, POST, PATCH, DELETE
- Handles custom headers and request bodies

**LwcService** (`lwc-service.ts`)

- Lists all LWC bundles
- Retrieves bundle files
- Deploys file changes (with fallback from Tooling to Metadata API)

**ObjectExplorerService** (`object-explorer-service.ts`)

- Lists all objects (standard + custom)
- Paginated listing for performance
- Retrieves field, validation rule, and record-type definitions

### Security Layer

#### apiError.ts

- Custom error class with status code and code (e.g., `INVALID_REQUEST`)
- All errors are caught in `app.setErrorHandler` and redacted

#### redact-secrets.ts

- Strips Salesforce access tokens, JWTs, and field names from logs
- Applied to backend logs, frontend console, and error messages
- Prevents credential leakage

#### auth-file-write-guard.ts

- Wraps `fs.writeFile` / `fs.appendFile` for `~/.sf` and `~/.sfdx`
- Release mode: blocks writes (protects credentials)
- Dev mode: logs warnings (allows Salesforce SDK refresh)

#### salesforce-host.ts

- Allowlist for all outbound Salesforce API calls
- Prevents SSRF attacks
- Validated against `*.salesforce.com`, `*.force.com`, etc.

### Route Handler Pattern

Every route follows this pattern (from `app.ts`):

```typescript
app.post("/api/metadata/types", async (request) =>
  metadataService.listMetadataTypes(readListMetadataTypesRequest(request.body)),
);
```

- **Validation:** `readListMetadataTypesRequest()` validates & parses the body
- **Service call:** Delegates to the appropriate service
- **Error handling:** `app.setErrorHandler` catches and redacts errors
- **Type safety:** Request/response types come from `src/shared/`

---

## Frontend Architecture

### App Shell (App.svelte)

The root orchestration component:

```svelte
<script>
  import { onMount } from "svelte";
  import OrgDirectory from "./orgs/OrgDirectory.svelte";
  import MetadataExplorer from "./metadata/MetadataExplorer.svelte";
  import MetadataCartWizard from "./cart/MetadataCartWizard.svelte";
  import StatusBar from "./StatusBar.svelte";

  let activeOrg: OrgListItem | null;
  let cart: CartItem[];
  let status: { message: string; type: "success" | "error" | "info" };

  // Orchestrates state between child components
  async function onOrgSwitch(org: OrgListItem) {
    if (cart.length > 0) {
      // Prompt: cart protection
    }
    activeOrg = org;
  }

  async function onAddToCart(component: MetadataComponent) {
    cart = [...cart, { ...component, id: generateId() }];
    status = { message: "Added to cart", type: "success" };
  }
</script>

<div class="app">
  <OrgDirectory {activeOrg} on:switch={onOrgSwitch} />
  <MetadataExplorer {activeOrg} on:add-to-cart={onAddToCart} />
  <MetadataCartWizard {cart} {activeOrg} />
  <StatusBar {status} />
</div>
```

### View Models

Pure functions that transform data for the UI (in `*-view-model.ts`):

```typescript
// metadata-view-model.ts
export function groupComponentsByFolder(
  components: MetadataComponent[],
  groupBy: "folder" | "none",
): Record<string, MetadataComponent[]> | MetadataComponent[] {
  if (groupBy === "none") {
    return components;
  }
  return components.reduce(
    (acc, comp) => {
      const folder = comp.fileName.split("/")[0] || "root";
      acc[folder] ??= [];
      acc[folder].push(comp);
      return acc;
    },
    {} as Record<string, MetadataComponent[]>,
  );
}

export function filterComponents(
  components: MetadataComponent[],
  search: string,
): MetadataComponent[] {
  return components.filter((c) => c.fullName.toLowerCase().includes(search.toLowerCase()));
}
```

These are:

- **Unit testable** (no props, no side effects)
- **Reusable** across components
- **Composable** (chain multiple view-model calls)

### Backend Client

`backend-client.ts` is the HTTP layer:

```typescript
export class BackendClient {
  private sessionToken: string = "";
  private apiBaseUrl: string = "http://127.0.0.1:8787/api";

  async listOrgs(): Promise<OrgListItem[]> {
    const response = await fetch(`${this.apiBaseUrl}/orgs`, {
      method: "GET",
      headers: { "X-MavMeta-Session": this.sessionToken },
    });
    if (!response.ok) {
      throw await parseError(response);
    }
    return response.json();
  }

  async listMetadataTypes(username: string): Promise<MetadataType[]> {
    // ...
  }
}
```

- **Single instance** created once at app startup
- **Automatic session token injection** from `<meta name="MavMeta-session">`
- **Error handling** parses error responses and throws typed errors
- **Type-safe** methods match backend routes 1:1

### Component Lifecycle

Svelte 5 uses a simpler model:

```svelte
<script>
  import { onMount } from "svelte";
  let data = $state(null);

  onMount(async () => {
    data = await backend.fetchData();
  });
</script>

<div>
  {#if data}
    {@render renderList(data)}
  {/if}
</div>
```

---

## Adding a New Feature

Here's a step-by-step process:

### 1. Define Types (src/shared/)

Create or update a file in `src/shared/`:

```typescript
// src/shared/my-feature.ts
export interface MyFeatureRequest {
  target: { username: string };
  query: string;
}

export interface MyFeatureResult {
  id: string;
  value: string;
}
```

### 2. Implement Backend Service

Create `src/server/my-feature-service.ts`:

```typescript
import { MyFeatureRequest, MyFeatureResult } from "../shared/my-feature";
import { ApiError } from "./api-error";
import { OrgService } from "./org-service";

export interface MyFeatureServiceApi {
  executeFeature(req: MyFeatureRequest): Promise<MyFeatureResult[]>;
}

export class MyFeatureService implements MyFeatureServiceApi {
  constructor(private orgService = new OrgService()) {}

  async executeFeature(req: MyFeatureRequest): Promise<MyFeatureResult[]> {
    const org = await this.orgService.getOrg(req.target.username);
    if (!org) {
      throw new ApiError(404, "ORG_NOT_FOUND", "Org not found");
    }
    // Your business logic here
    return [];
  }
}
```

### 3. Add Routes (src/server/app.ts)

Update `app.ts` to add the route:

```typescript
import { MyFeatureService, type MyFeatureServiceApi } from "./my-feature-service";

function createApp(options: CreateAppOptions = {}) {
  const myFeatureService = options.myFeatureService ?? new MyFeatureService();

  app.post("/api/my-feature/execute", async (request) =>
    myFeatureService.executeFeature(readMyFeatureRequest(request.body)),
  );
}

function readMyFeatureRequest(body: unknown): MyFeatureRequest {
  const objectBody = readObjectBody(body);
  const targetBody = readObjectBody(objectBody.target);
  return {
    target: {
      username: readStringField(targetBody, "username", { required: true }) as string,
    },
    query: readStringField(objectBody, "query", { required: true }) ?? "",
  };
}
```

### 4. Add Tests (src/server/my-feature-service.test.ts)

```typescript
import { describe, it, expect, vi } from "vitest";
import { MyFeatureService } from "./my-feature-service";

describe("MyFeatureService", () => {
  it("should execute feature", async () => {
    const service = new MyFeatureService();
    const result = await service.executeFeature({
      target: { username: "admin@example.com" },
      query: "test",
    });
    expect(result).toBeDefined();
  });
});
```

### 5. Implement Frontend Component

Create `src/mainview/my-feature/MyFeaturePanel.svelte`:

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { backend } from "../backend/backend-client";
  import type { MyFeatureResult } from "../../shared/my-feature";

  export let activeOrg: OrgListItem;

  let results: MyFeatureResult[] = [];
  let loading = false;

  async function execute() {
    loading = true;
    try {
      results = await backend.executeFeature({
        target: { username: activeOrg.username },
        query: "example",
      });
    } catch (e) {
      console.error(e);
    } finally {
      loading = false;
    }
  }
</script>

<div class="panel">
  <button on:click={execute} disabled={loading}>
    {loading ? "Loading..." : "Execute"}
  </button>

  <ul>
    {#each results as result}
      <li>{result.value}</li>
    {/each}
  </ul>
</div>

<style>
  .panel {
    padding: var(--space-4);
  }
</style>
```

### 6. Add to Backend Client

Update `src/mainview/backend/backend-client.ts`:

```typescript
async executeFeature(req: MyFeatureRequest): Promise<MyFeatureResult[]> {
  const response = await fetch(`${this.apiBaseUrl}/my-feature/execute`, {
    method: 'POST',
    headers: this.getHeaders(),
    body: JSON.stringify(req),
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json();
}
```

### 7. Compose in App.svelte

Add the new component to the app shell:

```svelte
<script>
  import MyFeaturePanel from "./my-feature/MyFeaturePanel.svelte";
</script>

<div class="app">
  <!-- ... existing components ... -->
  <MyFeaturePanel {activeOrg} />
</div>
```

---

## Testing

### Unit Tests

Run with `npm test` (Vitest):

```bash
npm run test              # Run all tests
npm run test -- --watch  # Watch mode
```

**Naming:** `*.test.ts` files live alongside their source.

**Coverage:** Services should have unit tests for:

- Happy paths
- Error conditions
- Edge cases (empty results, null values)

Example:

```typescript
describe("MetadataService", () => {
  it("should list metadata types", async () => {
    const service = new MetadataService();
    const types = await service.listMetadataTypes({
      target: { username: "test@example.com" },
    });
    expect(types).toBeInstanceOf(Array);
  });

  it("should throw on invalid org", async () => {
    const service = new MetadataService();
    await expect(
      service.listMetadataTypes({
        target: { username: "nonexistent@example.com" },
      }),
    ).rejects.toThrow();
  });
});
```

### Component Tests

Svelte component tests use `@testing-library/svelte`:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/svelte";
import OrgDirectory from "./OrgDirectory.svelte";

describe("OrgDirectory", () => {
  it("should render org list", async () => {
    const { container } = render(OrgDirectory, {
      props: { activeOrg: null },
    });
    expect(screen.getByText(/org/i)).toBeInTheDocument();
  });
});
```

### Manual Testing

For features that interact with real Salesforce orgs:

```bash
npm run dev:local  # Frontend on :5173, backend on :8787
```

Then manually test in the browser or with curl:

```bash
curl -i \
  -H 'X-MavMeta-Session: <token>' \
  http://127.0.0.1:8787/api/orgs
```

### Packaged CLI

The `mavmeta` bin is `dist-server/index.cjs`, produced by `npm run build:server` (`scripts/build-server.mjs`). The build injects the version from `package.json` as `__MAVMETA_VERSION__`. `src/cli-args.test.ts` covers argument parsing. To check the built bundle end to end:

```bash
npm run build:server
node scripts/test-cli-bundle.mjs  # Checks --version, --help, and --bogus exit status and output
```

CI builds the packaged CLI and runs `scripts/test-cli-bundle.mjs` on every pull request and push to `master`. It is separate from `npm test` because it requires the built bundle. Run the commands above locally after changing `src/cli*.ts` or the build script.

---

## Code Style

See [AGENTS.md](../AGENTS.md) for detailed style rules. Key points:

- **TypeScript:** `strict` mode enabled
- **Indentation:** 2 spaces everywhere (Prettier `useTabs: false`)
- **Naming:** `PascalCase` for components, `camelCase` for functions/vars
- **Unused variables:** Flagged as errors (`noUnusedLocals`)
- **Design tokens:** Always use CSS custom properties (`--space-*`, `--color-*`, etc.)

Configure blame to ignore the indentation-only commit with `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

---

## Performance Tips

1. **Lazy load components:** Use Svelte `{#if}` or dynamic imports
1. **Memoize expensive computations:** Use view-model functions
1. **Paginate large lists:** Object explorer uses pagination (see `listObjectsPage`)
1. **Bulk queries for large results:** SOQL bulk API for 1M+ rows
1. **Cancel deployments:** Allow users to stop long-running ops

---

## Debugging

### Backend Logs

```bash
npm run dev:server  # Logs appear in terminal
```

All errors are automatically redacted of secrets.

### Frontend Console

```javascript
// browser console
console.log(activeOrg); // Inspect state
```

Errors are redacted before appearing in the console.

### Network Inspector

In your browser's DevTools:

1. Open **Network** tab
1. Watch API requests to `http://localhost:8787/api/*`
1. Inspect request/response bodies
1. Check session token in `X-MavMeta-Session` header

### Breakpoints

```bash
npm run dev:local
# Then open DevTools in browser and set breakpoints in Svelte components
```

---

## Common Issues

| Issue                                 | Solution                                                |
| ------------------------------------- | ------------------------------------------------------- |
| TypeScript errors on import           | Run `npm run typecheck` to see all errors               |
| Component not rendering               | Check `onMount` async functions and error handling      |
| API call returns 401                  | Session token expired—restart MavMeta                   |
| Slow metadata load                    | Orgs with 10K+ components take time; use search filters |
| LWC deploy fails then succeeds slowly | Automatic Tooling→Metadata fallback; this is expected   |

---

## Resources

- [Salesforce Metadata API](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/)
- [Salesforce REST API](https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/)
- [Svelte 5 Docs](https://svelte.dev/docs)
- [Fastify Docs](https://www.fastify.io/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

See [API Reference](api-reference.md) for detailed endpoint documentation.
