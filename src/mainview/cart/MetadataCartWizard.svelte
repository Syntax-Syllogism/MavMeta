<script lang="ts">
	import Fish from "@lucide/svelte/icons/fish";
	import type { CrossOrgDeployResult, DestructiveDeployResult } from "../../shared/deploy";
	import type { CrossOrgDiffResult } from "../../shared/metadata";
	import type { OrgSummary } from "../../shared/org";
	import type { CartAction, CartStep, StagedItem, StagedItemGroup } from "./cart-view-model";
	import type { DeployMode } from "./types";
	import type { SavedMetadataShoppingList, SavedMetadataShoppingListItem } from "./saved-shopping-lists";
	import { formatItemCount, hasCompareXml } from "./cart-view-model";
	import DiffViewerModal from "./DiffViewerModal.svelte";
	import {
		getDeployResultId,
		getDeploySuccessCount,
		getFailureMessage,
	} from "../deploy/deploy-view-model";

	let {
		isOpen,
		cartTitle,
		cartSubtitle,
		cartWorkflowSteps,
		cartStep,
		cartStepIndex,
		cartAction,
		activeOrgLabel,
		activeOrgStagedItems,
		stagedItemGroups,
		saveListName = $bindable(),
		isListSaved,
		isLoadingSavedList,
		savedShoppingLists,
		skippedSavedListItems,
		runMode = $bindable(),
		preflightDeployableCount,
		isProductionLikeTarget,
		deployConfirmationPhrase,
		deployTypedConfirmation = $bindable(),
		preflightSkippedComponents,
		isRunningDeploy,
		deployProgressPercent,
		deployProgressMessage,
		lastDeployResult,
		canRunDeleteAction,
		canDeployValidatedResult,
		canDeployValidatedCrossOrgResult,
		deployTypedConfirmationMatches,
		sourceOrgLabel,
		compareTargetOptions,
		compareTargetUsername,
		compareTargetLabel,
		compareResults,
		isRunningCompare,
		onSelectCompareTarget,
		onClose,
		onFinish,
		onSaveList,
		onLoadSavedList,
		onRenameSavedList,
		onDeleteSavedList,
		onExportSavedList,
		onImportPackageXml,
		onClearCart,
		onRemoveStagedItem,
		onSelectCartAction,
		onSetCartStep,
		onContinueFromActions,
		onRunDelete,
			onRunCompare,
			onDeployValidatedResult,
			onDeployValidatedCrossOrgResult,
			onOpenDeploymentStatusTargetOrg,
			onOpenSpecificDeploymentStatus,
			onCancelRunningDeploy,
			quirkyDeployMessage,
		}: {
		isOpen: boolean;
		cartTitle: string;
		cartSubtitle: string;
		cartWorkflowSteps: Array<{ step: CartStep; label: string }>;
		cartStep: CartStep;
		cartStepIndex: number;
		cartAction?: CartAction;
		activeOrgLabel: string;
		activeOrgStagedItems: StagedItem[];
		stagedItemGroups: StagedItemGroup[];
		saveListName: string;
		isListSaved: boolean;
		isLoadingSavedList: boolean;
		savedShoppingLists: SavedMetadataShoppingList[];
		skippedSavedListItems: SavedMetadataShoppingListItem[];
		runMode: DeployMode;
		preflightDeployableCount: number;
		isProductionLikeTarget: boolean;
		deployConfirmationPhrase: string;
		deployTypedConfirmation: string;
		preflightSkippedComponents: Array<{ metadataType: string; fullName: string; reason: string }>;
		isRunningDeploy: boolean;
		deployProgressPercent: number;
		deployProgressMessage: string;
		lastDeployResult?: DestructiveDeployResult | CrossOrgDeployResult;
		canRunDeleteAction: boolean;
		canDeployValidatedResult: boolean;
		canDeployValidatedCrossOrgResult: boolean;
		deployTypedConfirmationMatches: boolean;
		sourceOrgLabel: string;
		compareTargetOptions: OrgSummary[];
		compareTargetUsername?: string;
		compareTargetLabel: string;
		compareResults: CrossOrgDiffResult[];
		isRunningCompare: boolean;
		onSelectCompareTarget: (username: string) => void;
		onClose: () => void;
		onFinish: () => void;
		onSaveList: () => void;
		onLoadSavedList: (listId: string) => void;
		onRenameSavedList: (listId: string) => void;
		onDeleteSavedList: (listId: string) => void;
		onExportSavedList: (listId: string) => void;
		onImportPackageXml: (file: File) => void | Promise<void>;
		onClearCart: () => void;
		onRemoveStagedItem: (itemId: string) => void;
		onSelectCartAction: (action: CartAction) => void;
		onSetCartStep: (step: CartStep) => void;
		onContinueFromActions: () => void;
		onRunDelete: () => void;
			onRunCompare: () => void;
			onDeployValidatedResult: () => void;
			onDeployValidatedCrossOrgResult: () => void;
			onOpenDeploymentStatusTargetOrg: () => void | Promise<void>;
			onOpenSpecificDeploymentStatus: () => void | Promise<void>;
			onCancelRunningDeploy: () => void | Promise<void>;
			quirkyDeployMessage: string;
		} = $props();

	let openDiffResult: CrossOrgDiffResult | null = $state(null);
	let openSavedListMenuRowId = $state<string | null>(null);

	$effect(() => {
		if (!isOpen) {
			openDiffResult = null;
		}
	});

	$effect(() => {
		if (!isOpen || !isRunningDeploy) return;

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				void onCancelRunningDeploy();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	});

	const isCrossOrgDeployAction = $derived(cartAction === "deploy");
	const progressVerb = $derived(
		cartAction === "deploy"
			? runMode === "validate"
				? "Validating"
				: "Deploying"
			: runMode === "validate"
				? "Validating"
				: "Deleting",
	);
	const resultActionLabel = $derived(
		cartAction === "deploy"
			? runMode === "validate"
				? "Cross-org validation"
				: "Cross-org deploy"
			: runMode === "validate"
				? "Destructive validation"
				: "Destructive deploy",
	);
	const runActionLabel = $derived(
		cartAction === "deploy"
			? runMode === "validate"
				? "Run Validate"
				: "Confirm & Deploy"
			: runMode === "validate"
				? "Run Validate"
				: "Confirm & Run",
	);
	const runActionAriaLabel = $derived(
		cartAction === "deploy"
			? runMode === "validate"
				? "Run Validate"
				: "Run Deploy"
			: runMode === "validate"
				? "Run Validate"
				: "Run Delete",
	);
	const groupedCompareResults = $derived.by(() => {
		const grouped = new Map<string, CrossOrgDiffResult[]>();
		for (const result of compareResults) {
			const entries = grouped.get(result.metadataType) ?? [];
			entries.push(result);
			grouped.set(result.metadataType, entries);
		}
		return Array.from(grouped.entries())
			.map(([metadataType, results]) => ({
				metadataType,
				results: results.toSorted((left, right) => left.fullName.localeCompare(right.fullName)),
			}))
			.sort((left, right) => left.metadataType.localeCompare(right.metadataType));
	});
	const compareStateSummary = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const result of compareResults) {
			counts.set(result.state, (counts.get(result.state) ?? 0) + 1);
		}
		return Array.from(counts.entries())
			.map(([state, count]) => ({ state, count }))
			.sort((left, right) => left.state.localeCompare(right.state));
	});
	const rawDeployDiagnostics = $derived(
		lastDeployResult?.rawResult
			? JSON.stringify(lastDeployResult.rawResult, null, 2)
			: undefined,
	);
	const canOpenSpecificDeployment = $derived.by(() => {
		const candidate = lastDeployResult?.rawResult && typeof lastDeployResult.rawResult === "object"
			? (lastDeployResult.rawResult as Record<string, unknown>).id
			: undefined;
		return typeof candidate === "string" && /^0Af[a-zA-Z0-9]{12,15}$/.test(candidate.trim());
	});
	function formatSavedListTimestamp(value: string) {
		const timestamp = Date.parse(value);
		if (Number.isNaN(timestamp)) {
			return "Unknown";
		}
		return new Date(timestamp).toLocaleString();
	}

	function toggleSavedListActionMenu(
		rowId: string,
		menuElement: HTMLDetailsElement,
		event: MouseEvent,
	) {
		event.preventDefault();
		const shouldOpen = openSavedListMenuRowId !== rowId;
		openSavedListMenuRowId = shouldOpen ? rowId : null;
		const listTable = menuElement.closest(".org-table");
		const actionMenus = listTable?.querySelectorAll<HTMLDetailsElement>("details.action-menu");
		actionMenus?.forEach((actionMenu) => {
			actionMenu.open = actionMenu === menuElement && shouldOpen;
		});
	}
