# MavMeta API Reference

MavMeta exposes a REST API on `127.0.0.1` (loopback only) for all org management, metadata, and deployment operations. All API requests require a valid session token.

## Session Management

Every MavMeta instance generates a unique session token on startup. The token is:

- **256-bit random** and generated fresh each launch
- **Baked into HTML** as `<meta name="MavMeta-session">` when serving static assets
- **Required on every API call** via the `X-MavMeta-Session` header
- **Constant-time compared** to prevent timing attacks

### Session Bootstrap (Development Only)

In development mode (`npm run dev:local`), bootstrap is enabled:

```http
GET /api/session
X-MavMeta-Bootstrap: 1
```

Returns the session token. The bootstrap endpoint is only available in development and requires the custom header.

## Common Error Responses

All error responses follow this format:

```json
{
  "code": "ERROR_CODE",
  "message": "Human-readable error message"
}
```

Common error codes:

| Code                 | Status | Meaning                                     |
| -------------------- | ------ | ------------------------------------------- |
| `INVALID_SESSION`    | 401    | Missing or incorrect session token          |
| `INVALID_HOST`       | 403    | Host header doesn't match allowed localhost |
| `INVALID_ORIGIN`     | 403    | Cross-origin request from disallowed origin |
| `METHOD_NOT_ALLOWED` | 405    | HTTP method not allowed for this route      |
| `INVALID_REQUEST`    | 400    | Request body validation failed              |
| `INVALID_BODY`       | 400    | Request body is not a valid JSON object     |
| `INVALID_BOOTSTRAP`  | 400    | Missing bootstrap header on `/api/session`  |
| `INTERNAL_ERROR`     | 500    | Unexpected server error                     |

All error messages are redacted of sensitive data (tokens, org URLs, field names).

---

## Org Management

### List Orgs

```http
GET /api/orgs
X-MavMeta-Session: <token>
```

Returns an array of authorized Salesforce orgs:

```json
[
  {
    "username": "admin@example.com",
    "alias": "production",
    "instanceUrl": "https://example.salesforce.com",
    "isSandbox": false,
    "accessTokenExpiresAt": "2026-06-27T18:00:00Z",
    "isActive": true,
    "scratchOrgInfo": null
  }
]
```

### Set Active Org

```http
POST /api/orgs/active
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "username": "admin@example.com",
  "startPath": "/"
}
```

Sets the active org. The `startPath` is optional and must start with `/`.

Response: The updated org object.

### Authenticate Org

```http
POST /api/orgs/auth
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "loginUrl": "https://login.salesforce.com",
  "alias": "my-sandbox"
}
```

Launches the OAuth flow for a new org. Optional `alias` is a friendly name for the org.

Response: The newly authenticated org object.

### Re-authenticate Org

```http
POST /api/orgs/reauth
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "username": "admin@example.com"
}
```

Refreshes the access token for an org.

### Open Org in Browser

```http
POST /api/orgs/open
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "username": "admin@example.com",
  "startPath": "/lightning/setup/SetupOneHome/home"
}
```

Opens the org in the user's default browser. `startPath` is optional.

### Logout Org

```http
POST /api/orgs/logout
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "username": "admin@example.com"
}
```

Removes the org from MavMeta's list.

### Set Org Alias

```http
POST /api/orgs/alias
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "target": {
    "username": "admin@example.com"
  },
  "alias": "my-production"
}
```

Updates the display alias for an org.

### Refresh Org Status

```http
POST /api/orgs/refresh
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "username": "admin@example.com"
}
```

Refreshes org metadata (sandbox status, token expiry, etc.).

### Delete Scratch Org

```http
POST /api/orgs/delete-scratch
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "username": "scratch-org-username@example.com"
}
```

Deletes a scratch org.

---

## Metadata Operations

### List Metadata Types

```http
POST /api/metadata/types
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "target": {
    "username": "admin@example.com"
  }
}
```

Returns all available metadata types in the org:

```json
[
  {
    "metadataType": "ApexClass",
    "xmlName": "ApexClass",
    "childXmlNames": []
  },
  {
    "metadataType": "CustomObject",
    "xmlName": "CustomObject",
    "childXmlNames": ["CustomField", "ValidationRule", "RecordType"]
  }
]
```

### List Metadata Components

```http
POST /api/metadata/components
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "target": {
    "username": "admin@example.com"
  },
  "metadataType": "ApexClass",
  "folder": "classes",
  "search": "MyClass"
}
```

