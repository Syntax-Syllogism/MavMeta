<script lang="ts">
	import type { OrgSummary } from "../../shared/org";

	let {
		orgs,
		activeOrg,
		isLoadingOrgs,
		authLoginUrl = $bindable(),
		authAlias = $bindable(),
		isAuthorizing,
		activeAction,
		onRefreshOrgs,
		onAuthOrg,
		onOpenOrg,
		onSetActiveOrg,
		onRefreshOrgStatus,
		onReauthOrg,
		onStartAliasEdit,
		onStartScratchDelete,
		onLogoutOrg,
		onStartCreateScratchOrg,
	}: {
		orgs: OrgSummary[];
		activeOrg: OrgSummary | undefined;
		isLoadingOrgs: boolean;
		authLoginUrl: string;
		authAlias: string;
		isAuthorizing: boolean;
		activeAction: string | undefined;
		onRefreshOrgs: () => void | Promise<void>;
		onAuthOrg: () => void | Promise<void>;
		onOpenOrg: (org: OrgSummary) => void | Promise<void>;
		onSetActiveOrg: (org: OrgSummary) => void | Promise<void>;
		onRefreshOrgStatus: (org: OrgSummary) => void | Promise<void>;
		onReauthOrg: (org: OrgSummary) => void | Promise<void>;
		onStartAliasEdit: (org: OrgSummary) => void;
		onStartScratchDelete: (org: OrgSummary) => void;
		onLogoutOrg: (org: OrgSummary) => void | Promise<void>;
		onStartCreateScratchOrg: () => void;
	} = $props();

	let openMenuRowId = $state<string | null>(null);

	let sortKey = $state<string | null>(null);
	let sortDir = $state<"asc" | "desc">("asc");

	function toggleSort(key: string) {
		if (sortKey === key) {
			sortDir = sortDir === "asc" ? "desc" : "asc";
		} else {
			sortKey = key;
			sortDir = "asc";
		}
	}

	const sortedOrgs = $derived.by(() => {
		if (!sortKey) return orgs;
		const k = sortKey as keyof OrgSummary;
		return [...orgs].sort((a, b) => {
			const av = String(a[k] ?? "");
			const bv = String(b[k] ?? "");
			const cmp = av.localeCompare(bv, undefined, { sensitivity: "base" });
			return sortDir === "asc" ? cmp : -cmp;
		});
	});

	function toggleActionMenu(rowId: string, menuElement: HTMLDetailsElement, event: MouseEvent) {
		event.preventDefault();
		const shouldOpen = openMenuRowId !== rowId;
		openMenuRowId = shouldOpen ? rowId : null;
		syncActionMenus(menuElement, shouldOpen);
	}

	function syncActionMenus(activeMenuElement: HTMLDetailsElement, shouldOpen: boolean) {
		const orgTable = activeMenuElement.closest(".org-table");
		const actionMenus = orgTable?.querySelectorAll<HTMLDetailsElement>("details.action-menu");

		actionMenus?.forEach((actionMenu) => {
			actionMenu.open = actionMenu === activeMenuElement && shouldOpen;
		});
	}

	function formatTrialExpirationDate(org: OrgSummary) {
		if (org.environment !== "scratch") {
			return "n/a";
		}
		if (!org.trialExpirationDate) {
			return "n/a";
		}
		const timestamp = Date.parse(org.trialExpirationDate);
		if (Number.isNaN(timestamp)) {
			return org.trialExpirationDate;
		}
		return new Date(timestamp).toLocaleDateString();
	}

	function getTrialExpirationTitle(org: OrgSummary) {
		const formatted = formatTrialExpirationDate(org);
		if (formatted === "n/a") {
			return "n/a";
		}
		return org.trialExpirationDate ?? formatted;
	}
</script>

