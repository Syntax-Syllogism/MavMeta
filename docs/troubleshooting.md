# Troubleshooting Guide

This guide covers common issues and how to resolve them.

---

## General

### "Invalid Session" or "Invalid Session Token" Error

**Symptom:** API calls fail with `401 INVALID_SESSION`.

**Causes:**

- Session token expired (each MavMeta launch generates a new token)
- Frontend/backend lost sync
- Browser tab stale

**Solutions:**

1. **Restart MavMeta** — This is the quickest fix:

   ```bash
   # Stop: Ctrl+C
   # Restart:
   npm run dev:local
   ```

1. **Refresh the browser** (F5 or Cmd+R) — Reloads the session token

1. **Check the server is running:**

   ```bash
   curl http://127.0.0.1:8787/api/health
   ```

   Should return `{"status":"ok"}`. If it fails, the backend isn't running.

---

### "Invalid Host" or "Invalid Origin" Error

**Symptom:** API calls fail with `403 INVALID_HOST` or `403 INVALID_ORIGIN`.

**Causes:**

- Port changed between frontend and backend
- Browser making requests from wrong origin
- DNS rebinding attempt (rare, but detected by MavMeta)

**Solutions:**

1. **Check ports match:**

   ```bash
   # Frontend should be on http://localhost:5173 (or configured MAVMETA_WEB_PORT)
   # Backend should be on http://127.0.0.1:8787 (or configured MAVMETA_PORT)
   # They must agree
   ```

1. **Restart with matching ports:**

   ```bash
   MAVMETA_PORT=8787 MAVMETA_WEB_PORT=5173 npm run dev:local
   ```

1. **Check Host header** in network tab (DevTools → Network → pick API request):
   - Should be `127.0.0.1:8787` or `localhost:8787`
   - If different, the browser is confused

---

### "Port Already in Use" Error

**Symptom:** `npm run dev:local` fails with "Address already in use".

**Cause:** Another process is using port 5173 (frontend) or 8787 (backend).

**Solutions:**

#### Option 1: Kill the existing process

On macOS/Linux:

```bash
lsof -i :5173
# Shows PID, then:
kill -9 <PID>
```

On Windows (PowerShell):

```powershell
netstat -ano | findstr :5173
# Shows PID, then:
Stop-Process -Id <PID> -Force
```

#### Option 2: Use different ports

```bash
MAVMETA_PORT=9000 MAVMETA_WEB_PORT=3000 npm run dev:local
```

#### Option 3: Wait 60 seconds

OS clears TIME_WAIT state

---

## Org Management

### Org List is Empty

**Symptom:** The Org Directory shows no orgs after launching MavMeta.

**Causes:**

- No orgs authenticated with Salesforce CLI
- Salesforce CLI not installed
- Credential files missing

**Solutions:**

1. **Authenticate an org with Salesforce CLI:**

   ```bash
   sf org login web --instance-url https://login.salesforce.com
   ```

1. **Verify credentials exist:**

   ```bash
   sf org list
   ```

   Should show at least one org. If not, run the login command above.

1. **Check credential files:**
   - `~/.sf/` (new CLI)
   - `~/.sfdx/` (legacy CLI)

   If both are empty, MavMeta won't find orgs.

1. **Restart MavMeta** after adding an org:

   ```bash
   npm run dev:local
   ```

---

### "Org Not Found" Error

**Symptom:** Trying to access an org fails with `ORG_NOT_FOUND`.

**Causes:**

- Org was deleted from Salesforce CLI
- Org username mistyped
- Org data corrupted

**Solutions:**

1. **Verify the org exists:**

   ```bash
   sf org list
   ```

1. **Refresh org status** (MavMeta button) — Reloads from CLI

1. **Re-authenticate** if the org is missing:

   ```bash
   sf org login web --instance-url https://login.salesforce.com
   ```

---

### Can't Open Org in Browser

**Symptom:** Clicking "Open" doesn't open the org.

**Causes:**

