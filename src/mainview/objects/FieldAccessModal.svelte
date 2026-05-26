<script lang="ts">
	import { onDestroy, onMount } from "svelte";

	import { backendClient } from "../backend/backend-client";
	import { toCsv } from "../soql/soql-csv";
	import Modal from "../common/Modal.svelte";
	import type { FieldAccessResponse, FieldAccessRow } from "../../shared/field-access";
	import type { OrgSummary } from "../../shared/org";
	import {
		buildFieldAccessCsvFilename,
		buildFieldAccessCsvRows,
		filterFieldAccessRows,
	} from "./field-access-view-model";

	let {
		activeOrg,
		sobjectType,
		fieldFullName,
		onClose,
	}: {
		activeOrg: OrgSummary | undefined;
		sobjectType: string;
		fieldFullName: string;
		onClose: () => void;
	} = $props();

	let isLoading = $state(true);
	let errorMessage = $state<string | undefined>();
	let response = $state<FieldAccessResponse | undefined>();
	let search = $state("");
	let includeMutedUsers = $state(false);
	let abortController: AbortController | undefined;

	const filteredRows = $derived(
		filterFieldAccessRows(response?.rows ?? [], search, includeMutedUsers),
	);

	onMount(() => {
		void loadFieldAccess();
	});

	onDestroy(() => {
		abortController?.abort();
	});

	function closeModal() {
		abortController?.abort();
		onClose();
	}

	async function loadFieldAccess() {
		if (!activeOrg) {
			errorMessage = "No active org is selected.";
			isLoading = false;
			return;
		}

		abortController?.abort();
		abortController = new AbortController();
		isLoading = true;
		errorMessage = undefined;

		try {
			response = await backendClient.listFieldAccess(
				{
					target: { username: activeOrg.username },
					sobjectType,
					fieldFullName,
				},
				{ signal: abortController.signal },
			);
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				return;
			}
			errorMessage = error instanceof Error ? error.message : "Failed to load field access.";
			response = undefined;
		} finally {
			if (!abortController.signal.aborted) {
				isLoading = false;
			}
		}
	}

	function exportCsv() {
		if (!filteredRows.length) return;
		const csv = toCsv(buildFieldAccessCsvRows(filteredRows));
		const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = buildFieldAccessCsvFilename(sobjectType, fieldFullName);
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		URL.revokeObjectURL(url);
	}

	function buildUserLink(userId: string): string | undefined {
		return buildOrgLink(
			`/lightning/setup/ManageUsers/page?address=${encodeURIComponent(`/${userId}`)}`,
		);
	}

	function buildSourceLink(row: FieldAccessRow): string | undefined {
		const path =
			row.assignmentType === "Profile"
				? "/lightning/setup/EnhancedProfiles/page"
				: row.assignmentType === "PermissionSet"
					? "/lightning/setup/PermSets/page"
					: "/lightning/setup/PermSetGroups/page";
		return buildOrgLink(`${path}?address=${encodeURIComponent(`/${row.sourceId}`)}`);
	}

	function buildViaPermissionSetLink(viaPermissionSetId: string): string | undefined {
		return buildOrgLink(
			`/lightning/setup/PermSets/page?address=${encodeURIComponent(`/${viaPermissionSetId}`)}`,
		);
	}

	function buildOrgLink(path: string): string | undefined {
		const instanceUrl = activeOrg?.instanceUrl?.trim();
		if (!instanceUrl) return undefined;
		return `${instanceUrl.replace(/\/$/, "")}${path}`;
	}
</script>

