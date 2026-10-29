# Configuration Guide

MavMeta is primarily configured via environment variables and the Salesforce CLI. This guide covers both.

## Environment Variables

### Backend (Node Server)

Set these before starting the server:

| Variable           | Default      | Description                                  |
| ------------------ | ------------ | -------------------------------------------- |
| `MAVMETA_HOST`     | `127.0.0.1`  | Server bind address (localhost only)         |
| `MAVMETA_PORT`     | `8787`       | Server port (packaged CLI: OS-assigned)      |
| `MAVMETA_WEB_PORT` | `5173`       | Frontend Vite dev server port                |
| `NODE_ENV`         | `production` | Node environment (production or development) |

### Examples

**Run on a specific port:**

```bash
MAVMETA_PORT=9000 npm start
```

**Development with custom ports:**

```bash
MAVMETA_PORT=9000 MAVMETA_WEB_PORT=3000 npm run dev:local
```

**Production mode:**

```bash
NODE_ENV=production npm start
```

---

## Salesforce CLI Configuration

MavMeta uses the Salesforce CLI's credential store. No additional setup is needed—just authenticate orgs with the CLI first:

```bash
# Authenticate a production org
sf org login web --instance-url https://login.salesforce.com

# Authenticate a sandbox
sf org login web --instance-url https://test.salesforce.com

# List all authenticated orgs
sf org list
```

Credentials are stored in:

- `~/.sf/` (newer Salesforce CLI v2)
- `~/.sfdx/` (legacy Salesforce CLI v1)

MavMeta reads from both automatically.

---

## Scratch Org Configuration

When creating a scratch org, you can customize the definition JSON. This is where you control:

- Edition (Developer, Professional, etc.)
- Features to enable
- Settings and metadata

### Basic Definition

```json
{
  "edition": "Developer",
  "durationDays": 7,
  "features": ["EnableSetPasswordDelegation"]
}
```

### Common Configuration Options

**Enable specific features:**

```json
{
  "edition": "Developer",
  "features": [
    "EnablePackaging",
    "EnableChatter",
    "EnableCommunities",
    "EnableServiceCloud",
    "EnableContentManagement",
    "EnableActualizer",
    "EnableIdentityConnect"
  ]
}
```

**Pre-populate settings:**

```json
{
  "edition": "Developer",
  "settings": {
    "orgPreferenceSettings": {
      "s1DesktopEnabled": true,
      "s1EncryptedStoragePerm2": false
    },
    "securitySettings": {
      "passwordPolicies": {
        "expiration": "Never",
        "lockoutInterval": 15,
        "maxLoginAttempts": 5
      }
    }
  }
}
```

**Clone from snapshot:**

```json
{
  "sourceOrg": "2SR7t0000002Mw",
  "durationDays": 7
}
```

### Pro Tips

- **Minimize scratches:** Only enable features you need (they add setup time)
- **Use snapshots:** Save time by cloning a configured scratch org
- **Batch creation:** Create multiple scratches in parallel by opening multiple MavMeta windows
- **Default settings:** Store commonly-used definitions in a file:

  ```bash
  cat > ~/.sf/scratch-definition.json << 'EOF'
  {
    "edition": "Developer",
    "durationDays": 7,
    "features": ["EnableChatter"]
  }
  EOF
  ```

---

## Host & Port Configuration (Development)

### Why Port 5173?

By default, Vite runs the frontend on `http://localhost:5173` and the backend runs on `http://127.0.0.1:8787`. Both are required:

- If `5173` is busy, `npm run dev:local` fails fast
- The backend's CSP and CORS allowlist must exactly match the frontend origin
- A mismatch causes session token errors

### Fixing Port Conflicts

**Check what's using port 5173:**

On macOS/Linux:

```bash
lsof -i :5173
```

On Windows:

```bash
netstat -ano | findstr :5173
```

**Use a different port:**

```bash
MAVMETA_WEB_PORT=3000 npm run dev:local
```

**Or kill the existing process:**

On macOS/Linux:

```bash
kill -9 <PID>
```

On Windows (PowerShell):

```powershell
Stop-Process -Id <PID> -Force
```

---

## Production Deployment

### Bundling for Release

```bash
npm run build           # Build frontend & backend
npm start               # Start in production mode (ephemeral port)
```

The `npm start` process:

1. Builds the frontend (Vite → dist/)
1. Builds the backend (esbuild → dist-server/)
1. Starts the server
1. Serves the built frontend from the backend
1. Opens the app in your default browser on an ephemeral port

### Running the CLI

```bash
# Install globally
npm install -g @syntax-syllogism/mavmeta

# Or run without installing
npx @syntax-syllogism/mavmeta@latest

# Run as command
mavmeta
```

The CLI does the same as `npm start`:

1. Starts the server on an OS-assigned port
1. Opens the app in your browser
1. Cleans up on exit

#### CLI Options

```bash
mavmeta --help     # Usage and environment variables (-h also works)
mavmeta --version  # Prints "mavmeta <version>"
```

