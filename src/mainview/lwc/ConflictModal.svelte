<script lang="ts">
	type Props = {
		currentLastModifiedDate: string;
		changedFiles: string[];
		onOverwrite: () => void;
		onReload: () => void;
		onCancel: () => void;
	};

	let { currentLastModifiedDate, changedFiles, onOverwrite, onReload, onCancel }: Props = $props();

	const formattedDate = $derived(new Date(currentLastModifiedDate).toLocaleString());
</script>

<div class="modal-backdrop">
	<div
		class="modal conflict-modal"
		role="dialog"
		aria-modal="true"
		aria-label="Deployment conflict"
	>
		<div>
			<p class="eyebrow danger-text">Conflict Detected</p>
			<h2>The org was modified after you loaded this bundle</h2>
		</div>

		<p>
			The bundle was last modified in the org at <strong>{formattedDate}</strong>, which is newer
			than the version you loaded. The following files may have changed:
		</p>

		<ul class="conflict-file-list">
			{#each changedFiles as filePath (filePath)}
				<li>{filePath}</li>
			{/each}
		</ul>

		<div class="modal-actions">
			<button class="btn btn--ghost" type="button" onclick={onCancel}>Cancel</button>
			<button class="btn btn--ghost" type="button" onclick={onReload}>Reload from Org</button>
			<button class="btn btn--danger" type="button" onclick={onOverwrite}>
				Overwrite Anyway
			</button>
		</div>
	</div>
</div>

<style>
	.conflict-modal {
		max-width: 520px;
	}

	.conflict-file-list {
		font-size: 13px;
		font-family: monospace;
		background: var(--code-bg, #111);
		padding: 8px 16px;
		border-radius: 4px;
		max-height: 160px;
		overflow-y: auto;
	}
</style>