<Modal ariaLabel={`Who Has Access: ${fieldFullName}`} onClose={closeModal}>
	<div class="modal field-access-modal">
		<div class="field-access-modal-header">
			<div>
				<p class="eyebrow">Object Explorer</p>
				<h2>Who Has Access?</h2>
				<p class="modal-target">{fieldFullName}</p>
			</div>
			<button class="btn btn--ghost" type="button" onclick={closeModal} data-modal-initial-focus>
				Close
			</button>
		</div>

		{#if isLoading}
			<div class="empty-state">
				<h3>Loading access audit</h3>
				<p>Resolving Profile, Permission Set, Permission Set Group, and muting pathways.</p>
			</div>
		{:else if errorMessage}
			<div class="empty-state">
				<p class="danger-text">{errorMessage}</p>
				<div class="modal-actions">
					<button class="btn btn--ghost" type="button" onclick={closeModal}>Close</button>
					<button class="btn btn--primary" type="button" onclick={loadFieldAccess}>Retry</button>
				</div>
			</div>
		{:else if !response || !response.rows.length}
			<div class="empty-state">
				<h3>No explicit FLS records were found for this field</h3>
				<p>
					This audit reports explicit FieldPermissions grants. Standard fields with base object
					visibility may still be readable without a FieldPermissions row.
				</p>
			</div>
		{:else}
			<div class="field-access-body">
				<div class="field-access-stats">
					<article class="metadata-summary">
						<strong>{response.stats.totalActiveUsersWithAccess}</strong>
						<span>Total Active Users with Access</span>
					</article>
					<article class="metadata-summary">
						<strong>{response.stats.profileGrants}</strong>
						<span>Profiles</span>
					</article>
					<article class="metadata-summary">
						<strong>{response.stats.permissionSetGrants}</strong>
						<span>Permission Sets</span>
					</article>
					<article class="metadata-summary">
						<strong>{response.stats.permissionSetGroupGrants}</strong>
						<span>Permission Set Groups</span>
					</article>
					{#if response.stats.mutedUsers > 0}
						<article class="metadata-summary">
							<strong>{response.stats.mutedUsers}</strong>
							<span>Muted Users</span>
						</article>
					{/if}
				</div>

				<div class="field-access-controls">
					<label class="filter-input">
						Filter
						<input
							bind:value={search}
							autocomplete="off"
							placeholder="User, username, or source name"
						/>
					</label>
					<label class="checkbox-label">
						<input type="checkbox" bind:checked={includeMutedUsers} />
						Include muted users
					</label>
					<button
						class="btn btn--ghost"
						type="button"
						onclick={exportCsv}
						disabled={!filteredRows.length}
					>
						Export CSV
					</button>
				</div>

				{#if response.warnings.length}
					<div class="metadata-errors" role="status">
						{#each response.warnings as warning (warning)}
							<p>{warning}</p>
						{/each}
					</div>
				{/if}

				<div
					class="field-access-table"
					role="table"
					aria-label={`Who has access for ${fieldFullName}`}
				>
					<div class="field-access-row table-heading" role="row">
						<span>User</span>
						<span>Username</span>
						<span>Access Level</span>
						<span>Assignment Type</span>
						<span>Granted By</span>
						<span>Via Perm Set</span>
					</div>
					{#if filteredRows.length}
						{#each filteredRows as row (`${row.userId}::${row.assignmentType}::${row.sourceId}::${row.viaPermissionSetId ?? ""}`)}
							<div class="field-access-row" role="row">
								<span>
									{#if buildUserLink(row.userId)}
										<a
											class="org-link"
											href={buildUserLink(row.userId)}
											target="_blank"
											rel="noreferrer"
										>
											{row.userName}
										</a>
									{:else}
										{row.userName}
									{/if}
								</span>
								<span class="username-link">{row.username}</span>
								<span class:muted-access={row.accessLevel === "None (Muted)"}
									>{row.accessLevel}</span
								>
								<span>{row.assignmentType}</span>
								<span>
									{#if buildSourceLink(row)}
										<a
											class="org-link"
											href={buildSourceLink(row)}
											target="_blank"
											rel="noreferrer"
										>
											{row.sourceName}
										</a>
									{:else}
										{row.sourceName}
									{/if}
								</span>
								<span>
									{#if row.viaPermissionSetId && buildViaPermissionSetLink(row.viaPermissionSetId)}
										<a
											class="org-link"
											href={buildViaPermissionSetLink(row.viaPermissionSetId)}
											target="_blank"
											rel="noreferrer"
										>
											{row.viaPermissionSetName ?? row.viaPermissionSetId}
										</a>
									{:else}
										{row.viaPermissionSetName ?? "n/a"}
									{/if}
								</span>
							</div>
						{/each}
					{:else}
						<div class="empty-state compact-empty">
							<p>No rows match the current filters.</p>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</Modal>

<style>
	.field-access-modal {
		width: min(1180px, 96vw);
		max-height: 92vh;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		gap: var(--space-3);
	}

	.field-access-modal-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.field-access-modal-header h2 {
		margin: 0;
	}

	.field-access-body {
		display: grid;
		grid-template-rows: auto auto auto minmax(0, 1fr);
		gap: var(--space-3);
		min-height: 0;
	}

	.field-access-stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: var(--space-2);
	}

	.field-access-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--space-2);
	}

	.field-access-controls .filter-input {
		min-width: min(380px, 100%);
	}

	.field-access-table {
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius);
		overflow: auto;
		min-height: 0;
	}

	.field-access-row {
		display: grid;
		grid-template-columns:
			minmax(180px, 1fr) minmax(220px, 1.1fr) minmax(110px, 0.7fr)
			minmax(140px, 0.9fr) minmax(170px, 1fr) minmax(170px, 1fr);
		align-items: center;
		gap: 10px;
		padding: 8px var(--space-3);
		border-top: 1px solid var(--color-border-subtle);
		color: var(--color-text-secondary);
		font-size: 0.8rem;
	}

	.field-access-row:first-child {
		border-top: 0;
	}

	.field-access-row span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.muted-access {
		color: var(--color-link-hover);
	}
</style>
