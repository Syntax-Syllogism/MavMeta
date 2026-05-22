<script lang="ts">
  import { untrack } from "svelte";
  import { backendClient } from "../backend/backend-client";
  import type { OrgSummary } from "../../shared/org";
  import type { RestExecuteResponse, RestMethod } from "../../shared/rest";

  const MUTATING_METHODS: RestMethod[] = ["POST", "PATCH", "DELETE"];

  let {
    activeOrg,
    apiVersion,
  }: {
    activeOrg: OrgSummary | undefined;
    apiVersion: string | undefined;
  } = $props();

  const version = $derived(`v${apiVersion ?? "62.0"}`);
  const defaultPath = $derived(`/services/data/${version}/`);
  const starterPaths = $derived([
    `/services/data/${version}/limits`,
    `/services/data/${version}/sobjects`,
    `/services/data/${version}/query?q=SELECT+Id+FROM+Account+LIMIT+10`,
    `/services/data/${version}/tooling/query?q=SELECT+Id,Name+FROM+ApexClass+LIMIT+10`,
  ]);

  let method = $state<RestMethod>("GET");
  let path = $state(untrack(() => defaultPath));
  let headersText = $state("");
  let bodyText = $state("");
  let showHeaders = $state(false);
  let isLoading = $state(false);
  let error = $state<string | undefined>();
  let response = $state<RestExecuteResponse | undefined>();

  type HistoryEntry = {
    method: RestMethod;
    path: string;
    status: number;
    durationMs: number;
    timestamp: number;
    responseBody: unknown;
    isJson: boolean;
  };
  const MAX_HISTORY_ENTRIES = 20;
  let history = $state<HistoryEntry[]>([]);

  let showConfirm = $state(false);
  let typedConfirmation = $state("");
  let lastOrgUsername = $state(untrack(() => activeOrg?.username));

  $effect(() => {
    if (activeOrg?.username !== lastOrgUsername) {
      lastOrgUsername = activeOrg?.username;
      path = defaultPath;
      response = undefined;
      error = undefined;
      bodyText = "";
      headersText = "";
      showConfirm = false;
      typedConfirmation = "";
    }
  });

  const isMutating = $derived(MUTATING_METHODS.includes(method));
  const isProduction = $derived(activeOrg?.environment === "production");
  const orgLabel = $derived(activeOrg?.alias ?? activeOrg?.username ?? "No active org");
  const confirmPhrase = $derived(activeOrg?.alias ?? activeOrg?.username ?? "");
  const typedConfirmationMatches = $derived(typedConfirmation.trim() === confirmPhrase);

  function parseHeaders(): Record<string, string> | undefined {
    const trimmed = headersText.trim();
    if (!trimmed) return undefined;
    const headers: Record<string, string> = {};
    for (const line of trimmed.split("\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (key) headers[key] = value;
      }
    }
    return Object.keys(headers).length ? headers : undefined;
  }

  async function doSend() {
    if (!activeOrg) return;
    error = undefined;
    response = undefined;
    isLoading = true;
    showConfirm = false;
    typedConfirmation = "";
    try {
      const result = await backendClient.executeRestRequest({
        username: activeOrg.username,
        method,
        path: path.trim(),
        headers: parseHeaders(),
        body: isMutating && bodyText.trim() ? bodyText.trim() : undefined,
      });
      response = result;
      history = [
        {
          method,
          path: path.trim(),
          status: result.status,
          durationMs: result.durationMs,
          timestamp: Date.now(),
          responseBody: result.body,
          isJson: result.isJson,
        },
        ...history.slice(0, MAX_HISTORY_ENTRIES - 1),
      ];
    } catch (e) {
      error = e instanceof Error ? e.message : "Request failed.";
    } finally {
      isLoading = false;
    }
  }

  function handleSubmit() {
    if (!activeOrg) return;
    if (isMutating) {
      showConfirm = true;
    } else {
      void doSend();
    }
  }

  function loadFromHistory(entry: HistoryEntry) {
    method = entry.method;
    path = entry.path;
    response = undefined;
    error = undefined;
  }

  function removeFromHistory(timestamp: number) {
    history = history.filter((entry) => entry.timestamp !== timestamp);
  }

  function triggerDownload(content: string, fileName: string, contentType: string) {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function downloadHistoryEntry(entry: HistoryEntry) {
    const payload = {
      request: {
        method: entry.method,
        path: entry.path,
      },
      response: {
        status: entry.status,
        durationMs: entry.durationMs,
        timestamp: new Date(entry.timestamp).toISOString(),
        body: entry.responseBody,
        isJson: entry.isJson,
      },
    };
    const json = JSON.stringify(payload, null, 2);
    const fileName = `rest-request-${entry.timestamp}.json`;
    triggerDownload(json, fileName, "application/json;charset=utf-8");
  }

  function statusClass(status: number): string {
    if (status >= 200 && status < 300) return "status-ok";
    if (status >= 400 && status < 500) return "status-client-error";
    return "status-server-error";
  }

  function formatResponse(resp: RestExecuteResponse): string {
    if (resp.isJson) {
      try {
        return JSON.stringify(resp.body, null, 2);
      } catch {
        return String(resp.body);
      }
    }
    return String(resp.body);
  }

  function formatTimestamp(ts: number): string {
    return new Date(ts).toLocaleTimeString();
  }
</script>

<div class="panel rest-explorer">
	<div class="panel-header">
		<div>
			<p class="eyebrow">REST Explorer</p>
			<h2>REST Requests</h2>
		</div>
	</div>

	{#if !activeOrg}
    <div class="empty-state">
      <p>Select an active org to use the REST Explorer.</p>
    </div>
  {:else}
    <section class="rest-request-section">
      <p class="eyebrow">REQUEST</p>
      <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
        <div class="rest-request-row">
          <select bind:value={method} disabled={isLoading} aria-label="HTTP method">
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
          </select>
          <input
            class="rest-path-input"
            type="text"
            list="rest-starter-paths"
            bind:value={path}
            disabled={isLoading}
            placeholder="/services/data/v62.0/"
            autocomplete="off"
            spellcheck={false}
            aria-label="Request path"
          />
          <datalist id="rest-starter-paths">
            {#each starterPaths as p}
              <option value={p}></option>
            {/each}
          </datalist>
          <button
            class="btn btn--primary"
            type="submit"
            disabled={isLoading || !path.trim()}
          >
            {isLoading ? "Sending..." : "Send"}
          </button>
        </div>

        <details bind:open={showHeaders}>
          <summary class="rest-details-summary">
            <p class="eyebrow">REQUEST HEADERS</p>
          </summary>
          <label>
            <span class="muted">One per line: Key: Value</span>
            <textarea
              class="rest-textarea"
              bind:value={headersText}
              placeholder={"X-PrettyPrint: 1"}
              disabled={isLoading}
              rows={3}
            ></textarea>
          </label>
        </details>

        {#if isMutating}
          <label>
            <p class="eyebrow">REQUEST BODY</p>
            <textarea
              class="rest-textarea rest-body-textarea"
              bind:value={bodyText}
              placeholder={'{"Name": "My Account"}'}
              disabled={isLoading}
              rows={5}
            ></textarea>
          </label>
        {/if}
      </form>
    </section>

    {#if error}
      <div class="warning-box rest-error" role="alert">
        <strong>Error:</strong> {error}
      </div>
    {/if}

    {#if response}
      <section class="rest-response-section" aria-label="Response">
        <p class="eyebrow">RESPONSE</p>
        <div class="rest-response-meta">
          <span class="rest-status-badge {statusClass(response.status)}" aria-label={`Status ${response.status}`}>
            {response.status}
          </span>
          <span class="muted">{response.durationMs}ms</span>
        </div>
        <pre class="source-view rest-response-body">{formatResponse(response)}</pre>
      </section>
    {/if}

    {#if history.length}
      <section class="rest-history-section" aria-label="Request history">
        <p class="eyebrow">REQUEST HISTORY</p>
        <ul class="rest-history-list">
          {#each history as entry (entry.timestamp)}
            <li>
              <div class="rest-history-row">
                <button
                  class="rest-history-item"
                  type="button"
                  onclick={() => loadFromHistory(entry)}
                >
                  <span class="rest-method-chip {entry.method.toLowerCase()}">{entry.method}</span>
                  <span class="rest-history-path">{entry.path}</span>
                  <span class="rest-status-badge {statusClass(entry.status)}">{entry.status}</span>
                  <span class="muted">{entry.durationMs}ms</span>
                  <span class="muted">{formatTimestamp(entry.timestamp)}</span>
                </button>
                <button
                  class="btn btn--ghost rest-history-action"
                  type="button"
                  onclick={(event) => {
                    event.stopPropagation();
                    downloadHistoryEntry(entry);
                  }}
                >
                  Download JSON
                </button>
                <button
                  class="btn btn--ghost rest-history-action rest-history-action--danger"
                  type="button"
                  aria-label="Delete history entry"
                  title="Delete history entry"
                  onclick={(event) => {
                    event.stopPropagation();
                    removeFromHistory(entry.timestamp);
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</div>

{#if showConfirm}
  <div class="modal-backdrop">
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm mutating request"
    >
      <form
        onsubmit={(e) => {
          e.preventDefault();
          void doSend();
        }}
      >
        <div>
          <p class="eyebrow">Confirm {method} Request</p>
          <h2>{method} {path.length > 60 ? `...${path.slice(-57)}` : path}</h2>
        </div>
        <p class="modal-target">{orgLabel}</p>

        {#if isProduction}
          <div class="warning-box">
            <p>
              This is a <strong>production org</strong>. Mutating requests may
              have unrecoverable side effects.
            </p>
          </div>
          <label>
            <span class="danger-text">Type the org name to authorize this request.</span>
            <input
              type="text"
              bind:value={typedConfirmation}
              placeholder={confirmPhrase}
              autocomplete="off"
            />
          </label>
          <p class="muted">Phrase: <code>{confirmPhrase}</code></p>
        {:else}
          <div class="warning-box">
            <p>This {method} request may modify data in the org.</p>
          </div>
        {/if}

        <div class="modal-actions">
          <button
            class="btn btn--ghost"
            type="button"
            onclick={() => {
              showConfirm = false;
              typedConfirmation = "";
            }}
          >
            Cancel
          </button>
          <button
            class="btn btn--danger"
            type="submit"
            disabled={isProduction ? !typedConfirmationMatches : false}
          >
            Send {method}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}