<div class="panel org-panel">
	<div class="panel-header">
		<div>
			<p class="eyebrow">Org Management</p>
			<h2>Org Directory</h2>
		</div>
		<div class="panel-header-actions">
			<button class="btn btn--ghost" type="button" onclick={onRefreshOrgs}>
				{isLoadingOrgs ? "Refreshing" : "Refresh Orgs"}
			</button>
			<button class="btn btn--primary" type="button" onclick={onStartCreateScratchOrg}>
				Create Scratch Org
			</button>
		</div>
	</div>

	<form class="auth-form" onsubmit={(event) => event.preventDefault()}>
		<label>
			Login URL
			<input bind:value={authLoginUrl} autocomplete="url" />
		</label>
		<label>
			Alias
			<input bind:value={authAlias} autocomplete="off" placeholder="optional" />
		</label>
		<button
			class="btn btn--primary login-button"
			type="button"
			onclick={onAuthOrg}
			disabled={activeAction === "auth-org"}
		>
			{isAuthorizing ? "Authorizing" : "Auth Org"}
		</button>
	</form>

	{#if orgs.length}
		<div class="org-table" role="table" aria-label="Authenticated orgs">
			<div class="org-row table-heading" role="row">
				<span
					><button
						class="sort-btn"
						class:sorted={sortKey === "alias"}
						onclick={() => toggleSort("alias")}
						>Alias<span class="sort-arrow" aria-hidden="true"
							>{sortKey === "alias" ? (sortDir === "asc" ? "▴" : "▾") : "⇅"}</span
						></button
					></span
				>
				<span
					><button
						class="sort-btn"
						class:sorted={sortKey === "username"}
						onclick={() => toggleSort("username")}
						>Username<span class="sort-arrow" aria-hidden="true"
							>{sortKey === "username" ? (sortDir === "asc" ? "▴" : "▾") : "⇅"}</span
						></button
					></span
				>
				<span
					><button
						class="sort-btn"
						class:sorted={sortKey === "environment"}
						onclick={() => toggleSort("environment")}
						>Environment<span class="sort-arrow" aria-hidden="true"
							>{sortKey === "environment" ? (sortDir === "asc" ? "▴" : "▾") : "⇅"}</span
						></button
					></span
				>
				<span
					><button
						class="sort-btn"
						class:sorted={sortKey === "trialExpirationDate"}
						onclick={() => toggleSort("trialExpirationDate")}
						>Trial Expiration<span class="sort-arrow" aria-hidden="true"
							>{sortKey === "trialExpirationDate" ? (sortDir === "asc" ? "▴" : "▾") : "⇅"}</span
						></button
					></span
				>
				<span
					><button
						class="sort-btn"
						class:sorted={sortKey === "authStatus"}
						onclick={() => toggleSort("authStatus")}
						>Status<span class="sort-arrow" aria-hidden="true"
							>{sortKey === "authStatus" ? (sortDir === "asc" ? "▴" : "▾") : "⇅"}</span
						></button
					></span
				>
				<span></span>
			</div>
			{#each sortedOrgs as org (org.username)}
				<div class:active-row={org.username === activeOrg?.username} class="org-row" role="row">
					<span>
						<button
							class="org-link"
							title={org.alias ?? "Not set"}
							type="button"
							onclick={() => onOpenOrg(org)}
						>
							{org.alias ?? "Not set"}
						</button>
					</span>
					<span>
						<button
							class="org-link username-link"
							title={org.username}
							type="button"
							onclick={() => onOpenOrg(org)}
						>
							{org.username}
						</button>
					</span>
					<span>{org.environment}</span>
					<span title={getTrialExpirationTitle(org)}>{formatTrialExpirationDate(org)}</span>
					<span>{org.authStatus}</span>
					<details class="action-menu" open={openMenuRowId === org.username}>
						<summary
							aria-label={`Actions for ${org.alias ?? org.username}`}
							onclick={(e) => {
								const menuElement = e.currentTarget.parentElement;

								if (menuElement instanceof HTMLDetailsElement) {
									toggleActionMenu(org.username, menuElement, e);
								}
							}}
						>
							Actions
						</summary>
						<div class="action-menu-items">
							<button
								type="button"
								onclick={() => {
									openMenuRowId = null;
									onOpenOrg(org);
								}}
							>
								Open Org
							</button>
							<button
								type="button"
								onclick={() => {
									openMenuRowId = null;
									onSetActiveOrg(org);
								}}
								disabled={org.username === activeOrg?.username}
							>
								{org.username === activeOrg?.username ? "Active Org" : "Use in MavMeta"}
							</button>
							<button
								type="button"
								onclick={() => {
									openMenuRowId = null;
									onRefreshOrgStatus(org);
								}}
							>
								Refresh Status
							</button>
							<button
								type="button"
								onclick={() => {
									openMenuRowId = null;
									onReauthOrg(org);
								}}
							>
								Reauthorize
							</button>
							<button
								type="button"
								onclick={() => {
									openMenuRowId = null;
									onStartAliasEdit(org);
								}}
							>
								Set Alias
							</button>
							{#if org.environment === "scratch"}
								<button
									class="danger-action"
									type="button"
									onclick={() => {
										openMenuRowId = null;
										onStartScratchDelete(org);
									}}
								>
									Delete
								</button>
							{/if}
							<button
								class="danger-action"
								type="button"
								onclick={() => {
									openMenuRowId = null;
									onLogoutOrg(org);
								}}
							>
								Logout
							</button>
						</div>
					</details>
				</div>
			{/each}
		</div>
	{:else}
		<div class="empty-state">
			<h3>No orgs connected</h3>
			<p>MavMeta did not find any local Salesforce CLI auth files.</p>
		</div>
	{/if}
</div>