- Default browser not configured
- Org URL invalid
- Org is logged out (access token expired)

**Solutions:**

1. **Check default browser:**
   - macOS: `System Preferences → General → Default web browser`
   - Windows: `Settings → Apps → Default apps → Web browser`
   - Linux: `xdg-open https://example.com`

1. **Manually open the org:**
   - Copy the org URL from MavMeta
   - Paste into your browser's address bar

1. **Re-authenticate if needed:**

   ```bash
   sf org login web --instance-url https://login.salesforce.com
   ```

---

### Deploy Asks for Org Alias But I Didn't Set One

**Symptom:** Deploying to production requires typing an alias, but you haven't set one.

**This is intentional**—it's a safety feature. To set an alias:

1. Right-click the org in the directory
1. Click "Set Alias"
1. Enter a name (e.g., "production")
1. Now you can deploy (confirmation will ask for this name)

---

## Metadata Operations

### Metadata Explorer Shows No Components

**Symptom:** After selecting a metadata type, the component list is empty.

**Causes:**

- Metadata type doesn't exist in this org edition
- No components of this type have been created
- Search filter is too narrow
- Org access denied (permission issue)

**Solutions:**

1. **Check the metadata type exists:**
   - Try a different type (e.g., ApexClass, CustomObject)
   - Some types only exist in specific editions

1. **Clear the search filter:**
   - Leave the component search field empty

1. **Check permissions:**
   - Verify your profile/permission sets allow viewing this metadata

1. **Refresh the metadata:**
   - Click "Refresh" on the org
   - Try the metadata type again

---

### "Invalid Metadata Name" Error

**Symptom:** Adding a component to the cart fails with `INVALID_METADATA_NAME`.

**Cause:** The component name contains invalid characters (MavMeta validates names for security).

**Solution:** This is rare. If you see this error:

1. Check the component name doesn't have:
   - Null bytes
   - Relative paths (`..`)
   - Absolute paths (`/`)

1. Report the issue with the component name

---

### Metadata Source Shows as Empty or Malformed

**Symptom:** Viewing a component's XML source shows nothing or garbage.

**Causes:**

- Component is newly created (metadata not yet built)
- Component type uses special handling (e.g., CustomObject with nested fields)
- Network error during retrieval

**Solutions:**

1. **Refresh the org** — Metadata may need time to be indexed

1. **Try a different component** — Some types are more complex

1. **Check network tab** (DevTools):
   - Look for 500 errors
   - Check the response body for error details

---

## Deploy & Cart

### Cart Shows Components But Won't Deploy

**Symptom:** You can add components to the cart, but the Deploy button is disabled or grayed out.

**Causes:**

- No components in the cart (empty cart)
- You didn't choose an action (Validate, Deploy, Compare)
- Deploy is already in progress

**Solutions:**

1. **Check the cart isn't empty:**
   - Click "View Cart"
   - Verify components are listed

1. **Select an action:**
   - Choose "Validate" or "Deploy"
   - Fill in any required fields (like target org)

1. **Wait for existing deploy** to finish

---

### Deploy Shows "No Components Deployed" After Success

**Symptom:** Deployment completes with 0 components deployed but no errors.

**Causes:**

- Components were already identical in target org
- Deploy targeted the wrong org
- Metadata has dependencies (e.g., custom field before custom object)

**Solutions:**

1. **Check the target org** — Confirm via the banner

1. **Review the components** in the cart before deploy

1. **Deploy in dependency order:**
   - CustomObject before CustomField
   - CustomField before RecordType
   - etc.

---

### "Destructive Deploy Not Allowed" or Permission Error

**Symptom:** Deploying fails with a permission error.

**Causes:**

- Your profile/permission set doesn't allow this metadata type
- Org is a read-only sandbox
- Special metadata requires special permissions

**Solutions:**

1. **Check permissions:**
   - Ask your Salesforce admin to grant "Modify All" + "Author Apex" (if deleting Apex)

1. **Try "Validate Only" first:**
   - This often succeeds where Deploy fails
   - Helps identify permission issues

