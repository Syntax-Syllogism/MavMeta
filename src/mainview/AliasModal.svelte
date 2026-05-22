<script lang="ts">
	import type { OrgSummary } from "../shared/org";

	let {
		org,
		aliasDraft = $bindable(),
		isSaving,
		onCancel,
		onSave,
	}: {
		org: OrgSummary;
		aliasDraft: string;
		isSaving: boolean;
		onCancel: () => void;
		onSave: () => void | Promise<void>;
	} = $props();
</script>

<div class="modal-backdrop">
	<div
		class="modal"
		role="dialog"
		aria-modal="true"
		aria-label={`Set alias for ${org.username}`}
	>
		<form
			onsubmit={(event) => {
				event.preventDefault();
				void onSave();
			}}
		>
			<div>
				<p class="eyebrow">Org Alias</p>
				<h2>Set Alias</h2>
			</div>
			<p class="modal-target">{org.username}</p>
			<label>
				Alias
				<input bind:value={aliasDraft} autocomplete="off" />
			</label>
			<div class="modal-actions">
				<button class="btn btn--ghost" type="button" onclick={onCancel}>
					Cancel
				</button>
				<button
					class="btn btn--primary"
					type="submit"
					disabled={!aliasDraft.trim() || isSaving}
				>
					{isSaving ? "Saving" : "Save Alias"}
				</button>
			</div>
		</form>
	</div>
</div>



