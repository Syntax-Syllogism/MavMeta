<script lang="ts">
	import type { OrgSummary } from "../shared/org";

	let {
		org,
		confirmed = $bindable(),
		isDeleting,
		onCancel,
		onConfirm,
	}: {
		org: OrgSummary;
		confirmed: boolean;
		isDeleting: boolean;
		onCancel: () => void;
		onConfirm: () => void | Promise<void>;
	} = $props();
</script>

<div class="modal-backdrop">
	<div
		class="modal"
		role="dialog"
		aria-modal="true"
		aria-label={`Delete scratch org ${org.username}`}
	>
		<form
			onsubmit={(event) => {
				event.preventDefault();
				void onConfirm();
			}}
		>
			<div>
				<p class="eyebrow">Destructive Action</p>
				<h2>Delete Scratch Org</h2>
			</div>
			<p class="modal-target">{org.alias ?? org.username}</p>

			<div class="warning-box">
				<p>
					Deleting this scratch org permanently removes all metadata and data in the org.
					This action is unrecoverable.
				</p>
			</div>

			<label class="checkbox-label">
				<input type="checkbox" bind:checked={confirmed} />
				I understand
			</label>

			<div class="modal-actions">
				<button class="ghost-button" type="button" onclick={onCancel}>
					Cancel
				</button>
				<button
					class="primary-button danger-button"
					type="submit"
					disabled={!confirmed || isDeleting}
				>
					{isDeleting ? "Deleting" : "Confirm Delete"}
				</button>
			</div>
		</form>
	</div>
</div>