`--help` and `--version` print to stdout and exit `0` without starting the server or opening a browser. Any other unknown option or positional argument prints an error and a `Run mavmeta --help` hint to stderr and exits `2`. `--serve-static` is accepted for compatibility and is not listed in help.

The packaged CLI reads `MAVMETA_HOST` and `MAVMETA_PORT`. Setting `MAVMETA_PORT` makes it bind that port instead of an OS-assigned one. `MAVMETA_WEB_PORT` only affects the source development servers.

### Ephemeral Ports

In production, the port is requested as `0` (OS-assigned). This is **intentional** and provides security:

- **Port unpredictability:** An attacker can't guess the port
- **Multi-instance safe:** Run multiple MavMeta instances simultaneously
- **No conflicts:** Always gets an available port

The browser receives the port via the served HTML's `<meta name="MavMeta-port">` tag.

---

## Security Configuration

MavMeta's security is mostly built-in, but here's what you should know:

### Loopback Binding

The server **always** binds to `127.0.0.1`. Any other value is rejected:

```bash
# This will fail:
MAVMETA_HOST=0.0.0.0 npm start
# Error: Invalid MAVMETA_HOST: must be localhost/127.0.0.1

# This is correct:
MAVMETA_HOST=127.0.0.1 npm start
```

### Session Token

A new 256-bit token is generated on each launch:

- Baked into the served HTML as `<meta name="MavMeta-session">`
- Sent on every API request as `X-MavMeta-Session` header
- Verified with constant-time comparison
- Expires when the server stops

**Note:** You don't need to configure this; it's automatic.

### Credential Protection

- **Write guard:** Prevents MavMeta from modifying `~/.sf` or `~/.sfdx` files (release mode)
- **Log redaction:** All logs, errors, and console messages are redacted of secrets
- **CORS:** Only the served origin is allowed
- **CSP:** Restricts script execution and external connections

See [security.md](security.md) for the full threat model.

---

## Troubleshooting Configuration

| Problem                          | Solution                                                   |
| -------------------------------- | ---------------------------------------------------------- |
| "MAVMETA_HOST must be localhost" | Don't set `MAVMETA_HOST` to external IPs                   |
| Port already in use              | Kill the existing process or use `MAVMETA_PORT=9000`       |
| Frontend can't reach backend     | Check CORS allowlist in `app.ts` (usually auto-configured) |
| "Invalid session token"          | Restart MavMeta—token is per-launch                        |
| Scratch org creation fails       | Check Dev Hub permissions with `sf org list --all`         |
| Metadata operations timeout      | Large orgs (10K+ components) take time; use filters        |
| Can't authenticate org           | Run `sf org login web` first to verify Salesforce CLI      |
| `mavmeta: Unknown option '--x'`  | Run `mavmeta --help` to see supported options              |

---

## Environment Examples

### Local Development

```bash
# One-liner for dev with default ports
npm run dev:local

# Dev with custom backend port
MAVMETA_PORT=9000 npm run dev:local

# Dev with custom frontend port
MAVMETA_WEB_PORT=3000 npm run dev:local
```

### Production / Release

```bash
# Build and run (ephemeral port, auto-opens browser)
npm start

# Or use the CLI
npx @syntax-syllogism/mavmeta@latest

# With custom backend port (less common)
MAVMETA_PORT=9000 npm start
```

### CI/Testing

```bash
# Typecheck + tests
npm run typecheck
npm run test

# Linting
npm run lint
npm run format:check
npm run markdownlint

# Build only (no run)
npm run build
npm run build:server
```

---

## Performance Tuning

### Node.js Options

For very large orgs (50K+ metadata components), increase Node's heap:

```bash
NODE_OPTIONS="--max-old-space-size=4096" npm start
```

### Frontend Optimization

MavMeta already:

- Lazy-loads components (MetadataExplorer, LwcPlayground)
- Paginates object lists (50 objects per page)
- Uses view-model functions to avoid re-renders

For even better performance:

- Use **search filters** to reduce loaded metadata
- Use **bulk queries** for large SOQL result sets
- Create **snapshots** for common scratch org configs

---

## Logs & Debugging

### Backend Logs

```bash
npm run dev:server
# Logs appear in terminal with timestamps
```

Common log levels:

- `info` — Requests, org operations
- `warn` — Deprecated APIs, slow operations
- `error` — API errors, failed deploys (secrets redacted)

### Frontend Logs

Open the browser's **Developer Tools** (F12) → **Console**:

```javascript
// Inspect the active org
console.log(activeOrg);

// Check backend client state
console.log(backend.sessionToken);
```

All logs are redacted of credentials.

### Network Inspection

**Browser DevTools** → **Network** tab:

1. Watch requests to `http://localhost:8787/api/*`
1. Inspect `X-MavMeta-Session` header (present in every request)
1. Check response status codes (401 = invalid session, 403 = invalid origin)

---

## Reference

For more details, see:

- [API Reference](api-reference.md) — All endpoint options
- [Features Guide](features-guide.md) — How to use each feature
- [Developer Guide](developer-guide.md) — Architecture & extending
- [Security](security.md) — Full threat model
- [README.md](../README.md) — Quick start