Lists components of a specific type. `folder` and `search` are optional filters.

Returns:

```json
[
  {
    "fullName": "MyClassName",
    "fileName": "classes/MyClassName.cls",
    "lastModifiedByName": "John Doe",
    "lastModifiedDate": "2026-06-20T10:30:00Z",
    "id": "01p7t000000xxx"
  }
]
```

### Get Component Source

```http
POST /api/metadata/component-source
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "target": {
    "username": "admin@example.com"
  },
  "metadataType": "ApexClass",
  "fullName": "MyClassName",
  "fileName": "classes/MyClassName.cls",
  "folder": "classes"
}
```

Returns the raw XML source of a metadata component:

```json
{
  "source": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ApexClass xmlns=\"http://soap.sforce.com/2006/04/metadata\">\n  <apiVersion>60.0</apiVersion>\n  <status>Active</status>\n</ApexClass>"
}
```

### Get Cross-Org Diff

```http
POST /api/metadata/diff
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "source": {
    "username": "source-org@example.com"
  },
  "target": {
    "username": "target-org@example.com"
  },
  "components": [
    {
      "metadataType": "ApexClass",
      "fullName": "MyClassName",
      "fileName": "classes/MyClassName.cls"
    }
  ]
}
```

Compares metadata between two orgs:

```json
[
  {
    "metadataType": "ApexClass",
    "fullName": "MyClassName",
    "sourceVersion": "60",
    "targetVersion": "59",
    "sourceModifiedDate": "2026-06-20T10:30:00Z",
    "targetModifiedDate": "2026-06-10T14:20:00Z",
    "isDifferent": true
  }
]
```

---

## Object Explorer

### List Objects

```http
POST /api/objects/list
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "target": {
    "username": "admin@example.com"
  }
}
```

Returns all objects (standard + custom) in the org.

### List Objects (Paginated)

```http
POST /api/objects/list-page
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "target": {
    "username": "admin@example.com"
  },
  "cursor": "optional-cursor-string",
  "search": "Account",
  "limit": 50
}
```

Paginated object listing. `limit` must be 1-200 (default 50).

Returns:

```json
{
  "objects": [
    {
      "apiName": "Account",
      "label": "Accounts",
      "isCustom": false,
      "keyPrefix": "001"
    }
  ],
  "nextCursor": "next-cursor-or-null"
}
```

### List Object Children

```http
POST /api/objects/children
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "target": {
    "username": "admin@example.com"
  },
  "objectApiName": "Account"
}
```

Lists fields, validation rules, record types, and other child components:

```json
{
  "fields": [
    {
      "apiName": "Id",
      "label": "Account ID",
      "type": "id"
    }
  ],
  "validationRules": [...],
  "recordTypes": [...]
}
```

### Get Field Access

```http
POST /api/fields/access
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "target": {
    "username": "admin@example.com"
  },
  "sobjectType": "Account",
  "fieldFullName": "Industry"
}
```

Returns field-level accessibility for the running user (determined by profile/permission sets).

---

## Deployment

### Start Destructive Deploy

```http
POST /api/deploy/start
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "target": {
    "username": "admin@example.com"
  },
  "mode": "validate",
  "components": [
    {
      "metadataType": "ApexClass",
      "fullName": "MyClassName"
    }
  ]
}
```

Starts a deployment. `mode` is `"validate"` or `"deploy"`. Returns:

```json
{
  "operationId": "0Afxx000000001",
  "status": "InProgress",
  "startTime": "2026-06-27T12:00:00Z"
}
```

### Get Deploy Status

```http
POST /api/deploy/status
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "operationId": "0Afxx000000001"
}
```

Returns the current status of a deployment:

```json
{
  "operationId": "0Afxx000000001",
  "status": "Succeeded",
  "done": true,
  "numberComponentsDeployed": 1,
  "numberComponentErrors": 0,
  "componentFailures": [],
  "runTestResult": null
}
```

### Cancel Deploy

```http
POST /api/deploy/cancel
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "operationId": "0Afxx000000001"
}
```

Cancels an in-progress deployment.

### Start Cross-Org Deploy

```http
POST /api/deploy/cross-org/start
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "source": {
    "username": "source-org@example.com"
  },
  "target": {
    "username": "target-org@example.com"
  },
  "mode": "validate",
  "components": [
    {
      "metadataType": "ApexClass",
      "fullName": "MyClassName"
    }
  ]
}
```

Deploys components from one org to another.

