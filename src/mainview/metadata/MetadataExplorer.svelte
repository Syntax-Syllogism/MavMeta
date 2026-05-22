<script lang="ts">
	import type { MetadataComponentSummary, MetadataTypeSummary } from "../../shared/metadata";
	import {
		formatMetadataDetailValue,
		formatRawMetadata,
		getGroupedComponentDisplayName,
		getMetadataComponentGroupName,
		type MetadataComponentGroup,
	} from "./metadata-view-model";

	let {
		activeOrg,
		isLoadingMetadataTypes,
		onLoadMetadataTypes,
		metadataTypeFilter = $bindable(),
		metadataApiVersion,
		metadataTypes,
		visibleMetadataTypes,
		selectedMetadataTypeXmlName,
		metadataComponents,
		onListMetadataComponents,
		isLoadingMetadataComponents,
		onCancelMetadataListing,
		selectedMetadataComponent,
		isMetadataInspectorExpanded = $bindable(),
		metadataComponentSearch = $bindable(),
		metadataComponentErrors,
		shouldGroupMetadataComponents,
		metadataComponentGroups,
		onToggleMetadataGroup,
		onIsComponentStaged,
		onToggleStagedItem,
		onToggleAllStagedItems,
		selectedMetadataComponentFullName,
		onSelectMetadataComponent,
		filteredMetadataComponents,
		metadataComponentTargetType,
		metadataTargetUsername,
		isLoadingComponentSource,
		componentSource,
		componentSourceError,
		isXmlSectionOpen = $bindable(false),
		onLoadComponentSource,
	}: {
		activeOrg: { alias?: string; username: string } | undefined;
		isLoadingMetadataTypes: boolean;
		onLoadMetadataTypes: () => void | Promise<void>;
		metadataTypeFilter: string;
		metadataApiVersion: string | undefined;
		metadataTypes: MetadataTypeSummary[];
		visibleMetadataTypes: MetadataTypeSummary[];
		selectedMetadataTypeXmlName: string;
		metadataComponents: MetadataComponentSummary[];
		onListMetadataComponents: (
			metadataType?: MetadataTypeSummary,
			forceRefresh?: boolean,
		) => void | Promise<void>;
		isLoadingMetadataComponents: boolean;
		onCancelMetadataListing: () => void;
		selectedMetadataComponent: MetadataComponentSummary | undefined;
		isMetadataInspectorExpanded: boolean;
		metadataComponentSearch: string;
		metadataComponentErrors: string[];
		shouldGroupMetadataComponents: boolean;
		metadataComponentGroups: MetadataComponentGroup[];
		onToggleMetadataGroup: (groupName: string) => void;
		onIsComponentStaged: (component: MetadataComponentSummary, metadataType: string) => boolean;
		onToggleStagedItem: (component: MetadataComponentSummary, metadataType: string) => void;
		onToggleAllStagedItems: (components: MetadataComponentSummary[], metadataType: string) => void;
		selectedMetadataComponentFullName: string | undefined;
		onSelectMetadataComponent: (fullName: string) => void;
		filteredMetadataComponents: MetadataComponentSummary[];
		metadataComponentTargetType: string | undefined;
		metadataTargetUsername: string | undefined;
		isLoadingComponentSource: boolean;
		componentSource: string | undefined;
		componentSourceError: string | undefined;
		isXmlSectionOpen: boolean;
		onLoadComponentSource: () => void | Promise<void>;
	} = $props();

	$effect(() => {
		if (isXmlSectionOpen && selectedMetadataComponentFullName) {
			onLoadComponentSource();
		}
	});

	$effect(() => {
		if (!isLoadingMetadataComponents) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onCancelMetadataListing();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	});
</script>

