<script lang="ts">
  import type { Snippet } from "svelte";
  import type { LwcCompileError } from "../../shared/lwc";

  type DeployOutcome =
    | { kind: "success"; durationMs: number }
    | { kind: "error"; errors: LwcCompileError[] }
    | { kind: "idle" };

  type Props = {
    outcome: DeployOutcome;
    isDeploying: boolean;
    onJumpToError?: (error: LwcCompileError) => void;
    actions?: Snippet;
  };

  let { outcome, isDeploying, onJumpToError, actions }: Props = $props();

  let isExpanded = $state(true);

  function groupedErrors(errors: LwcCompileError[]): Map<string, LwcCompileError[]> {
    const map = new Map<string, LwcCompileError[]>();
    for (const err of errors) {
      const key = err.filePath || "(unknown file)";
      const group = map.get(key) ?? [];
      group.push(err);
      map.set(key, group);
    }
    return map;
  }

  function errorLocation(err: LwcCompileError): string {
    if (err.line !== undefined && err.column !== undefined) {
      return `:${err.line}:${err.column}`;
    }
    if (err.line !== undefined) {
      return `:${err.line}`;
    }
    return "";
  }
</script>

<div class="status-drawer" class:expanded={isExpanded}>
  <div class="drawer-header">
    <button
      class="drawer-toggle"
      type="button"
      onclick={() => { isExpanded = !isExpanded; }}
      aria-expanded={isExpanded}
      aria-controls="drawer-content"
    >
        <span class="drawer-icon">{isExpanded ? "▾" : "▸"}</span>
      {#if isDeploying}
        <span>Deploying...</span>
      {:else if outcome.kind === "success"}
        <span class="status-success">Deploy successful ({outcome.durationMs}ms)</span>
      {:else if outcome.kind === "error"}
        <span class="status-error">{outcome.errors.length} compile error{outcome.errors.length !== 1 ? "s" : ""}</span>
      {:else}
        <span class="status-idle">Deploy status</span>
      {/if}
    </button>
    {#if actions}
      <div class="drawer-actions">
        {@render actions()}
      </div>
    {/if}
  </div>

  {#if isExpanded}
    <div id="drawer-content" class="drawer-content">
      {#if isDeploying}
        <p class="status-deploying">Deploying to org...</p>
      {:else if outcome.kind === "success"}
        <p class="status-success">Deployed successfully in {outcome.durationMs}ms.</p>
      {:else if outcome.kind === "error"}
        {@const byFile = groupedErrors(outcome.errors)}
        {#each [...byFile.entries()] as [filePath, errors] (filePath)}
          <div class="error-group">
            <p class="error-file">{filePath}</p>
            {#each errors as err}
              <button
                class="error-item"
                type="button"
                onclick={() => onJumpToError?.(err)}
              >
                <span class="error-location">{errorLocation(err)}</span>
                <span class="error-message">{err.message}</span>
              </button>
            {/each}
          </div>
        {/each}
      {:else}
        <p class="status-idle">No deploy has run yet.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .status-drawer {
    border-top: 1px solid var(--color-border-subtle);
    background: var(--color-bg-recessed);
    flex-shrink: 0;
  }

  .drawer-header {
    display: flex;
    align-items: center;
  }

  .drawer-toggle {
    flex: 1;
    text-align: left;
    padding: 6px var(--space-3);
    background: transparent;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.78rem;
    color: var(--color-text-secondary);
    transition: background var(--transition-base);
  }

  .drawer-toggle:hover {
    background: var(--color-bg-hover);
  }

  .drawer-actions {
    display: flex;
    gap: var(--space-2);
    padding: 4px var(--space-3);
    flex-shrink: 0;
  }

  .drawer-content {
    padding: var(--space-2) var(--space-3);
    max-height: 180px;
    overflow-y: auto;
    font-size: 0.78rem;
  }

  .status-success {
    color: var(--color-success);
  }

  .status-error {
    color: var(--color-danger);
  }

  .status-idle {
    color: var(--color-text-muted);
  }

  .status-deploying {
    color: var(--color-text-secondary);
    font-style: italic;
  }

  .error-group {
    margin-bottom: var(--space-3);
  }

  .error-file {
    font-weight: 600;
    color: var(--color-text-muted);
    margin: 0 0 4px;
  }

  .error-item {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px 0;
    color: var(--color-danger);
    font-size: 0.78rem;
  }

  .error-item:hover {
    text-decoration: underline;
  }

  .error-location {
    font-family: monospace;
    color: var(--color-text-muted);
    margin-right: 6px;
  }
</style>


