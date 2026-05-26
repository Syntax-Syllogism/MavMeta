<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import { backendClient } from "../backend/backend-client";
	import type { MetadataComponentSummary } from "../../shared/metadata";
	import type { OrgSummary } from "../../shared/org";
	import {
		OBJECT_CHILD_METADATA_TYPES,
		type ChildMetadataItem,
		type ObjectSummary,
	} from "../../shared/object-explorer";
	import {
		matchesObjectSearch,
		getCategoryLabel,
		childItemToComponentSummary,
		getObjectTypeLabel,
		formatChildLabel,
		isStageableCustomFieldChild,
	} from "./object-explorer-view-model";
	import { objectChildrenCache, objectListCache } from "./object-explorer-cache";
	import FieldAccessModal from "./FieldAccessModal.svelte";

	let {
		activeOrg,
		onIsChildStaged,
		onToggleStagedChild,
		onToggleAllStagedChildren,
	}: {
		activeOrg: OrgSummary | undefined;
		onIsChildStaged: (component: MetadataComponentSummary, metadataType: string) => boolean;
		onToggleStagedChild: (component: MetadataComponentSummary, metadataType: string) => void;
		onToggleAllStagedChildren: (
			components: MetadataComponentSummary[],
			metadataType: string,
		) => void;
	} = $props();

	let isLoadingObjects = $state(false);
	let objects = $state<ObjectSummary[]>([]);
	let objectLoadError = $state<string | undefined>();
	let objectSearch = $state("");

	let selectedObjectApiName = $state<string | undefined>();
	let isLoadingChildren = $state(false);
	let children = $state<Record<string, ChildMetadataItem[]>>({});
	let childErrors = $state<Array<{ metadataType: string; message: string }>>([]);
	let activeCategory = $state<string>("CustomField");

	let selectedChildFullName = $state<string | undefined>();
	let isInspectorExpanded = $state(true);
	let isXmlOpen = $state(false);
	let isLoadingSource = $state(false);
	let childSource = $state<string | undefined>();
	let childSourceError = $state<string | undefined>();
	let currentSourceRequestId = 0;
	let openFieldActionMenuRowId = $state<string | null>(null);
	let selectedFieldForAccess = $state<{ sobjectType: string; fieldFullName: string } | undefined>();

	const filteredObjects = $derived(objects.filter((obj) => matchesObjectSearch(obj, objectSearch)));

	const selectedObject = $derived(objects.find((obj) => obj.apiName === selectedObjectApiName));

	const activeChildren = $derived(children[activeCategory] ?? []);

	let childSortKey = $state<string | null>(null);
	let childSortDir = $state<"asc" | "desc">("asc");

	function toggleChildSort(key: string) {
		if (childSortKey === key) {
			childSortDir = childSortDir === "asc" ? "desc" : "asc";
		} else {
			childSortKey = key;
			childSortDir = "asc";
		}
	}

	const sortedActiveChildren = $derived.by(() => {
		if (!childSortKey) return activeChildren;
		const k = childSortKey as keyof ChildMetadataItem;
		return [...activeChildren].sort((a, b) => {
			const av = String(a[k] ?? "");
			const bv = String(b[k] ?? "");
			const cmp = av.localeCompare(bv, undefined, { sensitivity: "base" });
			return childSortDir === "asc" ? cmp : -cmp;
		});
	});

	const isCustomFieldCategory = $derived(activeCategory === "CustomField");
	const stageableChildren = $derived(
		isCustomFieldCategory
			? activeChildren.filter((child) => isStageableCustomFieldChild(child))
			: activeChildren,
	);

	const selectedChild = $derived(
		activeChildren.find((item) => item.fullName === selectedChildFullName),
	);

	const categoryErrorMap = $derived(new Map(childErrors.map((e) => [e.metadataType, e.message])));

	async function loadObjects() {
		if (!activeOrg) return;
		const cached = objectListCache.get(activeOrg.username);
		if (cached) {
			objects = cached;
			objectLoadError = undefined;
			return;
		}

		isLoadingObjects = true;
		objectLoadError = undefined;
		objects = [];
		selectedObjectApiName = undefined;
		children = {};

		try {
			const response = await backendClient.listObjects({
				target: { username: activeOrg.username },
			});
			objects = response.objects;
			objectListCache.set(activeOrg.username, response.objects);
		} catch (err) {
			objectLoadError = err instanceof Error ? err.message : "Failed to load objects.";
		} finally {
			isLoadingObjects = false;
		}
	}

	async function selectObject(apiName: string) {
		if (selectedObjectApiName === apiName) return;
		selectedObjectApiName = apiName;
		selectedChildFullName = undefined;
		openFieldActionMenuRowId = null;
		selectedFieldForAccess = undefined;
		children = {};
		childErrors = [];
		activeCategory = "CustomField";
		childSortKey = null;
		await loadObjectChildren(apiName);
	}

	async function loadObjectChildren(objectApiName: string) {
		if (!activeOrg) return;
		const cacheKey = `${activeOrg.username}::${objectApiName.toLowerCase()}`;
		const cached = objectChildrenCache.get(cacheKey);
		if (cached) {
			children = cached.children;
			childErrors = cached.errors;
			return;
		}

		isLoadingChildren = true;
		try {
			const response = await backendClient.listObjectChildren({
				target: { username: activeOrg.username },
				objectApiName,
			});
			children = response.children;
			childErrors = response.errors;
			objectChildrenCache.set(cacheKey, {
				children: response.children,
				errors: response.errors,
			});
		} catch (err) {
			childErrors = [
				{
					metadataType: "all",
					message: err instanceof Error ? err.message : "Failed to load child metadata.",
				},
			];
		} finally {
			isLoadingChildren = false;
		}
	}

	function selectChildItem(fullName: string) {
		const next = fullName === selectedChildFullName ? undefined : fullName;
		selectedChildFullName = next;
		isXmlOpen = false;
		childSource = undefined;
		childSourceError = undefined;
	}

	async function loadChildSource() {
		if (!activeOrg || !selectedChild) return;
		if (childSource || isLoadingSource) return;

		const requestId = ++currentSourceRequestId;
		isLoadingSource = true;
		childSourceError = undefined;

		try {
			const response = await backendClient.getComponentSource({
				target: { username: activeOrg.username },
				metadataType: selectedChild.metadataType,
				fullName: selectedChild.fullName,
			});
			if (requestId !== currentSourceRequestId) return;
			if (response.error) {
				childSourceError = response.error.message;
			} else {
				childSource = response.source;
			}
		} catch (err) {
			if (requestId === currentSourceRequestId) {
				childSourceError = err instanceof Error ? err.message : "Failed to load source.";
			}
		} finally {
			if (requestId === currentSourceRequestId) {
				isLoadingSource = false;
			}
		}
	}

	function onXmlToggle(e: Event) {
		isXmlOpen = (e.currentTarget as HTMLDetailsElement).open;
		if (isXmlOpen) void loadChildSource();
	}

	function toggleStaged(item: ChildMetadataItem) {
		if (!canStageChild(item)) return;
		const component = childItemToComponentSummary(item);
		onToggleStagedChild(component, item.metadataType);
	}

	function isStaged(item: ChildMetadataItem) {
		const component = childItemToComponentSummary(item);
		return onIsChildStaged(component, item.metadataType);
	}

	function canStageChild(item: ChildMetadataItem): boolean {
		if (activeCategory !== "CustomField") return true;
		return isStageableCustomFieldChild(item);
	}

	function toggleFieldActionMenu(rowId: string) {
		openFieldActionMenuRowId = openFieldActionMenuRowId === rowId ? null : rowId;
	}

	function openFieldAccessModal(item: ChildMetadataItem) {
		openFieldActionMenuRowId = null;
		selectedFieldForAccess = {
			sobjectType: item.parentObject,
			fieldFullName: item.fullName,
		};
	}

	function formatDate(iso: string | undefined): string {
		if (!iso) return "n/a";
		const d = new Date(iso);
		if (isNaN(d.getTime())) return iso;
		if (d.getTime() <= 0) return "n/a";
		return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
	}

	onMount(() => {
		const onDocumentMouseDown = (event: MouseEvent) => {
			if (!(event.target instanceof Element)) {
				openFieldActionMenuRowId = null;
				return;
			}
			if (!event.target.closest("details.action-menu")) {
				openFieldActionMenuRowId = null;
			}
		};
		document.addEventListener("mousedown", onDocumentMouseDown);

		if (activeOrg) {
			void loadObjects();
		}

		return () => {
			document.removeEventListener("mousedown", onDocumentMouseDown);
		};
	});

	onDestroy(() => {
		openFieldActionMenuRowId = null;
	});
