# MavMeta Security Model

MavMeta runs a small HTTP server on `127.0.0.1` and orchestrates
destructive metadata operations against real Salesforce orgs. This page
describes the threat model we defend against, the mitigations in place,
and how you can verify the claims for yourself.

For how to report a vulnerability, see [SECURITY.md](../SECURITY.md).

## Threat Model

### Actors

- **Malicious web tab.** A page the user visits in any browser, on any
  origin, that tries to reach the MavMeta API by guessing the port or
  via DNS rebinding.
- **Malicious local process.** A non-MavMeta process on the same
  machine that tries to reach the MavMeta API or read its in-memory
  state.
- **Compromised dependency.** A direct or transitive npm package that
  ships hostile code in a postinstall script or in its runtime
  module body.
- **Hostile network.** A public Wi-Fi attacker or on-path observer for
  outbound calls to Salesforce.
- **User error.** A logged-in admin who clicks Deploy on the wrong org.

### Assets

- **Salesforce credentials.** Access tokens, refresh tokens, and
  session IDs held by the `sf` CLI in `~/.sf` and `~/.sfdx`.
- **Destructive deploy capability.** The ability to delete or overwrite
  metadata in any org the user has authorized.
- **Org data.** Metadata and query results retrieved from the user's
  orgs and held in memory during a session.

### Summary of Mitigations

The full implementation lives in
[`notes/work-items/security-concerns.md`](../notes/work-items/security-concerns.md).
The short version:

| Threat                               | Mitigation                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| Drive-by API access from another tab | Per-launch session token in a custom header; strict CORS; CSP                                |
| DNS rebinding                        | Host-header allowlist tied to the active loopback port                                       |
| Port guessing                        | Ephemeral port assigned by the OS on each launch                                             |
| Cross-tab CSRF                       | Custom header forces a CORS preflight; preflight fails the Origin check                      |
| Command injection                    | argv-form spawn calls only; no `shell: true`; metadata-name regex validation                 |
| XXE                                  | No server-side XML parsing — MavMeta emits XML but never consumes it                         |
| Zip-slip                             | ZIP-entry path guard rejects absolute paths, null bytes, and `..` segments                   |
| SSRF                                 | `assertSalesforceHost` allowlist on every outbound `instanceUrl`                             |
| Token leakage in logs                | `redactSecrets` runs on backend logs, frontend `console.*`, and error surfaces               |
| Auth-file corruption                 | Startup guard refuses to open `~/.sf` or `~/.sfdx` in write mode                             |
| Wrong-org deploy                     | Persistent target-org banner + alias-typing confirmation on non-sandbox                      |
| Supply chain                         | Pinned lockfile, `npm audit` CI gate, Dependabot, CDN-free bundle, CI grep for external URLs |

## Network Model

- **Bind address.** The server binds to `127.0.0.1` only. Any value of
  `MAVMETA_HOST` that does not resolve to loopback is rejected at
  startup.
- **Port.** When launched against the served static bundle (`npm
start`), the port is requested as `0` and assigned by the OS. The dev
  server keeps a fixed port for ergonomics.
- **Host-header check.** Every request must have a `Host` header
  matching `127.0.0.1:<port>` or `localhost:<port>`. Mismatches return
  `403 INVALID_HOST`. This is the DNS-rebinding defense.
- **CORS.** Only the served origin is allowed. Cross-origin requests
  are rejected before the route handler runs.
- **Session token.** A 256-bit random token is generated on every
  launch, held in memory, and baked into the served HTML as a
  `<meta name="MavMeta-session">` tag. The frontend reads it at boot
  and sends it on every API request as `X-MavMeta-Session`. Missing
  or mismatched tokens return `401 INVALID_SESSION`. The compare is
  constant-time (`crypto.timingSafeEqual`).
- **Method allowlist.** `/api/*` accepts only `GET`, `POST`, and
  `OPTIONS`. Other methods return `405`.