1. **Check the org:**
   - Is it a production org? (You need Delete permission)
   - Is it a read-only org?

---

### Cross-Org Deploy Shows Differences But Won't Deploy

**Symptom:** Running "Compare Orgs" shows differences, but "Deploy to Other Org" doesn't work.

**Causes:**

- Source org doesn't have "read" permission on the metadata
- Target org doesn't have "write" permission
- Metadata exists but with incompatible changes

**Solutions:**

1. **Validate first:**
   - Use "Validate" mode instead of "Deploy"
   - This helps identify which components fail

1. **Deploy individually:**
   - Instead of bulk deploy, try one component at a time
   - Helps narrow down the culprit

1. **Check permissions in both orgs:**
   - Source org: can you view this metadata?
   - Target org: can you modify this metadata?

---

## SOQL Explorer

### Query Returns No Results But Should

**Symptom:** Running a valid SOQL query returns 0 rows.

**Causes:**

- Data doesn't exist in this org
- WHERE clause is too restrictive
- Using wrong API (Tooling vs REST)

**Solutions:**

1. **Simplify the query:**

   ```soql
   -- Start with this:
   SELECT Id FROM Account LIMIT 10

   -- Then add filters gradually:
   SELECT Id FROM Account WHERE Industry = 'Technology' LIMIT 10
   ```

1. **Check data existence:**
   - Use `SELECT COUNT() FROM Account` to verify records exist

1. **Try the other API:**
   - REST API queries user data
   - Tooling API queries metadata
   - Some objects are tooling-only

---

### Query Validation Succeeds But Execution Fails

**Symptom:** "Validate" passes, but "Run" fails.

**Causes:**

- Validation checks syntax only, not permissions
- Query uses aggregate functions incorrectly
- Governor limits hit during execution

**Solutions:**

1. **Check permissions:**
   - Can your profile read the fields in the query?
   - Can you read the object itself?

1. **Simplify the query:**
   - Remove aggregate functions
   - Remove subqueries
   - Add `LIMIT 1`

1. **Check field names:**
   - Typos aren't caught by validation
   - Copy exact API names from "Describe Object"

---

### Bulk Query is Stuck

**Symptom:** Bulk query started but status shows "Open" or "InProgress" for hours.

**Causes:**

- Salesforce is still processing the query
- Very large result set (1B+ records)
- Network connectivity issue

**Solutions:**

1. **Wait longer:**
   - Bulk queries can take 5-30 minutes for large orgs
   - Check back in 5 minutes

1. **Check Salesforce's API limits:**
   - Very large queries may be throttled
   - Try narrowing the query (add WHERE clause)

1. **Restart the query:**
   - If it's been > 1 hour, cancel and start a new bulk query

---

### Can't Export Results as CSV

**Symptom:** "Export" button is grayed out or click does nothing.

**Causes:**

- No results to export
- Query is still running
- Browser blocked the download

**Solutions:**

1. **Wait for query to finish:**
   - Ensure the result count shows > 0

1. **Check browser settings:**
   - Allow downloads from `localhost:*`
   - Check Downloads folder

1. **Try JSON export instead:**
   - Different download mechanism
   - May work if CSV fails

---

## REST Explorer

### Request Fails with 401 or 403

**Symptom:** REST call fails with `401 Unauthorized` or `403 Forbidden`.

**Causes:**

- Access token expired
- Org uses IP whitelist / login-as-needed
- Your user lacks permission for this endpoint

**Solutions:**

1. **Refresh the org:**
   - MavMeta button to refresh credentials

1. **Re-authenticate:**

   ```bash
   sf org login web --instance-url https://login.salesforce.com
   ```

1. **Try the REST Explorer from within Salesforce:**
   - Use the browser's DevTools console to call the same endpoint
   - Verify the endpoint works with your token

---

### Response Body is Truncated or Empty

**Symptom:** Making a request returns incomplete or empty response.

**Causes:**

- Response is very large (network limit)
- Request body syntax error
- Content-Type mismatch