</script>

<div class="object-explorer">
	<div class="object-directory-panel panel">
		<div class="panel-header">
			<div>
				<p class="eyebrow">Object Manager</p>
				<h2>Objects</h2>
			</div>
		</div>

		{#if activeOrg}
			<div class="object-search">
				<label class="filter-input">
					Filter Objects
					<input
						bind:value={objectSearch}
						autocomplete="off"
						placeholder="Account, Contact, My_Obj__c..."
						disabled={!objects.length}
					/>
				</label>
			</div>

			{#if isLoadingObjects}
				<div class="empty-state">
					<h3>Loading objects</h3>
					<p>Reading CustomObject metadata from the org.</p>
				</div>
			{:else if objectLoadError}
				<div class="empty-state">
					<p class="danger-text">{objectLoadError}</p>
				</div>
			{:else if objects.length}
				<div class="object-table" role="table" aria-label="Object directory">
					<div class="object-row table-heading" role="row">
						<span>Label</span>
						<span>API Name</span>
					</div>
					{#each filteredObjects as obj (obj.apiName)}
						<button
							class="object-row-button"
							class:active-row={obj.apiName === selectedObjectApiName}
							type="button"
							onclick={() => selectObject(obj.apiName)}
							disabled={isLoadingChildren && selectedObjectApiName !== obj.apiName}
						>
							<span title={obj.label}>{obj.label}</span>
							<span title={obj.apiName}>{obj.apiName}</span>
						</button>
					{/each}
					{#if !filteredObjects.length}
						<div class="empty-state compact-empty">
							<p>No objects match the filter.</p>
						</div>
					{/if}
				</div>
			{:else}
				<div class="empty-state">
					<h3>No objects loaded</h3>
					<p>Objects will load automatically once an active org is set.</p>
				</div>
			{/if}
		{:else}
			<div class="empty-state">
				<h3>No active org</h3>
				<p>Select or authenticate an org before browsing objects.</p>
			</div>
		{/if}
	</div>

	<div class="object-detail-panel">
		{#if selectedObject}
			<div class="category-workspace panel">
				<div class="object-header">
					<div>
						<p class="eyebrow">{getObjectTypeLabel(selectedObject)}</p>
						<h2 title={selectedObject.apiName}>
							{selectedObject.label}
							{#if selectedObject.label !== selectedObject.apiName}
								<span class="object-api-name">{selectedObject.apiName}</span>
							{/if}
						</h2>
					</div>
				</div>

				<div class="category-tabs" role="tablist" aria-label="Child metadata categories">
					{#each OBJECT_CHILD_METADATA_TYPES as childType (childType)}
						<button
							class="category-tab"
							class:active-tab={childType === activeCategory}
							role="tab"
							aria-selected={childType === activeCategory}
							type="button"
							onclick={() => {
								activeCategory = childType;
								selectedChildFullName = undefined;
								openFieldActionMenuRowId = null;
							}}
						>
							<span class="tab-label">{getCategoryLabel(childType)}</span>
							{#if children[childType]?.length}
								<span class="tab-count">{children[childType].length}</span>
							{/if}
						</button>
					{/each}
				</div>

				{#if isLoadingChildren}
					<div class="empty-state">
						<h3>Loading child metadata</h3>
						<p>Reading {getCategoryLabel(activeCategory)} for {selectedObject.label}.</p>
					</div>
				{:else}
					{#if categoryErrorMap.has(activeCategory)}
						<div class="metadata-errors" role="status">
							<p>
								Could not load {getCategoryLabel(activeCategory)}: {categoryErrorMap.get(
									activeCategory,
								)}
							</p>
						</div>
					{/if}

					{#if selectedChild}
						<div class="child-inspector">
							<button
								class="inspector-toggle"
								type="button"
								onclick={() => (isInspectorExpanded = !isInspectorExpanded)}
								aria-expanded={isInspectorExpanded}
							>
								<span class="chevron">{isInspectorExpanded ? "▾" : "▸"}</span>
								<div>
									<p class="eyebrow">{selectedChild.metadataType}</p>
									<h3 title={selectedChild.fullName}>{selectedChild.childApiName}</h3>
								</div>
							</button>
							{#if isInspectorExpanded}
								<div class="inspector-content">
									<dl>
										<div>
											<dt>Full Name</dt>
											<dd>{selectedChild.fullName}</dd>
										</div>
										<div>
											<dt>Parent Object</dt>
											<dd>{selectedChild.parentObject}</dd>
										</div>
										<div>
											<dt>Metadata Type</dt>
											<dd>{selectedChild.metadataType}</dd>
										</div>
										<div>
											<dt>Label</dt>
											<dd>{selectedChild.label ?? "n/a"}</dd>
										</div>
										<div>
											<dt>Manageable State</dt>
											<dd>{selectedChild.manageableState ?? "n/a"}</dd>
										</div>
										<div>
											<dt>Last Modified By</dt>
											<dd>{selectedChild.lastModifiedByName ?? "n/a"}</dd>
										</div>
										<div>
											<dt>Last Modified Date</dt>
											<dd>{selectedChild.lastModifiedDate ?? "n/a"}</dd>
										</div>
									</dl>
									<div class="raw-views">
										{#if selectedChild.raw}
											<details class="raw-detail">
												<summary>Raw JSON</summary>
												<pre>{JSON.stringify(selectedChild.raw, null, 2)}</pre>
											</details>
										{/if}
										<details class="raw-detail" open={isXmlOpen} ontoggle={onXmlToggle}>
											<summary>View Source</summary>
											<div class="source-view-container">
												{#if isLoadingSource}
													<div class="placeholder-view">
														<p class="muted">Loading component source...</p>
													</div>
												{:else if childSourceError}
													<div class="placeholder-view">
														<p class="danger-text">{childSourceError}</p>
													</div>
												{:else if childSource}
													<pre class="source-view"><code>{childSource}</code></pre>
												{:else}
													<div class="placeholder-view">
														<p class="muted">Open to load source XML.</p>
													</div>
												{/if}
											</div>
										</details>
									</div>
								</div>
							{/if}
						</div>
					{/if}

					{#if activeChildren.length}
						<div
							class="child-table"
							role="table"
							aria-label="{getCategoryLabel(activeCategory)} for {selectedObject.label}"
						>
							<div class="child-row table-heading" role="row">
								<span>
									<input
										type="checkbox"
										title="Select/Deselect all in category"
										checked={stageableChildren.length > 0 &&
											stageableChildren.every((c) => isStaged(c))}
										indeterminate={stageableChildren.some((c) => isStaged(c)) &&
											!stageableChildren.every((c) => isStaged(c))}
										disabled={stageableChildren.length === 0}
										onchange={() =>
											onToggleAllStagedChildren(
												stageableChildren.map(childItemToComponentSummary),
												activeCategory,
											)}
									/>
								</span>
								<span
									><button
										class="sort-btn"
										class:sorted={childSortKey === "childApiName"}
										onclick={() => toggleChildSort("childApiName")}
										>Name<span class="sort-arrow" aria-hidden="true"
											>{childSortKey === "childApiName"
												? childSortDir === "asc"
													? "▴"
													: "▾"
												: "⇅"}</span
										></button
									></span
								>
								<span
									><button
										class="sort-btn"
										class:sorted={childSortKey === "label"}
										onclick={() => toggleChildSort("label")}
										>Label<span class="sort-arrow" aria-hidden="true"
											>{childSortKey === "label" ? (childSortDir === "asc" ? "▴" : "▾") : "⇅"}</span
										></button
									></span
								>
								<span
									><button
										class="sort-btn"
										class:sorted={childSortKey === "lastModifiedByName"}
										onclick={() => toggleChildSort("lastModifiedByName")}
										>Modified By<span class="sort-arrow" aria-hidden="true"
											>{childSortKey === "lastModifiedByName"
												? childSortDir === "asc"
													? "▴"
													: "▾"
												: "⇅"}</span
										></button
									></span
								>
								<span
									><button
										class="sort-btn"
										class:sorted={childSortKey === "lastModifiedDate"}
										onclick={() => toggleChildSort("lastModifiedDate")}
										>Modified Date<span class="sort-arrow" aria-hidden="true"
											>{childSortKey === "lastModifiedDate"
												? childSortDir === "asc"
													? "▴"
													: "▾"
												: "⇅"}</span
										></button
									></span
								>
								<span>Actions</span>
							</div>
							{#each sortedActiveChildren as child (child.fullName)}
								<div
									class="child-row"
									class:active-row={child.fullName === selectedChildFullName}
									role="row"
								>
									<span>
										<input
											type="checkbox"
											title={canStageChild(child)
												? "Stage for metadata cart"
												: "Standard fields cannot be staged"}
											checked={isStaged(child)}
											disabled={!canStageChild(child)}
											onchange={() => toggleStaged(child)}
										/>
									</span>
									<span>
										<button
											class="component-link"
											title={child.fullName}
											type="button"
											onclick={() => selectChildItem(child.fullName)}
										>
											{child.childApiName}
										</button>
									</span>
									<span title={child.label ?? ""}
										>{child.label ?? formatChildLabel(child.childApiName)}</span
									>
									<span title={child.lastModifiedByName ?? ""}
										>{child.lastModifiedByName ?? "n/a"}</span
									>
									<span title={child.lastModifiedDate ?? ""}
										>{formatDate(child.lastModifiedDate)}</span
									>
									<span class="row-actions-cell">
										{#if isCustomFieldCategory}
											<details
												class="action-menu"
												open={openFieldActionMenuRowId === child.fullName}
											>
												<summary
													aria-label={`Actions for ${child.fullName}`}
													onclick={() => toggleFieldActionMenu(child.fullName)}
												>
													Actions
												</summary>
												<div class="action-menu-items">
													<button
														type="button"
														disabled={!canStageChild(child)}
														title={canStageChild(child)
															? "Stage this field in the metadata cart"
															: "Standard fields cannot be staged"}
														onclick={() => {
															openFieldActionMenuRowId = null;
															toggleStaged(child);
														}}
													>
														{isStaged(child) ? "Unstage from cart" : "Stage in cart"}
													</button>
													<button type="button" onclick={() => openFieldAccessModal(child)}>
														Who Has Access?
													</button>
												</div>
											</details>
										{:else}
											<button
												class="inline-action"
												type="button"
												onclick={() => toggleStaged(child)}
											>
												{isStaged(child) ? "Unstage" : "Stage"}
											</button>
										{/if}
									</span>
								</div>
							{/each}
						</div>
					{:else if !categoryErrorMap.has(activeCategory)}
						<div class="empty-state compact-empty">
							<p>No {getCategoryLabel(activeCategory)} found for {selectedObject.label}.</p>
						</div>
					{/if}
				{/if}
			</div>
		{:else if selectedObjectApiName && isLoadingChildren}
			<div class="empty-state panel" style="align-self: start">
				<h3>Loading</h3>
				<p>Loading child metadata for the selected object.</p>
			</div>
		{:else}
			<div class="empty-state panel">
				<h3>Select an object</h3>
				<p>Choose an object from the directory to browse its child metadata.</p>
			</div>
		{/if}
	</div>
</div>

{#if selectedFieldForAccess}
	<FieldAccessModal
		{activeOrg}
		sobjectType={selectedFieldForAccess.sobjectType}
		fieldFullName={selectedFieldForAccess.fieldFullName}
		onClose={() => {
			selectedFieldForAccess = undefined;
		}}
	/>
{/if}

<style>
	.object-explorer {
		display: grid;
		grid-template-columns: 320px 1fr;
		gap: 1rem;
		height: 100%;
		overflow: hidden;
	}

	.object-directory-panel {
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.object-search {
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--color-border-subtle);
		flex-shrink: 0;
	}

	.object-table {
		flex: 1;
		overflow-y: auto;
	}

	/* Object directory rows â€” same pattern as .metadata-row-button */
	.object-row {
		display: grid;
		grid-template-columns: minmax(120px, 1fr) minmax(120px, 1fr);
		align-items: center;
		gap: 10px;
		border-top: 1px solid var(--color-border-subtle);
		color: var(--color-text-secondary);
		padding: 10px var(--space-3);
		font-size: 0.82rem;
	}

	.object-row:first-child {
		border-top: 0;
	}

	.object-row span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.object-row-button {
		display: grid;
		grid-template-columns: minmax(120px, 1fr) minmax(120px, 1fr);
		align-items: center;
		gap: 10px;
		border-top: 1px solid var(--color-border-subtle);
		color: var(--color-text-secondary);
		padding: 10px var(--space-3);
		font-size: 0.82rem;
		width: 100%;
		text-align: left;
		background: transparent;
		border-left: 0;
		border-right: 0;
		border-bottom: 0;
		font: inherit;
		cursor: pointer;
		transition:
			background var(--transition-base),
			color var(--transition-base);
	}

	.object-row-button:hover:not(:disabled) {
		background: var(--color-bg-panel);
		color: var(--color-text-main);
	}

	.object-row-button:disabled {
		cursor: wait;
		opacity: 0.7;
	}

	.object-row-button span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.object-detail-panel {
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.object-header {
		display: flex;
		align-items: baseline;
		gap: 12px;
		padding: 12px 12px 0;
		flex-shrink: 0;
	}

	.object-header h2 {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin: 0;
	}

	.object-api-name {
		font-size: 0.82rem;
		font-weight: 400;
		color: var(--color-text-dim);
	}

	.category-workspace {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.category-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: var(--space-3);
		border-bottom: 1px solid var(--color-border-subtle);
		flex-shrink: 0;
	}

	.category-tab {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		font-size: 0.78rem;
		font: inherit;
		background: transparent;
		border: 1px solid var(--color-border-input);
		border-radius: 12px;
		cursor: pointer;
		color: var(--color-text-muted);
		white-space: nowrap;
		transition:
			border-color var(--transition-base),
			color var(--transition-base),
			background var(--transition-base);
	}

	.category-tab:hover {
		border-color: var(--color-text-dim);
		color: var(--color-text-secondary);
	}

	.category-tab.active-tab {
		background: var(--color-primary-subtle);
		border-color: var(--color-primary);
		color: var(--color-text-main);
		font-weight: 500;
	}

	.tab-count {
		font-size: 0.7rem;
		padding: 1px 5px;
		border-radius: 8px;
		background: var(--color-bg-elevated);
		color: var(--color-text-muted);
	}

	.category-tab.active-tab .tab-count {
		background: var(--color-primary-glow);
		color: var(--color-danger);
	}

	.child-inspector {
		flex-shrink: 0;
		border-bottom: 1px solid var(--color-border-subtle);
		padding: 10px var(--space-3);
		background: var(--color-bg-surface);
	}

	.inspector-toggle {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		padding: 0;
		width: 100%;
		color: var(--color-text-main);
		font: inherit;
	}

	.chevron {
		font-size: 0.9rem;
		margin-top: 2px;
		flex-shrink: 0;
		color: var(--color-text-muted);
	}

	.inspector-content {
		margin-top: 8px;
	}

	.inspector-content dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 3px 12px;
		font-size: 0.8rem;
	}

	.inspector-content dl div {
		display: contents;
	}

	.inspector-content dt {
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.inspector-content dd {
		margin: 0;
		color: var(--color-text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.child-table {
		flex: 1;
		overflow-y: auto;
	}

	/* Child metadata rows â€” mirrors .component-row but with more columns */
	.child-row {
		display: grid;
		grid-template-columns:
			28px minmax(140px, 1.4fr) minmax(140px, 1.2fr) minmax(110px, 0.9fr)
			minmax(110px, 0.9fr) 120px;
		align-items: center;
		gap: 10px;
		border-top: 1px solid var(--color-border-subtle);
		color: var(--color-text-secondary);
		padding: 7px var(--space-3);
		font-size: 0.8rem;
	}

	.child-row:first-child {
		border-top: 0;
	}

	.child-row span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Keep action menus from being clipped by the generic cell truncation rule. */
	.child-row span.row-actions-cell {
		overflow: visible;
		text-overflow: unset;
		white-space: normal;
	}

	.metadata-errors {
		padding: var(--space-2) var(--space-3);
		font-size: 0.8rem;
		color: var(--color-danger);
		background: var(--color-danger-subtle);
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.raw-detail {
		margin-top: 8px;
		font-size: 0.75rem;
	}

	.raw-detail summary {
		cursor: pointer;
		color: var(--color-text-muted);
		margin-bottom: 4px;
	}

	.raw-detail pre {
		background: var(--color-bg-base);
		color: var(--color-text-muted);
		padding: var(--space-2);
		border-radius: var(--radius);
		border: 1px solid var(--color-border-subtle);
		overflow: auto;
		max-height: 200px;
		font-size: 0.72rem;
	}
</style>