- **Security headers.** Every response carries CSP, `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a strict
  `Permissions-Policy`, and `Cross-Origin-Opener-Policy: same-origin` /
  `Cross-Origin-Resource-Policy: same-origin`. The CSP `connect-src` is
  pinned to Salesforce hosts only.

## Credential Model

- MavMeta does **not** store any Salesforce credentials of its own.
- All authentication state is read from the `sf` CLI's existing files
  in `~/.sf` and `~/.sfdx`.
- A startup write-guard wraps `fs.open` / `fs.writeFile` /
  `fs.appendFile` (sync and promise variants) for paths under those
  directories:
  - static/release mode (`npx mavmeta`, `mavmeta`, `npm start`, or `--serve-static`): write attempts
    are blocked with an error.
  - dev mode (`npm run dev:local`): write attempts are logged as warnings
    to avoid breaking Salesforce SDK auth-refresh internals during local
    development.
- Tokens that flow through the runtime are passed through
  `redactSecrets` before they reach any log line, error message, or UI
  string. The redactor matches Salesforce access-token shapes
  (`00D...`), JWT shapes (`eyJ...`), bearer-token patterns, and
  field-name-based keys (`accessToken`, `refreshToken`, `sessionId`,
  `clientSecret`, `consumerSecret`).

## Destructive Operations

- While a destructive cart is staged, a persistent banner shows the
  org alias (monospaced), the instance URL, and a `SANDBOX` or
  `PRODUCTION` label computed from the org's `IsSandbox` flag. For
  non-sandbox targets the banner background is red.
- Clicking Deploy against a non-sandbox org opens a confirmation modal
  containing the staged component list (scrollable) and a text input.
  The Deploy button stays disabled until the user types the org alias
  exactly. Validate-Only operations are exempt from this gate.
- Switching orgs while a cart is staged preserves the existing
  cart-protection invariant (see `AGENTS.md` regression list).

## What We Do Not Do

- **No telemetry.** MavMeta makes no analytics, crash-reporting, or
  product-usage network calls.
- **No external CDN.** Fonts, CSS, and JavaScript are bundled locally.
  CI greps the built bundle for external URLs and fails on any hit
  outside the Salesforce allowlist.
- **No persistent storage of credentials.** See Credential Model.
- **No outbound calls outside Salesforce.** The CSP `connect-src` and
  the `assertSalesforceHost` allowlist both enforce this.

## How to Verify Yourself

A reader who wants to confirm these claims locally can do the
following:

1. **Confirm the bind address.** While MavMeta is running:

   ```bash
   lsof -i -P -n | grep node
   ```

   The listening socket should be on `127.0.0.1` only.

1. **Confirm the host-header check.**

   ```bash
   curl -i -H 'Host: evil.example.com' http://127.0.0.1:<port>/api/health
   ```

   Should return `403 INVALID_HOST`.

1. **Confirm the session-token check.**

   ```bash
   curl -i http://127.0.0.1:<port>/api/orgs
   ```

   Should return `401 INVALID_SESSION` (no `X-MavMeta-Session`
   header).

1. **Confirm there are no outbound calls outside Salesforce.** Run
   MavMeta with [Little Snitch](https://www.obdev.at/products/littlesnitch/index.html)
   (macOS) or [OpenSnitch](https://github.com/evilsocket/opensnitch)
   (Linux) in "alert" mode. The only outbound destinations should be
   `*.salesforce.com`, `*.force.com`, `*.lightning.force.com`,
   `*.salesforce-setup.com`, and `*.cloudforce.com`. Alternatively,
   capture traffic with `tcpdump` or Wireshark and grep the SNI for
   non-Salesforce hostnames — there should be none.

1. **Confirm no inline scripts in the bundle.**

   ```bash
   npm run build
   npm run verify:no-inline-scripts
   ```

1. **Confirm no untrusted outbound URLs in the bundle.** The CI
   workflow runs a `grep` job over `dist/` that fails on any
   `https://` URL outside the Salesforce allowlist; you can run the
   same locally.

## What Is Explicitly Out of Scope

The following items were considered and intentionally deferred. They
are not security claims MavMeta makes today:

- An in-app "Network Activity" panel.
- Runtime outbound-allowlist enforcement at the HTTP-client level
  (enforcement is by CI grep + code review).
- Code signing of binaries (no desktop wrapper ships today).
- Bug bounty program, formal third-party audit, SLSA provenance,
  reproducible builds, or published SBOM.