<div class="metadata-explorer">
	<!-- LEFT: metadata types list -->
	<div class="metadata-left panel">
		<div class="panel-header">
			<div>
				<p class="eyebrow">Metadata Discovery</p>
				<h2>Metadata Types</h2>
			</div>
		</div>

		{#if activeOrg}
			<div class="metadata-toolbar">
				<label class="filter-input">
					Filter Types
					<input bind:value={metadataTypeFilter} autocomplete="off" placeholder="ApexClass, CustomObject, Flow..." />
				</label>
			</div>
			{#if isLoadingMetadataTypes}
				<div class="empty-state">
					<h3>Discovering metadata types</h3>
					<p>MavMeta is reading Metadata API describe results for this org.</p>
				</div>
			{:else if metadataTypes.length}
				<div class="metadata-type-explorer">
					<div class="metadata-table" role="table" aria-label="Metadata types">
						<div class="metadata-row table-heading" role="row">
							<span>Type</span>
							<span>API Name</span>
						</div>
						{#each visibleMetadataTypes as metadataType (metadataType.xmlName)}
							<button
								class="metadata-row-button"
								class:active-row={metadataType.xmlName === selectedMetadataTypeXmlName}
								type="button"
								onclick={() => {
									if (selectedMetadataTypeXmlName === metadataType.xmlName && metadataComponents.length > 0) {
										return;
									}
									onListMetadataComponents(metadataType);
								}}
								disabled={isLoadingMetadataComponents}
							>
								<span title={metadataType.label}>{metadataType.label}</span>
								<span title={metadataType.xmlName}>{metadataType.xmlName}</span>
							</button>
						{/each}
					</div>
					{#if !visibleMetadataTypes.length}
						<div class="empty-state">
							<h3>No matching metadata types</h3>
							<p>Adjust the filter to search the discovered type list.</p>
						</div>
					{/if}
				</div>
			{:else if metadataTargetUsername === activeOrg.username}
				<div class="empty-state">
					<h3>No metadata types returned</h3>
					<p>The Metadata API describe call completed without returning type details.</p>
				</div>
			{:else}
				<div class="empty-state">
					<h3>Ready to discover</h3>
					<p>Discover metadata types for the active org before browsing components.</p>
				</div>
			{/if}
		{:else}
			<div class="empty-state">
				<h3>No active org</h3>
				<p>Select or authenticate an org before discovering metadata.</p>
			</div>
		{/if}
	</div>

	<!-- RIGHT: component explorer -->
	<section class="component-explorer" class:inspector-expanded={isMetadataInspectorExpanded && !!selectedMetadataComponent} aria-label="Metadata component explorer">
				{#if isLoadingMetadataComponents}
					<div class="empty-state">
						<h3>Listing components</h3>
						<p>MavMeta is reading component summaries for the selected metadata type.</p>
					</div>
				{:else if metadataComponents.length}
					<div class="explorer-inspector-pane">
						<aside class="component-inspector" aria-label="Component details">
							{#if selectedMetadataComponent}
								<header class="inspector-header">
									<button
										class="inspector-toggle"
										type="button"
										onclick={() => (isMetadataInspectorExpanded = !isMetadataInspectorExpanded)}
										aria-expanded={isMetadataInspectorExpanded}
									>
              <span class="chevron">{isMetadataInspectorExpanded ? "▾" : "▸"}</span>
										<div class="inspector-title">
											<p class="eyebrow">{selectedMetadataComponent.type}</p>
											<h3 title={selectedMetadataComponent.fullName}>
												{selectedMetadataComponent.fullName}
											</h3>
										</div>
									</button>
									<div class="inspector-actions">
										<button
											class="btn btn--ghost btn--compact"
											type="button"
											onclick={() => onListMetadataComponents(undefined, true)}
											disabled={isLoadingMetadataComponents}
											title="Refresh component list from org"
										>
											Refresh
										</button>
									</div>
								</header>
								{#if isMetadataInspectorExpanded}
									<div class="inspector-content">
										<dl>
											<div><dt>Type</dt><dd>{selectedMetadataComponent.type}</dd></div>
											<div><dt>Label</dt><dd>{formatMetadataDetailValue(selectedMetadataComponent.label)}</dd></div>
											<div><dt>Developer Name</dt><dd>{formatMetadataDetailValue(selectedMetadataComponent.developerName)}</dd></div>
											<div><dt>Group</dt><dd>{getMetadataComponentGroupName(selectedMetadataComponent)}</dd></div>
											<div><dt>ID</dt><dd>{formatMetadataDetailValue(selectedMetadataComponent.id)}</dd></div>
											<div><dt>Manageable State</dt><dd>{formatMetadataDetailValue(selectedMetadataComponent.manageableState)}</dd></div>
											<div><dt>Last Modified By</dt><dd>{formatMetadataDetailValue(selectedMetadataComponent.lastModifiedByName)}</dd></div>
											<div><dt>Last Modified Date</dt><dd>{formatMetadataDetailValue(selectedMetadataComponent.lastModifiedDate)}</dd></div>
										</dl>
										<div class="raw-views">
											<details class="raw-detail">
												<summary>Raw JSON</summary>
												<pre>{formatRawMetadata(selectedMetadataComponent)}</pre>
											</details>
											<details class="raw-detail" open={isXmlSectionOpen} ontoggle={(e) => isXmlSectionOpen = (e.currentTarget as HTMLDetailsElement).open}>
												<summary>View Source</summary>
												<div class="source-view-container">
													{#if isLoadingComponentSource}
														<div class="placeholder-view">
															<div class="spinner"></div>
															<p class="muted">Loading component source...</p>
														</div>
													{:else if componentSourceError}
														<div class="placeholder-view">
															<p class="danger-text">{componentSourceError}</p>
														</div>
													{:else if componentSource}
														<pre class="source-view"><code>{componentSource}</code></pre>
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
							{:else}
								<div class="empty-state compact-empty">
									<p>Select a component to inspect details.</p>
									<button class="btn btn--ghost btn--compact" type="button" onclick={() => onListMetadataComponents(undefined, true)} disabled={isLoadingMetadataComponents}>
										Refresh List
									</button>
								</div>
							{/if}
						</aside>
					</div>

					<div class="explorer-list-pane">
						<div class="explorer-toolbar">
							<label>
								Filter Components
								<input bind:value={metadataComponentSearch} autocomplete="off" placeholder="Full name, folder, namespace..." disabled={!metadataComponents.length} />
							</label>
						</div>

						{#if metadataComponentErrors.length}
							<div class="metadata-errors" role="status">
								{#each metadataComponentErrors as error}
									<p>{error}</p>
								{/each}
							</div>
						{/if}

						{#if shouldGroupMetadataComponents}
							<div class="component-tree" role="tree" aria-label="Metadata components">
								{#each metadataComponentGroups as group (group.name)}
									<section class="component-group">
										<button class="group-toggle" type="button" onclick={() => onToggleMetadataGroup(group.name)} aria-expanded={group.isExpanded}>
                    <span title={group.name}>{group.isExpanded ? "▾" : "▸"} {group.name}</span>
											<strong>{group.components.length}</strong>
										</button>
										{#if group.isExpanded}
											<div class="component-table" role="table" aria-label={`${group.name} components`}>
												<div class="component-row table-heading" role="row">
													<span>
														<input
															type="checkbox"
															title="Select/Deselect all in group"
															checked={group.components.length > 0 && group.components.every(c => onIsComponentStaged(c, c.type))}
															indeterminate={group.components.some(c => onIsComponentStaged(c, c.type)) && !group.components.every(c => onIsComponentStaged(c, c.type))}
															onchange={() => onToggleAllStagedItems(group.components, group.components[0]?.type)}
														/>
													</span>
													<span>Component</span><span>Modified By</span><span>Modified Date</span><span>Actions</span>
												</div>
												{#each group.components as component (component.fullName)}
													<div class="component-row" class:active-row={component.fullName === selectedMetadataComponentFullName} role="row">
														<span>
															<input type="checkbox" title="Select for destructive changeset" checked={onIsComponentStaged(component, component.type)} onchange={() => onToggleStagedItem(component, component.type)} />
														</span>
														<span>
															<button class="component-link" title={component.fullName} type="button" onclick={() => onSelectMetadataComponent(component.fullName)}>
																{getGroupedComponentDisplayName(component, group.name)}
															</button>
														</span>
														<span title={component.lastModifiedByName ?? ""}>{formatMetadataDetailValue(component.lastModifiedByName)}</span>
														<span title={component.lastModifiedDate ?? ""}>{formatMetadataDetailValue(component.lastModifiedDate)}</span>
														<span>
															<button class="inline-action" type="button" onclick={() => onToggleStagedItem(component, component.type)}>
																{onIsComponentStaged(component, component.type) ? "Unstage" : "Stage"}
															</button>
														</span>
													</div>
												{/each}
											</div>
										{/if}
									</section>
								{/each}
							</div>
						{:else}
							<div class="component-tree">
								<div class="component-table" role="table" aria-label="Metadata components">
									<div class="component-row table-heading" role="row">
										<span>
											<input
												type="checkbox"
												title="Select/Deselect all visible components"
												checked={filteredMetadataComponents.length > 0 && filteredMetadataComponents.every(c => onIsComponentStaged(c, c.type))}
												indeterminate={filteredMetadataComponents.some(c => onIsComponentStaged(c, c.type)) && !filteredMetadataComponents.every(c => onIsComponentStaged(c, c.type))}
												onchange={() => onToggleAllStagedItems(filteredMetadataComponents, selectedMetadataTypeXmlName)}
											/>
										</span>
										<span>Component</span><span>Modified By</span><span>Modified Date</span><span>Actions</span>
									</div>
									{#each filteredMetadataComponents as component (component.fullName)}
										<div class="component-row" class:active-row={component.fullName === selectedMetadataComponentFullName} role="row">
											<span>
												<input type="checkbox" title="Select for destructive changeset" checked={onIsComponentStaged(component, component.type)} onchange={() => onToggleStagedItem(component, component.type)} />
											</span>
											<span>
												<button class="component-link" title={component.fullName} type="button" onclick={() => onSelectMetadataComponent(component.fullName)}>
													{component.fullName}
												</button>
											</span>
											<span title={component.lastModifiedByName ?? ""}>{formatMetadataDetailValue(component.lastModifiedByName)}</span>
											<span title={component.lastModifiedDate ?? ""}>{formatMetadataDetailValue(component.lastModifiedDate)}</span>
											<span>
												<button class="inline-action" type="button" onclick={() => onToggleStagedItem(component, component.type)}>
													{onIsComponentStaged(component, component.type) ? "Unstage" : "Stage"}
												</button>
											</span>
										</div>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				{:else if metadataComponentTargetType}
					<div class="empty-state">
						<h3>No components returned</h3>
						<p>The selected type returned no listable components for this org.</p>
					</div>
				{:else}
					<div class="empty-state">
						<h3>Select a type to browse components</h3>
						<p>Click a metadata type row in the list to load its components.</p>
					</div>
				{/if}
	</section>
</div>