**Solutions:**

1. **Check Content-Type header:**
   - Ensure it matches your request body
   - For JSON: `Content-Type: application/json`

1. **Simplify the request:**
   - Try a simpler endpoint first
   - Then gradually add complexity

1. **Check request syntax:**
   - Verify JSON is valid
   - Try the same request in `curl` or Postman

---

## LWC Playground

### LWC Bundle Won't Save

**Symptom:** Clicking "Save" shows an error or the file doesn't change.

**Causes:**

- Syntax errors in the code
- Metadata conflicts (last-modified date mismatch)
- Permissions issue (not authorized to edit LWC)
- Special imports that need fallback (Tooling→Metadata API)

**Solutions:**

1. **Check for syntax errors:**
   - Look for red squiggles in the editor
   - Fix all JavaScript/CSS errors

1. **Force save:**
   - Check "Force" checkbox and try again
   - This overwrites metadata conflicts

1. **Check permissions:**
   - Verify your profile allows editing LWC

1. **Wait for automatic fallback:**
   - If using `@salesforce/schema` imports, save may retry via Metadata API
   - This takes extra time (30-60s) but succeeds

---

### Preview Shows Blank or Error

**Symptom:** LWC preview pane is blank or shows a JavaScript error.

**Causes:**

- Component hasn't rendered (async loading)
- Syntax error in component
- Missing required props
- Component uses unavailable APIs (e.g., custom Apex)

**Solutions:**

1. **Check the browser console** (DevTools → Console):
   - Look for JavaScript errors

1. **Simplify the component:**
   - Remove external dependencies
   - Hard-code props instead of binding

1. **Try a minimal example:**

   ```javascript
   import { LightningElement } from "lwc";
   export default class Hello extends LightningElement {
     name = "World";
   }
   ```

1. **Check dependencies:**
   - Make sure all imported modules exist
   - Try `@salesforce/core` instead of custom modules

---

### Can't Find LWC Bundle

**Symptom:** Your LWC bundle doesn't appear in the bundle list.

**Causes:**

- Bundle was just created (metadata index delay)
- Bundle isn't an LWC (e.g., it's an Aura component)
- Org doesn't have LWC enabled

**Solutions:**

1. **Refresh the org:**
   - Metadata index may need time to update

1. **Check it's a Lightning Web Component:**
   - In Salesforce setup, search "Lightning Web Component"
   - Verify the bundle is listed there

1. **Verify LWC is enabled:**
   - Enable in `Setup → Platform Cache` (LWC is a prerequisite)

---

## Scratch Orgs

### Can't Create Scratch Org

**Symptom:** Clicking "Create" shows an error or the operation hangs.

**Causes:**

- Dev Hub not authenticated
- Dev Hub has reached daily limit (25 free/day)
- Definition JSON is invalid
- No DevOps Center license (some features)

**Solutions:**

1. **Verify Dev Hub is authenticated:**

   ```bash
   sf org list --all
   # Should show a Dev Hub org
   ```

1. **Authenticate Dev Hub if missing:**

   ```bash
   sf org login web --instance-url https://login.salesforce.com --set-default-dev-hub
   ```

1. **Check daily limit:**
   - Wait until tomorrow (limit resets 24h after first creation)
   - Or buy more scratch orgs in Salesforce

1. **Validate definition JSON:**
   - Copy it into a JSON validator
   - Ensure no trailing commas or syntax errors

---

### Scratch Org Creation Hangs

**Symptom:** "Creating..." spinner runs for > 10 minutes.

**Causes:**

- Salesforce is actually creating the org (normal for some definitions)
- Network disconnected
- MavMeta crashed (server stopped)

**Solutions:**

1. **Wait 5-10 more minutes:**
   - Scratch org creation can take 2-5 minutes normally

1. **Check MavMeta is still running:**

   ```bash
   curl http://127.0.0.1:8787/api/health
   ```

