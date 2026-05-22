<script lang="ts">
  import type { LwcFile } from "../../shared/lwc";

  type Props = {
    files: LwcFile[];
    activeFilePath: string | undefined;
    dirtyPaths: string[];
    onSelectFile: (filePath: string) => void;
  };

  let { files, activeFilePath, dirtyPaths, onSelectFile }: Props = $props();

  function shortName(filePath: string): string {
    return filePath.split("/").pop() ?? filePath;
  }
</script>

<div class="file-tabs" role="tablist" aria-label="Bundle files">
  {#each files as file (file.id)}
    {@const isDirty = dirtyPaths.includes(file.filePath)}
    <button
      role="tab"
      aria-selected={file.filePath === activeFilePath}
      class="file-tab"
      class:active={file.filePath === activeFilePath}
      class:dirty={isDirty}
      type="button"
      onclick={() => onSelectFile(file.filePath)}
    >
      {shortName(file.filePath)}{isDirty ? " â—" : ""}
    </button>
  {/each}
</div>

<style>
  .file-tabs {
    display: flex;
    flex-wrap: nowrap;
    overflow-x: auto;
    border-bottom: 1px solid var(--color-border-subtle);
    background: var(--color-bg-recessed);
    flex-shrink: 0;
  }

  .file-tab {
    padding: 6px 14px;
    border: none;
    border-right: 1px solid var(--color-border-subtle);
    background: transparent;
    cursor: pointer;
    font-size: 0.78rem;
    white-space: nowrap;
    color: var(--color-text-muted);
    transition: background var(--transition-base), color var(--transition-base);
  }

  .file-tab:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-secondary);
  }

  .file-tab.active {
    background: var(--color-bg-panel);
    color: var(--color-text-main);
    border-bottom: 2px solid var(--color-primary);
  }

  .file-tab.dirty {
    color: var(--color-warning);
  }
</style>


