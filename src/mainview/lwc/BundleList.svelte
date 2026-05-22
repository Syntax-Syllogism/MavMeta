<script lang="ts">
  import type { LwcBundleSummary } from "../../shared/lwc";
  import { filterBundles } from "./lwc-view-model";

  type Props = {
    bundles: LwcBundleSummary[];
    selectedBundleId: string | undefined;
    isLoading: boolean;
    onSelect: (bundle: LwcBundleSummary) => void;
  };

  let { bundles, selectedBundleId, isLoading, onSelect }: Props = $props();

  let searchQuery = $state("");

  const visibleBundles = $derived(filterBundles(bundles, searchQuery));
</script>

<aside class="bundle-list" aria-label="LWC Bundle List">
  <div class="bundle-list-search">
    <label class="filter-input">
      Filter Bundles
      <input
        type="search"
        placeholder="Search bundles..."
        bind:value={searchQuery}
        aria-label="Search bundles"
      />
    </label>
  </div>

  {#if isLoading}
    <div class="bundle-list-loading" aria-live="polite">Loading bundles...</div>
  {:else if bundles.length === 0}
    <div class="bundle-list-empty">No LWC bundles found in the active org.</div>
  {:else if visibleBundles.length === 0}
    <div class="bundle-list-empty">No bundles match your search.</div>
  {:else}
    <ul class="bundle-list-items" role="listbox" aria-label="LWC bundles">
      {#each visibleBundles as bundle (bundle.id)}
        <li
          role="option"
          aria-selected={bundle.id === selectedBundleId}
          class="bundle-item"
          class:selected={bundle.id === selectedBundleId}
          onclick={() => onSelect(bundle)}
          onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(bundle); }}
          tabindex="0"
        >
          <span class="bundle-name">{bundle.developerName}</span>
          {#if bundle.masterLabel !== bundle.developerName}
            <span class="bundle-label">{bundle.masterLabel}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
  .bundle-list {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }

  .bundle-list-search {
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .bundle-list-loading,
  .bundle-list-empty {
    padding: var(--space-4) 0;
    font-size: 0.82rem;
    color: var(--color-text-muted);
  }

  .bundle-list-items {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    flex: 1;
  }

  .bundle-item {
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
    border-top: 1px solid var(--color-border-subtle);
    display: flex;
    flex-direction: column;
    gap: 2px;
    transition: background var(--transition-base), color var(--transition-base);
    color: var(--color-text-secondary);
  }

  .bundle-item:first-child {
    border-top: 0;
  }

  .bundle-item:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-main);
  }

  .bundle-item.selected {
    background: var(--color-primary-subtle);
    color: var(--color-text-main);
  }

  .bundle-name {
    font-size: 0.82rem;
    font-weight: 500;
  }

  .bundle-label {
    font-size: 0.72rem;
    color: var(--color-text-muted);
  }
</style>