1. **Check Salesforce org creation:**
   - In Salesforce Dev Hub, go to `Setup → Scratch Org Requests`
   - Look for a request with status "Creating"

1. **Cancel and retry:**
   - Refresh the page (cancels the MavMeta operation)
   - Start a new creation

---

### Scratch Org Appears But I Can't Open It

**Symptom:** Scratch org in the list but "Open" button does nothing or fails.

**Causes:**

- Org was deleted but list wasn't refreshed
- Org credentials expired
- Browser default not configured

**Solutions:**

1. **Refresh the org list:**
   - Click "Refresh" on the org or close/reopen MavMeta

1. **Manually open:**
   - Get the org username from MavMeta
   - Run: `sf org open --target-org <username>`

1. **Check browser default:**
   - macOS: `System Preferences → General → Default web browser`
   - Windows: `Settings → Apps → Default apps`

---

## Performance

### MavMeta is Slow or Freezing

**Symptom:** UI is sluggish, buttons take time to respond, or app freezes.

**Causes:**

- Org has 10K+ components (metadata load time)
- Large SOQL result set (browser rendering)
- Memory pressure (Node heap full)
- Browser tab running in background

**Solutions:**

1. **Narrow your search:**
   - Use type/component filters
   - Don't load all metadata at once
1. **Use pagination:**
   - Object Explorer already paginates (good)
   - SOQL limits results by default
1. **Increase Node heap:**

   ```bash
   NODE_OPTIONS="--max-old-space-size=4096" npm run dev:local
   ```

1. **Close unused MavMeta windows:**
   - Each instance uses ~200MB
1. **Switch to bulk query:**
   - For large SOQL results, use Bulk Query (1M+ rows)

---

### API Calls Take a Long Time

**Symptom:** Metadata loading, deploys, or queries are slow.

**Causes:**

- Salesforce is slow (org has many components)
- Network latency
- API is rate-limited

**Solutions:**

1. **Check Salesforce API status:**
   - Visit [status.salesforce.com](https://status.salesforce.com)
1. **Narrow your operation:**
   - Filter metadata by type
   - Use WHERE clauses in SOQL
   - Deploy fewer components at once
1. **Try again later:**
   - If org is slow, Salesforce may be under load

---

## Getting Help

### Reproducing an Issue

When reporting a bug, include:

1. **MavMeta version:**

   ```bash
   npm list @syntax-syllogism/mavmeta
   # or:
   mavmeta --version
   ```

1. **Your setup:**
   - OS (macOS, Windows, Linux)
   - Node version: `node --version`
   - Salesforce org type (production, sandbox, scratch)

1. **Steps to reproduce:**
   - Exact sequence of clicks/actions
   - Code if using REST/SOQL explorers

1. **Error message:**
   - Copy from MavMeta status bar or browser console
   - Include full error code (e.g., `INVALID_REQUEST`)

1. **Logs:**
   - Terminal output from `npm run dev:local`
   - Browser console (F12 → Console tab)

### Where to Report

- **Issues:** [GitHub Issues](https://github.com/Syntax-Syllogism/MavMeta/issues)
- **Security:** [SECURITY.md](../SECURITY.md)
- **Discussions:** [GitHub Discussions](https://github.com/Syntax-Syllogism/MavMeta/discussions)

---

## Quick Reference

| Symptom                      | Quick Fix                                        |
| ---------------------------- | ------------------------------------------------ |
| "Invalid Session"            | Restart: Ctrl+C, then `npm run dev:local`        |
| Port already in use          | `MAVMETA_PORT=9000 npm run dev:local`            |
| No orgs showing              | `sf org login web`, then restart MavMeta         |
| Deploy button disabled       | Check cart has components, select action         |
| SOQL query slow              | Use Bulk Query for 1M+ rows                      |
| LWC save fails then succeeds | Automatic Tooling→Metadata fallback, wait 30-60s |
| MavMeta freezing             | Narrow filters, use pagination, increase heap    |

See [Configuration](configuration.md) for detailed setup help, and [API Reference](api-reference.md) for endpoint details.
