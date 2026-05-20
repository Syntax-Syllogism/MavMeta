<script lang="ts">
  import { backendClient } from "../backend/backend-client";
  import type { OrgSummary } from "../../shared/org";
  import type { LwcBundleSummary, LwcCompileError, LwcFile } from "../../shared/lwc";
  import { lwcBundleListCache } from "./lwc-cache";
  import { computeDirtyFiles, inferLanguageFromPath, sortBundleFiles } from "./lwc-view-model";
  import BundleList from "./BundleList.svelte";
  import FileTabs from "./FileTabs.svelte";
  import CodeEditor from "./CodeEditor.svelte";
  import DeployStatusDrawer from "./DeployStatusDrawer.svelte";
  import ConflictModal from "./ConflictModal.svelte";

  type DeployOutcome =
    | { kind: "success"; durationMs: number }
    | { kind: "error"; errors: LwcCompileError[] }
    | { kind: "idle" };

  type Props = {
    activeOrg: OrgSummary | undefined;
  };

  let { activeOrg }: Props = $props();

  let bundles = $state<LwcBundleSummary[]>([]);
  let isLoadingBundles = $state(false);
  let selectedBundle = $state<LwcBundleSummary | undefined>();
  let loadedFiles = $state<LwcFile[]>([]);
  let loadedLastModifiedDate = $state<string | undefined>();
  let isLoadingBundle = $state(false);
  let currentSources = $state<Map<string, string>>(new Map());
  let activeFilePath = $state<string | undefined>();
  let isDeploying = $state(false);
  let deployOutcome = $state<DeployOutcome>({ kind: "idle" });
  let conflictData = $state<{ currentLastModifiedDate: string; changedFiles: string[] } | undefined>();
  let statusMessage = $state("");
  let pendingForce = $state(false);
  let isDirtyGuardOpen = $state(false);
  let pendingBundleSwitch = $state<LwcBundleSummary | undefined>();

  const sortedFiles = $derived(sortBundleFiles(loadedFiles));
  const dirtyFiles = $derived(computeDirtyFiles(loadedFiles, currentSources));
  const hasDirty = $derived(dirtyFiles.length > 0);
  const activeFile = $derived(loadedFiles.find((f) => f.filePath === activeFilePath));
  const activeSource = $derived(
    activeFilePath !== undefined ? (currentSources.get(activeFilePath) ?? "") : "",
  );
  const activeLanguage = $derived(
    activeFilePath ? inferLanguageFromPath(activeFilePath) : ("unknown" as const),
  );
  const canDeploy = $derived(hasDirty && !isDeploying && !!selectedBundle);
  const activeOrgLabel = $derived(activeOrg?.alias ?? activeOrg?.username ?? "No active org");

  $effect(() => {
    // Clear state when org switches
    const _org = activeOrg;
    bundles = [];
    selectedBundle = undefined;
    loadedFiles = [];
    loadedLastModifiedDate = undefined;
    currentSources = new Map();
    activeFilePath = undefined;
    deployOutcome = { kind: "idle" };
    conflictData = undefined;
    statusMessage = "";

    if (_org) {
      void loadBundles(_org.username);
    }
  });

  async function loadBundles(orgUsername: string) {
    const cached = lwcBundleListCache.get(orgUsername);
    if (cached) {
      bundles = cached;
      statusMessage = `${cached.length} bundles loaded from cache.`;
      return;
    }

    isLoadingBundles = true;
    statusMessage = "Loading LWC bundles...";
    try {
      const result = await backendClient.listLwcBundles({ orgUsername });
      bundles = result.bundles;
      lwcBundleListCache.set(orgUsername, result.bundles);
      statusMessage = `${result.bundles.length} bundles loaded.`;
    } catch (error) {
      statusMessage = toErrorMessage(error);
    } finally {
      isLoadingBundles = false;
    }
  }

  function requestBundleSelect(bundle: LwcBundleSummary) {
    if (hasDirty) {
      pendingBundleSwitch = bundle;
      isDirtyGuardOpen = true;
      return;
    }
    void selectBundle(bundle);
  }

  function confirmBundleSwitch() {
    const bundle = pendingBundleSwitch;
    pendingBundleSwitch = undefined;
    isDirtyGuardOpen = false;
    if (bundle) {
      void selectBundle(bundle);
    }
  }

  function cancelBundleSwitch() {
    pendingBundleSwitch = undefined;
    isDirtyGuardOpen = false;
  }

  async function selectBundle(bundle: LwcBundleSummary) {
    if (!activeOrg) return;

    selectedBundle = bundle;
    loadedFiles = [];
    currentSources = new Map();
    activeFilePath = undefined;
    deployOutcome = { kind: "idle" };
    conflictData = undefined;

    isLoadingBundle = true;
    statusMessage = `Loading ${bundle.developerName}...`;

    const requestedBundleId = bundle.id;
    const requestedOrg = activeOrg.username;

    try {
      const result = await backendClient.getLwcBundle({
        orgUsername: requestedOrg,
        bundleId: requestedBundleId,
      });

      if (selectedBundle?.id !== requestedBundleId || activeOrg?.username !== requestedOrg) {
        return;
      }

      loadedFiles = result.files;
      loadedLastModifiedDate = result.bundle.lastModifiedDate;

      const sources = new Map<string, string>();
      for (const file of result.files) {
        sources.set(file.filePath, file.source);
      }
      currentSources = sources;

      if (result.files.length > 0) {
        activeFilePath = result.files[0].filePath;
      }

      statusMessage = `Loaded ${bundle.developerName} (${result.files.length} files).`;
    } catch (error) {
      statusMessage = toErrorMessage(error);
    } finally {
      isLoadingBundle = false;
    }
  }

  function handleFileChange(filePath: string, source: string) {
    const updated = new Map(currentSources);
    updated.set(filePath, source);
    currentSources = updated;
  }

  function handleEditorChange(source: string) {
    if (activeFilePath) {
      handleFileChange(activeFilePath, source);
    }
  }

  async function deploy(force = false) {
    if (!activeOrg || !selectedBundle || !loadedLastModifiedDate) return;

    const filesToDeploy = loadedFiles
      .filter((f) => {
        const current = currentSources.get(f.filePath);
        return current !== undefined && (force || current !== f.source);
      })
      .map((f) => ({ path: f.filePath, source: currentSources.get(f.filePath) ?? f.source }));

    if (!filesToDeploy.length && !force) {
      statusMessage = "No dirty files to deploy.";
      return;
    }

    isDeploying = true;
    conflictData = undefined;
    statusMessage = "Deploying to org...";

    try {
      const result = await backendClient.deployLwcBundle({
        orgUsername: activeOrg.username,
        bundleId: selectedBundle.id,
        files: filesToDeploy,
        expectedLastModifiedDate: loadedLastModifiedDate,
        force,
      });

      if (result.status === "success") {
        loadedLastModifiedDate = result.newLastModifiedDate;
        // Sync the snapshot with what was deployed
        const updated = new Map<string, string>();
        for (const file of loadedFiles) {
          updated.set(file.filePath, currentSources.get(file.filePath) ?? file.source);
        }
        loadedFiles = loadedFiles.map((f) => ({
          ...f,
          source: currentSources.get(f.filePath) ?? f.source,
          lastModifiedDate: result.newLastModifiedDate,
        }));
        deployOutcome = { kind: "success", durationMs: result.durationMs };
        statusMessage = `Deployed ${selectedBundle.developerName} in ${result.durationMs}ms.`;
      } else if (result.status === "error") {
        deployOutcome = { kind: "error", errors: result.errors };
        statusMessage = `Deploy failed: ${result.errors.length} error${result.errors.length !== 1 ? "s" : ""}.`;
      } else if (result.status === "conflict") {
        conflictData = {
          currentLastModifiedDate: result.currentLastModifiedDate,
          changedFiles: result.changedFiles,
        };
        statusMessage = "Deploy conflict — org was modified after you loaded this bundle.";
      }
    } catch (error) {
      statusMessage = toErrorMessage(error);
    } finally {
      isDeploying = false;
    }
  }

  async function handleConflictOverwrite() {
    conflictData = undefined;
    await deploy(true);
  }

  async function handleConflictReload() {
    conflictData = undefined;
    if (selectedBundle) {
      await selectBundle(selectedBundle);
    }
  }

  function handleConflictCancel() {
    conflictData = undefined;
  }

  function revert() {
    if (!selectedBundle) return;
    const reverted = new Map<string, string>();
    for (const file of loadedFiles) {
      reverted.set(file.filePath, file.source);
    }
    currentSources = reverted;
    statusMessage = "Reverted to loaded version.";
  }

  function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Request failed.";
  }