### Get Cross-Org Deploy Status

```http
POST /api/deploy/cross-org/status
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "operationId": "0Afxx000000001"
}
```

Same as regular deploy status.

### Cancel Cross-Org Deploy

```http
POST /api/deploy/cross-org/cancel
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "operationId": "0Afxx000000001"
}
```

---

## REST Explorer

### Execute REST Request

```http
POST /api/rest/execute
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "username": "admin@example.com",
  "method": "GET",
  "path": "/services/data/v60.0/sobjects/Account",
  "headers": {
    "Accept": "application/json"
  },
  "body": null
}
```

Executes a custom REST request against a Salesforce org. `method` is `GET`, `POST`, `PATCH`, or `DELETE`.

Returns:

```json
{
  "statusCode": 200,
  "statusText": "OK",
  "headers": {
    "content-type": "application/json"
  },
  "body": "{...}"
}
```

---

## SOQL

### Describe Global

```http
POST /api/soql/describe-global
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "username": "admin@example.com",
  "api": "rest"
}
```

Returns all queryable objects. `api` is `"rest"` or `"tooling"`.

### Describe Object

```http
POST /api/soql/describe-object
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "username": "admin@example.com",
  "api": "rest",
  "sobject": "Account"
}
```

Returns field metadata for an object.

### Validate Query

```http
POST /api/soql/validate
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "username": "admin@example.com",
  "api": "rest",
  "soql": "SELECT Id, Name FROM Account"
}
```

Validates a SOQL query without executing it.

### Run Query

```http
POST /api/soql/run
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "username": "admin@example.com",
  "api": "rest",
  "soql": "SELECT Id, Name FROM Account LIMIT 10",
  "previewLimit": 10,
  "includeAllPages": false,
  "nextRecordsUrl": null
}
```

Executes a SOQL query. Returns records and pagination info.

### Start Bulk Query

```http
POST /api/soql/bulk/start
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "username": "admin@example.com",
  "soql": "SELECT Id, Name, Email FROM Contact"
}
```

Starts a bulk query job (better for large result sets):

```json
{
  "jobId": "75146000000IZ3",
  "state": "Open"
}
```

### Get Bulk Query Status

```http
POST /api/soql/bulk/status
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "username": "admin@example.com",
  "jobId": "75146000000IZ3"
}
```

Returns the job status and row count.

### Get Bulk Query Result

```http
GET /api/soql/bulk/result?username=admin@example.com&jobId=75146000000IZ3
X-MavMeta-Session: <token>
```

Downloads the bulk query result as CSV. Content-Type is `text/csv`.

---

## Lightning Web Components

### List LWC Bundles

```http
POST /api/lwc/bundles/list
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "orgUsername": "admin@example.com"
}
```

Returns all LWC bundles in the org.

### Get LWC Bundle

```http
POST /api/lwc/bundles/get
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "orgUsername": "admin@example.com",
  "bundleId": "0Rb..."
}
```

Returns the bundle's files and metadata.

### Deploy LWC Bundle

```http
POST /api/lwc/bundles/deploy
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "orgUsername": "admin@example.com",
  "bundleId": "0Rb...",
  "expectedLastModifiedDate": "2026-06-27T12:00:00Z",
  "force": false,
  "files": [
    {
      "path": "myComponent.js",
      "source": "import { LightningElement } from 'lwc';\nexport default class MyComponent extends LightningElement {}"
    }
  ]
}
```

Deploys LWC file changes. If the bundle uses `@salesforce/schema` imports and Tooling API fails, MavMeta automatically retries via Metadata API.

---

## Scratch Org Management

### Create Scratch Org

```http
POST /api/orgs/create-scratch/start
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "devHubUsername": "hub@example.com",
  "alias": "my-scratch",
  "durationDays": 7,
  "definition": {
    "edition": "Developer"
  }
}
```

Starts a scratch org creation. Returns:

```json
{
  "operationId": "async-op-id"
}
```

### Get Scratch Org Creation Status

```http
POST /api/orgs/create-scratch/status
X-MavMeta-Session: <token>
Content-Type: application/json

{
  "operationId": "async-op-id"
}
```

### List Snapshots

```http
GET /api/orgs/snapshots?devHub=hub@example.com
X-MavMeta-Session: <token>
```

Lists available snapshots for scratch org creation.

---

## Health Check

```http
GET /api/health
X-MavMeta-Session: <token>
```

Returns `{ "status": "ok" }`. Use this to verify the backend is responding.