</script>

{#if isOpen}
	<div class="modal-backdrop cart-drawer-backdrop">
		<div class="cart-drawer" role="dialog" aria-modal="true" aria-label="Metadata cart workflow">
			<header class="cart-drawer-header">
				<div class="cart-title-row">
					<span class="cart-header-icon" aria-hidden="true">
						<svg viewBox="0 0 24 24" focusable="false">
							<path d="M5 5h2l1.2 9.2a2 2 0 0 0 2 1.8h6.7a2 2 0 0 0 1.9-1.4L21 8H8" />
							<circle cx="10" cy="20" r="1.4" />
							<circle cx="18" cy="20" r="1.4" />
						</svg>
					</span>
					<div>
						<h2>{cartTitle}</h2>
						<p>{cartSubtitle}</p>
					</div>
				</div>
				<button class="icon-button close-drawer-button" type="button" onclick={onClose} aria-label="Close">
					<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
						<path d="m6 6 12 12M18 6 6 18" />
					</svg>
				</button>
			</header>

			<nav class="cart-stepper-shell" aria-label="Cart workflow progress">
				<ol class="cart-stepper">
					{#each cartWorkflowSteps as workflowStep, index (workflowStep.step)}
						<li class:active={index === cartStepIndex} class:complete={index < cartStepIndex}>
							<span class="step-marker" aria-hidden="true">
								{#if index < cartStepIndex}
									<svg viewBox="0 0 24 24" focusable="false">
										<path d="m6 12 4 4 8-8" />
									</svg>
								{:else}
									{index + 1}
								{/if}
							</span>
							<span class="step-label">{workflowStep.label}</span>
						</li>
					{/each}
				</ol>
			</nav>

			<section class="cart-drawer-body">
				{#if cartStep === "list"}
					<section class="save-list-feature" aria-label="Save staged metadata list">
						<div class="save-input-group">
							<input bind:value={saveListName} autocomplete="off" placeholder="my saved list" aria-label="Saved list name" />
							<button class="primary-button save-list-button" type="button" onclick={onSaveList} disabled={!saveListName.trim() || isListSaved}>
								<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
									<path d="M5 4h12l2 2v14H5z" />
									<path d="M8 4v6h8V4M8 17h8" />
								</svg>
								{isListSaved ? "Saved" : "Save"}
							</button>
						</div>
						{#if isListSaved}
							<p class="success-text">List saved successfully.</p>
						{/if}
					</section>

					<details class="staged-review saved-lists-details">
						<summary>Saved Lists ({savedShoppingLists.length})</summary>
						<div class="saved-lists-panel">
							{#if savedShoppingLists.length}
								<div class="org-table" role="table" aria-label="Saved shopping lists">
									<div class="org-row saved-list-row table-heading" role="row">
										<span>Name</span>
										<span>Items</span>
										<span>Updated</span>
										<span></span>
									</div>
									{#each savedShoppingLists as list (list.id)}
										<div class="org-row saved-list-row" role="row">
											<span class="component-name-cell" title={list.name}>{list.name}</span>
											<span>{formatItemCount(list.items.length)}</span>
											<span title={list.updatedAt}>{formatSavedListTimestamp(list.updatedAt)}</span>
											<details class="action-menu" open={openSavedListMenuRowId === list.id}>
												<summary
													aria-label={`Actions for ${list.name}`}
													onclick={(event) => {
														const menuElement = event.currentTarget.parentElement;
														if (menuElement instanceof HTMLDetailsElement) {
															toggleSavedListActionMenu(list.id, menuElement, event);
														}
													}}
												>
													Actions
												</summary>
												<div class="action-menu-items">
													<button type="button" disabled={isLoadingSavedList} onclick={() => { openSavedListMenuRowId = null; onLoadSavedList(list.id); }}>
														Load into cart
													</button>
													<button type="button" onclick={() => { openSavedListMenuRowId = null; onRenameSavedList(list.id); }}>
														Rename
													</button>
													<button type="button" onclick={() => { openSavedListMenuRowId = null; onExportSavedList(list.id); }}>
														Export package.xml
													</button>
													<button class="danger-action" type="button" onclick={() => { openSavedListMenuRowId = null; onDeleteSavedList(list.id); }}>
														Delete
													</button>
												</div>
											</details>
										</div>
									{/each}
								</div>
							{:else}
								<div class="empty-state compact-empty">
									<p>No saved lists yet.</p>
								</div>
							{/if}
							{#if skippedSavedListItems.length}
								<details class="skipped-details">
									<summary>View {skippedSavedListItems.length} skipped components</summary>
									<div class="skipped-list">
										{#each skippedSavedListItems as skipped (`${skipped.metadataType}:${skipped.fullName}`)}
											<p><code>{skipped.metadataType}:{skipped.fullName}</code></p>
										{/each}
									</div>
								</details>
							{/if}
						</div>
					</details>

					<section class="staged-review" aria-label="Items review">
						<div class="review-heading">
							<p class="eyebrow">Items Review</p>
							<div class="review-actions">
								<label class="ghost-button drawer-secondary-action file-import-button">
									Import package.xml
									<input
										type="file"
										accept=".xml,text/xml,application/xml"
										style="display: none;"
										onchange={(event) => {
											const file = event.currentTarget.files?.[0];
											if (file) {
												void onImportPackageXml(file);
											}
											event.currentTarget.value = "";
										}}
									/>
								</label>
								<button class="text-danger-button" type="button" onclick={onClearCart} disabled={!activeOrgStagedItems.length}>
									Clear All
								</button>
							</div>
						</div>

						{#if activeOrgStagedItems.length}
							<div class="staged-list-container">
								{#each stagedItemGroups as group (group.metadataType)}
									<section class="staged-group" aria-label={`${group.metadataType} staged items`}>
										<header class="staged-group-header">
											<span>{group.metadataType}</span>
											<span>{formatItemCount(group.items.length)}</span>
										</header>
										<div class="staged-group-items">
											{#each group.items as item (item.id)}
												<div class="staged-item-row">
													<span class="component-name-cell" title={item.fullName}>{item.fullName}</span>
													<button class="icon-button remove-action" type="button" onclick={() => onRemoveStagedItem(item.id)} aria-label="Remove">
														<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
															<path d="M6 7h12M10 11v6M14 11v6M9 7V4h6v3M8 7l1 13h6l1-13" />
														</svg>
													</button>
												</div>
											{/each}
										</div>
									</section>
								{/each}
							</div>
						{:else}
							<div class="empty-state compact-empty">
								<p>No staged metadata. Stage components from Metadata Explorer first.</p>
							</div>
						{/if}
					</section>
				{:else if cartStep === "actions"}
					<section class="cart-section-heading">
						<p class="eyebrow">Select Target Action</p>
						<p>How should MavMeta process these {formatItemCount(activeOrgStagedItems.length)}?</p>
					</section>

					<div class="cart-action-grid">
						<button
							class="cart-action-card danger-card"
							class:selected={cartAction === "delete"}
							type="button"
							disabled={!activeOrgStagedItems.length}
							onclick={() => onSelectCartAction("delete")}
						>
							<span class="action-card-icon" aria-hidden="true">
								<svg viewBox="0 0 24 24" focusable="false">
									<path d="M6 7h12M10 11v6M14 11v6M9 7V4h6v3M8 7l1 13h6l1-13" />
								</svg>
							</span>
							<span class="action-card-content">
								<strong>Delete from org</strong>
								<span>Perform a destructive deployment to permanently remove these components from the active org.</span>
							</span>
						</button>

						<button
							class="cart-action-card"
							class:selected={cartAction === "deploy"}
							type="button"
							disabled={!activeOrgStagedItems.length}
							onclick={() => onSelectCartAction("deploy")}
						>
							<span class="action-card-icon" aria-hidden="true">
								<svg viewBox="0 0 24 24" focusable="false">
									<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
									<path d="M12 12 4 7.5M12 12l8-4.5M12 12v9" />
								</svg>
							</span>
							<span class="action-card-content">
								<strong>Deploy to org</strong>
								<span>Deploy these components to a target Salesforce environment. Change set style.</span>
							</span>
						</button>

						<button
							class="cart-action-card"
							class:selected={cartAction === "compare"}
							type="button"
							disabled={!activeOrgStagedItems.length}
							onclick={() => onSelectCartAction("compare")}
						>
							<span class="action-card-icon" aria-hidden="true">
								<svg viewBox="0 0 24 24" focusable="false">
									<path d="M7 7h10M7 17h10M7 7v10M17 7v10" />
									<path d="m4 10 3-3-3-3M20 14l-3 3 3 3" />
								</svg>
							</span>
							<span class="action-card-content">
								<strong>Compare with org</strong>
								<span>Perform a cross-org diff to see versioning differences for these components.</span>
							</span>
						</button>
					</div>
				{:else if cartStep === "confirm" && cartAction === "compare"}
					<section class="destructive-summary">
						<div class="summary-title-row">
							<strong>Compare Summary</strong>
						</div>
						<div class="summary-fields">
							<div>
								<span>Source Org</span>
								<strong>{sourceOrgLabel}</strong>
							</div>
							<div>
								<span>Target Org</span>
								<strong>{compareTargetLabel}</strong>
							</div>
							<div>
								<span>Components</span>
								<strong>{activeOrgStagedItems.length}</strong>
							</div>
						</div>
					</section>
					<section class="confirm-action-selection">
						<p class="eyebrow">Target Org</p>
						<select
							aria-label="Compare target org"
							value={compareTargetUsername}
							onchange={(event) => onSelectCompareTarget(event.currentTarget.value)}
						>
							{#each compareTargetOptions as org (org.username)}
								<option value={org.username}>{org.alias ?? org.username}</option>
							{/each}
						</select>
					</section>
				{:else if cartStep === "confirm" && cartAction === "deploy"}
					<section class="destructive-summary">
						<div class="summary-title-row">
							<strong>Cross-org deploy summary</strong>
						</div>
						<p>Review source and target orgs before starting this cross-org deploy.</p>
						<div class="summary-fields">
							<div>
								<span>Source Org</span>
								<strong>{sourceOrgLabel}</strong>
							</div>
							<div>
								<span>Target Org</span>
								<strong>{compareTargetLabel}</strong>
							</div>
							<div class="summary-field-compact">
								<span>Components</span>
								<strong>{preflightDeployableCount}</strong>
							</div>
						</div>
					</section>

					<section class="confirm-action-selection">
						<p class="eyebrow">Action Mode</p>
						<div class="mode-toggle">
							<button class="toggle-button" class:active={runMode === "validate"} type="button" onclick={() => runMode = "validate"}>
								Validate Only
							</button>
							<button class="toggle-button" class:active={runMode === "deploy"} type="button" onclick={() => runMode = "deploy"}>
								Deploy
							</button>
						</div>
					</section>

					<section class="confirm-action-selection">
						<p class="eyebrow">Target Org</p>
						<select
							aria-label="Deploy target org"
							value={compareTargetUsername}
							onchange={(event) => onSelectCompareTarget(event.currentTarget.value)}
						>
							{#each compareTargetOptions as org (org.username)}
								<option value={org.username}>{org.alias ?? org.username}</option>
							{/each}
						</select>
					</section>

					{#if runMode === "deploy"}
						<section class="confirmation-requirement">
							<div class="summary-title-row warning-title">
								<span>Verify deploy authority</span>
							</div>
							<label class="confirmation-label">
								{#if isProductionLikeTarget}
									<span class="danger-text">Production-like target. Type the phrase below to authorize deploy.</span>
								{:else}
									Type the confirmation phrase to authorize deploy.
								{/if}
								<input bind:value={deployTypedConfirmation} autocomplete="off" placeholder={deployConfirmationPhrase} />
							</label>
							<p class="muted">Phrase: <code>{deployConfirmationPhrase}</code></p>
							<details class="skipped-details">
								<summary>Preview deploy components ({preflightDeployableCount})</summary>
								<div class="skipped-list">
									{#each activeOrgStagedItems as item}
										<p><code>{item.metadataType}:{item.fullName}</code></p>
									{/each}
								</div>
							</details>
						</section>
					{/if}

					{#if preflightSkippedComponents.length}
						<details class="skipped-details">
							<summary>View {preflightSkippedComponents.length} skipped components</summary>
							<div class="skipped-list">
								{#each preflightSkippedComponents as skipped}
									<p><code>{skipped.metadataType}:{skipped.fullName}</code> - {skipped.reason}</p>
								{/each}
							</div>
						</details>
					{/if}
				{:else if cartStep === "confirm"}
					<section class="destructive-summary">
						<div class="summary-title-row">
							<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
								<path d="M12 3 5 6v5c0 4.4 2.9 8.5 7 10 4.1-1.5 7-5.6 7-10V6z" />
								<path d="M12 8v5M12 16h.01" />
							</svg>
							<strong>Final destructive summary</strong>
						</div>
						<p>Destructive changes are permanent. Ensure you have backed up your metadata before proceeding.</p>
						<div class="summary-fields">
							<div>
								<span>Target Org</span>
								<strong>{activeOrgLabel}</strong>
							</div>
							<div class="summary-field-compact">
								<span>Components</span>
								<strong>{preflightDeployableCount}</strong>
							</div>
						</div>
					</section>

					<section class="confirm-action-selection">
						<p class="eyebrow">Action Mode</p>
						<div class="mode-toggle">
							<button class="toggle-button" class:active={runMode === "validate"} type="button" onclick={() => runMode = "validate"}>
								Validate Only
							</button>
							<button class="toggle-button" class:active={runMode === "deploy"} type="button" onclick={() => runMode = "deploy"}>
								Destructive Delete
							</button>
						</div>
					</section>

					{#if runMode === "deploy"}
						<section class="confirmation-requirement">
							<div class="summary-title-row warning-title">
								<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
									<path d="m12 3 10 18H2z" />
									<path d="M12 9v5M12 17h.01" />
								</svg>
								<span>Verify org authority</span>
							</div>
							<label class="confirmation-label">
								{#if isProductionLikeTarget}
									<span class="danger-text">Production target. Type the phrase below to authorize deletion.</span>
								{:else}
									Type the confirmation phrase to authorize deletion.
								{/if}
								<input bind:value={deployTypedConfirmation} autocomplete="off" placeholder={deployConfirmationPhrase} />
							</label>
							<p class="muted">Phrase: <code>{deployConfirmationPhrase}</code></p>
							<details class="skipped-details">
								<summary>Preview deploy components ({preflightDeployableCount})</summary>
								<div class="skipped-list">
									{#each activeOrgStagedItems as item}
										<p><code>{item.metadataType}:{item.fullName}</code></p>
									{/each}
								</div>
							</details>
						</section>
					{/if}

					{#if preflightSkippedComponents.length}
						<details class="skipped-details">
							<summary>View {preflightSkippedComponents.length} skipped components</summary>
							<div class="skipped-list">
								{#each preflightSkippedComponents as skipped}
									<p><code>{skipped.metadataType}:{skipped.fullName}</code> - {skipped.reason}</p>
								{/each}
							</div>
						</details>
					{/if}
				{:else}
					<div class="result-container">
						{#if cartAction === "compare"}
								{#if isRunningCompare}
									<div class="deployment-status-active">
										<Fish class="rogue-fish-icon" aria-hidden="true" />
									<h3>Comparing metadata...</h3>
									<p class="muted quirky-message">{quirkyDeployMessage}</p>
								</div>
							{:else if compareResults.length}
								<div class="deployment-result-summary">
									<h3>Compare complete</h3>
									<div class="result-detail-card">
										<div>
											<span>Source Org</span>
											<strong>{sourceOrgLabel}</strong>
										</div>
										<div>
											<span>Target Org</span>
											<strong>{compareTargetLabel}</strong>
										</div>
										<div>
											<span>Components</span>
											<strong>{compareResults.length}</strong>
										</div>
									</div>
									<div class="failure-list">
										{#each compareStateSummary as summary (`${summary.state}:${summary.count}`)}
											<div class="failure-item">
												<strong>{summary.state}</strong>
												<p>{summary.count}</p>
											</div>
										{/each}
									</div>
									<div class="failure-list">
										{#each groupedCompareResults as group (group.metadataType)}
											<div class="failure-item">
												<strong>{group.metadataType}</strong>
											</div>
											{#each group.results as result (`${result.metadataType}:${result.fullName}:${result.fileName ?? ""}`)}
												<div class="failure-item">
													<strong>{result.fileName ?? result.fullName}</strong>
													{#if result.fileName}
														<p class="muted"><code>{result.fullName}</code></p>
													{/if}
													<p>{result.state}</p>
													{#if hasCompareXml(result.sourceXml) || hasCompareXml(result.targetXml)}
														<button
															class="text-link-button view-diff-button"
															type="button"
															onclick={() => openDiffResult = result}
														>
															View diff
														</button>
													{/if}
												</div>
											{/each}
										{/each}
									</div>
								</div>
							{:else}
								<div class="empty-state compact-empty">
									<p>No compare results yet.</p>
								</div>
							{/if}
						{:else}
							{#if isRunningDeploy}
								<div class="deployment-status-active">
									<Fish class="rogue-fish-icon" aria-hidden="true" />
								<h3>{progressVerb} components...</h3>
								<p class="muted quirky-message">{quirkyDeployMessage}</p>
								<p class="muted">
									Operation in progress on {isCrossOrgDeployAction ? compareTargetLabel : activeOrgLabel}
								</p>

								<section class="deploy-progress-visual" aria-label="Deploy progress">
									<div class="deploy-progress-track">
										<div class="deploy-progress-fill" style={`width: ${deployProgressPercent}%`}></div>
									</div>
									<div class="progress-details">
										<span>{deployProgressPercent}%</span>
										<span>{deployProgressMessage}</span>
									</div>
								</section>

									<button class="ghost-button cancel-deploy-button" type="button" onclick={onCancelRunningDeploy}>
										Cancel Operation (Esc)
									</button>
									<button class="ghost-button open-target-button" type="button" onclick={onOpenDeploymentStatusTargetOrg}>
										Open Deployment Status
									</button>
									{#if canOpenSpecificDeployment}
										<button class="ghost-button open-target-button" type="button" onclick={onOpenSpecificDeploymentStatus}>
											Open This Deployment
										</button>
									{/if}
								</div>
							{/if}

						{#if lastDeployResult && !isRunningDeploy}
							<div class="deployment-result-summary" class:success={lastDeployResult.state === "Succeeded"} class:failed={lastDeployResult.state === "Failed"}>
								<div class="result-icon-large" aria-hidden="true">
									{#if lastDeployResult.state === "Succeeded"}
										<svg viewBox="0 0 24 24" focusable="false">
											<path d="m6 12 4 4 8-8" />
										</svg>
									{:else}
										<svg viewBox="0 0 24 24" focusable="false">
											<path d="m7 7 10 10M17 7 7 17" />
										</svg>
									{/if}
								</div>
								<h3>{lastDeployResult.state === "Succeeded" ? "Success" : "Failed"}</h3>
								<p class="result-message">{lastDeployResult.message}</p>

								<div class="result-detail-card">
									{#if cartAction === "deploy" && "source" in lastDeployResult}
										<div>
											<span>Source Org</span>
											<strong>{sourceOrgLabel}</strong>
										</div>
									{/if}
									<div>
										<span>Deployment ID</span>
										<strong>{getDeployResultId(lastDeployResult)}</strong>
									</div>
									<div>
										<span>Target Org</span>
										<strong>{cartAction === "deploy" ? compareTargetLabel : activeOrgLabel}</strong>
									</div>
									<div>
										<span>Action</span>
										<strong>{resultActionLabel}</strong>
									</div>
									<div>
										<span>Success</span>
										<strong>{getDeploySuccessCount(lastDeployResult)}</strong>
									</div>
									<div>
										<span>Failed</span>
										<strong>{lastDeployResult.failed.length}</strong>
									</div>
									<div>
										<span>Skipped</span>
										<strong>{lastDeployResult.skipped.length}</strong>
									</div>
								</div>

								{#if lastDeployResult.failed.length}
									<div class="failure-details">
										<p class="eyebrow danger-text">Failure Details</p>
										<div class="failure-list">
											{#each lastDeployResult.failed as failure}
												<div class="failure-item">
													<strong>{failure.metadataType}:{failure.fullName}</strong>
													<p>{getFailureMessage(failure)}</p>
												</div>
											{/each}
										</div>
									</div>
								{/if}

								{#if rawDeployDiagnostics}
									<details class="skipped-details">
										<summary>View raw diagnostics</summary>
										<div class="skipped-list">
											<pre>{rawDeployDiagnostics}</pre>
										</div>
									</details>
								{/if}

										<button class="ghost-button open-target-button" type="button" onclick={onOpenDeploymentStatusTargetOrg}>
											Open Deployment Status
										</button>
										{#if canOpenSpecificDeployment}
											<button class="ghost-button open-target-button" type="button" onclick={onOpenSpecificDeploymentStatus}>
												Open This Deployment
											</button>
										{/if}
								</div>
							{/if}

						{#if !isRunningDeploy && !lastDeployResult}
							<div class="empty-state compact-empty">
								<p>No operation results yet.</p>
							</div>
						{/if}
						{/if}
					</div>
				{/if}
			</section>

			<footer class="cart-drawer-footer">
				{#if cartStep === "list"}
					<button class="ghost-button drawer-secondary-action" type="button" onclick={onClose}>Cancel</button>
					<button class="primary-button drawer-primary-action" type="button" aria-label="Next" onclick={() => onSetCartStep("actions")} disabled={!activeOrgStagedItems.length}>Next Step</button>
				{:else if cartStep === "actions"}
					<button class="ghost-button drawer-secondary-action" type="button" aria-label="Back" onclick={() => onSetCartStep("list")}>Previous Step</button>
					<button class="primary-button drawer-primary-action" type="button" aria-label="Next" onclick={onContinueFromActions} disabled={!cartAction || !activeOrgStagedItems.length}>Next Step</button>
				{:else if cartStep === "confirm"}
					<button class="ghost-button drawer-secondary-action" type="button" aria-label="Back" onclick={() => onSetCartStep("actions")}>Previous Step</button>
					{#if cartAction === "compare"}
						<button class="primary-button drawer-primary-action" type="button" onclick={onRunCompare} disabled={!compareTargetUsername || isRunningCompare}>
							Run Compare
						</button>
					{:else}
						<button
							class="primary-button drawer-primary-action"
							class:danger-button={cartAction !== "deploy"}
							type="button"
							onclick={onRunDelete}
							disabled={!canRunDeleteAction || (runMode === "deploy" && isProductionLikeTarget && !deployTypedConfirmationMatches)}
							aria-label={runActionAriaLabel}
						>
							{runActionLabel}
						</button>
					{/if}
				{:else}
					{#if cartAction === "compare"}
						<button class="ghost-button drawer-secondary-action" type="button" onclick={onFinish} disabled={isRunningCompare}>
							Finish & Close
						</button>
						<button class="primary-button drawer-primary-action" type="button" onclick={onRunCompare} disabled={isRunningCompare}>
							Retry Compare
						</button>
					{:else if canDeployValidatedResult}
						<button class="ghost-button drawer-secondary-action" type="button" onclick={onFinish} disabled={isRunningDeploy}>
							Finish & Close
						</button>
						<button class="primary-button danger-button drawer-primary-action" type="button" onclick={onDeployValidatedResult}>
							Deploy
						</button>
					{:else if canDeployValidatedCrossOrgResult}
						<button class="ghost-button drawer-secondary-action" type="button" onclick={onFinish} disabled={isRunningDeploy}>
							Finish & Close
						</button>
						<button class="primary-button drawer-primary-action" type="button" onclick={onDeployValidatedCrossOrgResult}>
							Deploy
						</button>
					{:else}
						<button class="primary-button drawer-finish-action" type="button" onclick={onFinish} disabled={isRunningDeploy}>
							Finish & Close
						</button>
					{/if}
				{/if}
			</footer>
		</div>
	</div>

	{#if openDiffResult}
		<DiffViewerModal
			result={openDiffResult}
			{sourceOrgLabel}
			targetOrgLabel={compareTargetLabel}
			onClose={() => openDiffResult = null}
		/>
	{/if}
{/if}