</script>

<div class="lwc-playground">
  {#if !activeOrg}
    <div class="playground-empty">
      <p>Select an active org to browse and edit Lightning Web Components.</p>
    </div>
  {:else}
    <div class="playground-panels">
      <div class="bundle-panel panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">LWC Playground</p>
            <h2>{activeOrgLabel}</h2>
          </div>
        </div>
        <BundleList
          {bundles}
          selectedBundleId={selectedBundle?.id}
          isLoading={isLoadingBundles}
          onSelect={requestBundleSelect}
        />
      </div>

      <div class="editor-panel">
        {#if isLoadingBundle}
          <div class="editor-loading">Loading bundle...</div>
        {:else if !selectedBundle}
          <div class="editor-empty">Select a bundle from the list to start editing.</div>
        {:else if loadedFiles.length === 0}
          <div class="editor-empty">No files found in this bundle.</div>
        {:else}
          <FileTabs
            files={sortedFiles}
            {activeFilePath}
            dirtyPaths={dirtyFiles}
            onSelectFile={(path) => { activeFilePath = path; }}
          />

          <div class="editor-body">
            {#if activeFile}
              <CodeEditor
                value={activeSource}
                language={activeLanguage}
                onChange={handleEditorChange}
              />
            {/if}
          </div>

          <DeployStatusDrawer outcome={deployOutcome} {isDeploying}>
            {#snippet actions()}
              {#if hasDirty}
                <span class="dirty-indicator">Dirty: {dirtyFiles.map((p) => p.split("/").pop()).join(", ")}</span>
              {/if}
              <button
                class="ghost-button"
                type="button"
                onclick={revert}
                disabled={!hasDirty || isDeploying}
              >
                Revert
              </button>
              <button
                class="primary-button"
                type="button"
                onclick={() => void deploy()}
                disabled={!canDeploy}
              >
                {isDeploying ? "Deploying..." : "Deploy to Org"}
              </button>
            {/snippet}
          </DeployStatusDrawer>
        {/if}
      </div>
    </div>
  {/if}

  {#if statusMessage}
    <div class="playground-status" aria-live="polite">{statusMessage}</div>
  {/if}
</div>

{#if conflictData}
  <ConflictModal
    currentLastModifiedDate={conflictData.currentLastModifiedDate}
    changedFiles={conflictData.changedFiles}
    onOverwrite={handleConflictOverwrite}
    onReload={handleConflictReload}
    onCancel={handleConflictCancel}
  />
{/if}

{#if isDirtyGuardOpen}
  <div class="modal-backdrop">
    <div class="modal" role="dialog" aria-modal="true" aria-label="Unsaved changes">
      <p class="eyebrow danger-text">Unsaved Changes</p>
      <h2>You have unsaved edits</h2>
      <p>Switching bundles will discard your local changes to {selectedBundle?.developerName}.</p>
      <div class="modal-actions">
        <button class="ghost-button" type="button" onclick={cancelBundleSwitch}>Cancel</button>
        <button class="primary-button danger-button" type="button" onclick={confirmBundleSwitch}>
          Discard & Switch
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .lwc-playground {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    gap: var(--space-2);
  }

  .playground-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: var(--color-text-muted);
    font-size: 0.82rem;
  }

  .playground-panels {
    display: grid;
    grid-template-columns: 260px 1fr;
    gap: 1rem;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .bundle-panel {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .editor-panel {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
    border: 1px solid var(--color-border-subtle);
    background: var(--color-bg-panel);
    border-radius: var(--radius);
    box-shadow: var(--shadow-sm);
  }

  .editor-loading,
  .editor-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: var(--color-text-muted);
    font-size: 0.82rem;
  }

  .editor-body {
    flex: 1;
    overflow: hidden;
  }

  .dirty-indicator {
    font-size: 0.78rem;
    color: var(--color-warning);
  }

  .playground-status {
    padding: 6px var(--space-4);
    font-size: 0.78rem;
    border-top: 1px solid var(--color-border-subtle);
    color: var(--color-text-muted);
    flex-shrink: 0;
  }
</style>
