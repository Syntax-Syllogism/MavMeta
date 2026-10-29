# MavMeta Features Guide

This guide covers the major features of MavMeta and how to use them effectively.

## Table of Contents

1. [Org Management](#org-management)
1. [Metadata Explorer](#metadata-explorer)
1. [Object Manager](#object-manager)
1. [Metadata Cart Workflow](#metadata-cart-workflow)
1. [REST Explorer](#rest-explorer)
1. [SOQL Explorer](#soql-explorer)
1. [LWC Playground](#lwc-playground)
1. [Scratch Org Management](#scratch-org-management)

---

## Org Management

Org Management is the entry point to MavMeta. It handles authentication, org switching, and basic org operations.

### Authenticating an Org

1. In the **Org Directory** pane, click **"Authenticate New Org"**
1. Choose a login URL:
   - `https://login.salesforce.com` for production/sandbox
   - Your custom Salesforce instance URL
1. (Optional) Set a friendly alias (e.g., "dev-sandbox", "production")
1. Complete the OAuth flow in your default browser
1. Return to MavMeta—the org now appears in the list

**Notes:**

- MavMeta reads credentials from the Salesforce CLI (`~/.sf` / `~/.sfdx`)
- No passwords are stored by MavMeta
- Tokens are refreshed automatically

### Quick-Switching Between Orgs

1. Click any org in the directory to make it active
1. If a cart is staged, MavMeta will prompt to confirm the switch (protection against accidental deploys)
1. The active org appears highlighted and is used for all subsequent operations

### Opening an Org in Your Browser

1. Click the **"Open"** button (browser icon) next to an org name
1. The org opens in your default browser, logged in
1. Optionally append a start path (e.g., `/lightning/setup/SetupOneHome/home`) to land in a specific page

### Setting an Org Alias

1. Right-click an org or click its **⋯** menu
1. Select **"Set Alias"**
1. Enter a memorable name (e.g., "staging", "uat-box")
1. Aliases appear in the org list and in deployment confirmations

### Refreshing Org Status

1. Click **"Refresh"** on an org to update its metadata:
   - Sandbox status (production vs sandbox indicator)
   - Token expiry time
   - Scratch org info

### Deleting/Logging Out

- Click **"Logout"** to remove an org from MavMeta
- For scratch orgs, click **"Delete Scratch Org"** to delete the org in the Dev Hub

---

## Metadata Explorer

The Metadata Explorer lets you browse, search, and inspect all metadata components in an org.

### Browsing Metadata Types

1. Open the **Metadata Explorer** (usually the main right panel)
1. The left sidebar shows all metadata types (ApexClass, CustomObject, Page, etc.)
1. Click a type to list its components

### Filtering by Type

1. Type in the **search** field at the top of the type list
1. The list filters as you type (e.g., "Apex" → ApexClass, ApexPage, ApexTrigger)

### Searching for Components

1. After selecting a metadata type, type in the **component search** field
1. Results filter in real time
1. Search matches against component names

### Viewing Component Details

Click any component to see:

- **Full Name:** The internal component identifier
- **File Name:** The path where it's stored (e.g., `classes/MyClass.cls`)
- **Last Modified:** Who changed it and when
- **Metadata ID:** The Salesforce record ID

### Viewing Raw XML

Click **"View Source"** to see the raw XML metadata:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>60.0</apiVersion>
  <status>Active</status>
</ApexClass>
```

This is helpful for:

- Understanding metadata structure
- Copying exact metadata definitions
- Checking API versions and settings

### Adding to Cart

1. Click a component
1. Click **"Add to Cart"**
1. The component is staged for bulk operations (deploy, compare, etc.)

### Grouped vs Flat View

- **Grouped:** Components organized by folder/parent (default for most types)
- **Flat:** All components in a single list
- Toggle in the view options

---

## Object Manager

The Object Manager provides a high-performance browser for standard and custom objects.

### Listing All Objects

1. Open the **Object Manager**
1. All objects (standard + custom) load paginated
1. Columns show:
   - **API Name:** Used in code (e.g., `Account`, `MyCustom__c`)
   - **Label:** Display name in the UI
   - **Type:** Standard or Custom
   - **Key Prefix:** Used in record IDs

### Searching Objects

1. Type in the **search** field
1. Results filter by API name or label
1. Useful for finding custom objects quickly

### Viewing Object Details

Click an object to see its child components:

- **Fields:** All field definitions
- **Validation Rules:** List of validation rules
- **Record Types:** Available record types
- **Other Children:** Layouts, workflows, etc. (depending on object)

### Exploring Field-Level Access

Click a field to check its accessibility:

- Does the current user have read/edit access?
- Is it required, unique, or has validation?
- Field type and length

---

## Metadata Cart Workflow

The Metadata Cart is the heart of MavMeta's bulk operations. It lets you stage components and perform batch deploys.

### Building a Cart

1. Browse the **Metadata Explorer** or **Object Manager**
1. Click **"Add to Cart"** on any component you want to modify, delete, or compare
1. The cart badge shows the count (e.g., "Cart (5)")
1. Click **"View Cart"** to see staged items

### Reviewing Staged Items

The cart displays:

- Metadata type
- Full name
- A list of all components ready for action

### Removing Items

1. In the cart, click **⋯** next to an item
1. Select **"Remove"**

### Clearing the Cart

Click **"Clear Cart"** to remove all staged items at once.

### Choosing an Action

After staging items, select one of these actions:

#### 1. Validate Only

- Tests the deployment without making changes
- Helpful for dry-runs
- Shows any errors/warnings

#### 2. Destructive Deploy

- **Validates first:** Checks for errors
- **Destructive delete:** Deletes components from the org
- **Safety confirmation:** For non-sandbox orgs, you must type the org alias

#### 3. Cross-Org Compare

- Compares staged items between two orgs
- Shows differences (version, last modified, etc.)
- Helps identify drift before deploying

#### 4. Cross-Org Deploy

- Deploys staged items from one org to another
- Useful for promoting changes from dev to staging

### Safety Features

**Org Confirmation Banner:**

- A persistent banner shows the target org and its sandbox status
- Production orgs show in red as a visual warning
- The banner remains until the cart is cleared or deployed

**Non-Sandbox Confirmation Dialog:**

- If deploying to a production org, a confirmation modal appears
- You must **type the exact org alias** to confirm
- Validate-Only operations skip this gate (lower risk)

### Deployment Progress

Once deployed:

1. A progress bar shows deployment status
1. Real-time updates indicate components deployed, errors, etc.
1. On completion, results show:
   - Number of components deployed
   - Any component errors
   - Test run results (if applicable)

### Canceling a Deployment

If a deployment is in progress, click **"Cancel"** to stop it. This works on validate and deploy operations.

---

## REST Explorer

The REST Explorer is a playground for testing Salesforce REST APIs.

### Building a Request

1. Open the **REST Explorer**
1. Select the target org
1. Choose an HTTP method: **GET**, **POST**, **PATCH**, or **DELETE**
1. Enter the API path (e.g., `/services/data/v60.0/sobjects/Account`)
1. (Optional) Add request headers
1. (Optional) Add a request body (for POST/PATCH)

### Common Patterns

**List Accounts:**

```http
GET /services/data/v60.0/sobjects/Account
```

**Get a specific record:**

```http
GET /services/data/v60.0/sobjects/Account/001xx000000001
```

**Create a record:**

```http
POST /services/data/v60.0/sobjects/Account
Content-Type: application/json

{
  "Name": "Acme Corp",
  "Industry": "Technology"
}
```

**Update a record:**

```http
PATCH /services/data/v60.0/sobjects/Account/001xx000000001
Content-Type: application/json

{
  "Industry": "Manufacturing"
}
```

### Viewing Responses

The response pane shows:

- **Status:** HTTP status code and text (e.g., `200 OK`)
- **Headers:** Response headers (Content-Type, etc.)
- **Body:** JSON or text response

JSON responses are formatted for readability.

---

## SOQL Explorer

The SOQL Explorer lets you write, validate, and run SOQL queries.

### Writing a Query

1. Open the **SOQL Explorer**
1. Select the target org and API (REST or Tooling)
1. Write your query in the editor:

   ```soql
   SELECT Id, Name, Industry FROM Account WHERE Industry = 'Technology' LIMIT 10
   ```

### Validating Without Running

Click **"Validate"** to check query syntax without executing it. This is fast and catches typos.

### Running a Query

1. Click **"Run"** or press Ctrl+Enter
1. Results appear in a table below
1. Columns are sortable
1. Rows are live-formatted (dates, numbers, etc.)

### Pagination & Large Results

- By default, queries are limited to a preview (e.g., first 100 rows)
- If there are more rows, a **"Load More"** button appears
- For very large result sets, use **Bulk Query** (see below)

### Exporting Results

1. After running a query, click **"Export"**
1. Choose **CSV** or **JSON**
1. The file downloads automatically

### Using Bulk Query

For result sets with millions of rows:

1. Write your query
1. Click **"Start Bulk Query"**
1. A job ID is assigned
1. Check the job status periodically
1. When done, download the result as CSV

---

## LWC Playground

The LWC Playground is an in-app sandbox for building and testing Lightning Web Components.

### Listing LWC Bundles

1. Open the **LWC Playground**
1. All LWC bundles in the org are listed
1. Bundles show their namespace and component name

### Opening a Bundle

Click a bundle to open it for editing. MavMeta loads all files from the bundle.

### Editing Files

1. Select a file (e.g., `myComponent.js`)
1. Edit the content in the code editor
1. Changes are reflected in real time

### Saving Changes

Click **"Save"** or press Ctrl+S:

- **Fast path:** Uses the Salesforce Tooling API
- **Automatic fallback:** If the bundle imports custom fields via `@salesforce/schema`, the Tooling API may fail (confirmed Salesforce bug). MavMeta automatically retries via the Metadata API, which is slower but always works.
- Saves are transparent—you don't need to worry about which API is used.

### Previewing LWC

The preview pane (right side) shows the component as it would render:

- Live updates as you edit
- Component props and inputs
- Preview uses a local sandbox (Salesforce Tooling API sandbox)

### Error Handling

- Syntax errors appear in the editor with line numbers
- Runtime errors appear in the preview pane
- Console logs are visible in the preview

### Deploying to Org

After testing, click **"Deploy"** to push your component to the org. MavMeta validates syntax before deploying.

---

## Scratch Org Management

Scratch orgs are temporary Salesforce orgs useful for development and testing.

### Creating a Scratch Org

1. Open the **Scratch Org Wizard**
1. Select your **Dev Hub** (the org that creates scratch orgs)
1. Set the **Alias** (e.g., "feature-x-scratch")
1. Set the **Duration** (1-30 days; default 7)
1. (Optional) Customize the definition JSON:

   ```json
   {
     "edition": "Developer",
     "features": ["EnableSetPasswordDelegation"],
     "settings": {...}
   }
   ```

1. Click **"Create"**

### Monitoring Creation

- A progress indicator shows the creation status
- Most scratch orgs take 30-60 seconds
- You can close MavMeta and the creation continues in the background

### Using a Scratch Org

Once created:

1. The scratch org appears in the **Org Directory**
1. Use it like any other org
1. It counts against your Dev Hub's daily scratch org limit

### Deleting a Scratch Org

1. Click **"Delete Scratch Org"** in the org's menu
1. The org is deleted in the Dev Hub
1. It's removed from MavMeta's list

### Using Snapshots

Snapshots save a scratch org state for faster cloning:

1. Open the **Scratch Org Wizard**
1. In the definition JSON, add:

   ```json
   {
     "sourceOrg": "snapshot-id-here"
   }
   ```

1. The new scratch org clones from that snapshot

---

## Keyboard Shortcuts

| Shortcut     | Action                          |
| ------------ | ------------------------------- |
| `Ctrl+Enter` | Run SOQL query or REST request  |
| `Ctrl+S`     | Save LWC file                   |
| `Esc`        | Close modal or cancel operation |
| `Enter`      | Confirm action in dialogs       |

---

## Tips & Best Practices

### Org Safety

- Always use **Validate** before a destructive deploy
- For production orgs, type the alias confirmation slowly to avoid mistakes
- Review the cart before deploying—it's easy to delete the wrong thing

### Performance

- Use **Bulk Query** for large result sets (1M+ rows)
- Filter metadata by type before searching for components
- Close unused panels to reduce memory usage

### Development Workflow

- Use a **scratch org** for feature development
- Use a **sandbox** for testing before production deploy
- Use **REST Explorer** to test APIs before writing code
- Use **SOQL Explorer** to iterate on queries before embedding in code

### Cart Organization

- Add components to cart in small batches (5-10 at a time)
- Review the cart before each action
- Clear the cart after each deploy to avoid confusion

---

## Troubleshooting

| Issue                               | Solution                                                               |
| ----------------------------------- | ---------------------------------------------------------------------- |
| "Invalid Session" error             | Restart MavMeta—the session token is per-launch                        |
| Org list is empty                   | Authenticate an org using the button                                   |
| Metadata type not found             | The type may not exist in this org edition                             |
| Deploy fails with permission error  | Check your org profile/permission sets for the metadata type           |
| LWC save fails then succeeds slowly | The Tooling API failed—MavMeta automatically used Metadata API         |
| Bulk query is stuck                 | Refresh the page and check the job status—Salesforce may be processing |

For more help, see [Security](security.md) or [CONTRIBUTING.md](../CONTRIBUTING.md).
