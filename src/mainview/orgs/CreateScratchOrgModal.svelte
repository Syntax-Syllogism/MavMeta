<script lang="ts">
	import type { ListSnapshotsResponse, OrgSnapshot } from "../../shared/scratch-org";
	import type { OrgSummary } from "../../shared/org";
	import { backendClient } from "../backend/backend-client";
	import {
		buildScratchOrgDefinition,
		generateAlias,
		validateDefinitionJson,
		validateDurationDays,
		CURATED_SETTINGS,
		EDITION_OPTIONS,
		FEATURE_SUGGESTIONS,
		TEMPLATE_LABELS,
		type WizardCreationMode,
		type ScratchOrgTemplate,
		type WizardSettingsEntry,
	} from "./create-scratch-view-model";

	type WizardStep = "devhub" | "settings" | "definition" | "create";

	let {
		orgs,
		onClose,
		onComplete,
		onSetActive,
	}: {
		orgs: OrgSummary[];
		onClose: () => void;
		onComplete: (username: string) => void | Promise<void>;
		onSetActive: (username: string) => void | Promise<void>;
	} = $props();

	let currentStep = $state<WizardStep>("devhub");

	// Step 1: Dev Hub
	let selectedDevHubUsername = $state("");

	// Step 2: Settings
	let selectedTemplate = $state<ScratchOrgTemplate>("minimal");
	let creationMode = $state<WizardCreationMode>("standard");
	let alias = $state("");
	let durationDays = $state(7);
	let edition = $state("Developer");
	let orgName = $state("");
	let features = $state<string[]>([]);
	let settingEntries = $state<WizardSettingsEntry[]>([]);
	let featureInput = $state("");
	let settingInput = $state("");
	let durationError = $state("");
	let snapshotFetchState = $state<"idle" | "loading" | "loaded" | "failed">("idle");
	let snapshotEligibility = $state<ListSnapshotsResponse["eligibility"]>("enabled");
	let snapshots = $state<OrgSnapshot[]>([]);
	let selectedSnapshotName = $state("");
	let snapshotError = $state("");

	// Step 3: Definition
	let definitionJson = $state("{}");
	let jsonError = $state("");
	let step3Snapshot = $state<string | undefined>(undefined);
	let regeneratedNotice = $state(false);

	// Step 4: Create
	let isCreating = $state(false);
	let createMessage = $state("");
	let createError = $state("");
	let createdUsername = $state<string | undefined>();
	let createWarnings = $state<string[]>([]);

	const devHubOrgs = $derived(orgs.filter((org) => org.environment === "dev-hub"));
	const otherOrgs = $derived(orgs.filter((org) => org.environment !== "dev-hub"));

	const canProceedFromDevHub = $derived(selectedDevHubUsername !== "");

	const canProceedFromSettings = $derived(
		durationError === "" && validateDurationDays(durationDays).valid,
	);

	const jsonValidation = $derived(validateDefinitionJson(definitionJson));
	const canCreate = $derived(jsonValidation.valid && !isCreating);

	const stepLabels: Array<{ step: WizardStep; label: string }> = [
		{ step: "devhub", label: "Dev Hub" },
		{ step: "settings", label: "Settings & Snapshots" },
		{ step: "definition", label: "Definition" },
		{ step: "create", label: "Create" },
	];

	const currentStepIndex = $derived(stepLabels.findIndex((s) => s.step === currentStep));

	const currentStepLabel = $derived(
		stepLabels.find((s) => s.step === currentStep)?.label.toUpperCase() ?? "",
	);

	function buildStep3Snapshot(): string {
		return JSON.stringify({
			creationMode,
			template: selectedTemplate,
			selectedSnapshotName,
			edition,
			orgName,
			features,
			settings: settingEntries,
		});
	}

	function selectDevHub(username: string) {
		selectedDevHubUsername = username;
		snapshotFetchState = "idle";
		snapshots = [];
		selectedSnapshotName = "";
		snapshotError = "";
		creationMode = "standard";
	}

	function goNext() {
		if (currentStep === "devhub" && canProceedFromDevHub) {
			currentStep = "settings";
			void loadSnapshotsForDevHub();
		} else if (currentStep === "settings" && canProceedFromSettings) {
			const currentSnapshot = buildStep3Snapshot();
			if (step3Snapshot === undefined || step3Snapshot !== currentSnapshot) {
				buildDefinition();
				step3Snapshot = currentSnapshot;
				regeneratedNotice = true;
			}
			currentStep = "definition";
		} else if (currentStep === "definition" && canCreate) {
			void startCreate();
		}
	}

	function goBack() {
		if (currentStep === "settings") {
			currentStep = "devhub";
		} else if (currentStep === "definition") {
			regeneratedNotice = false;
			currentStep = "settings";
		} else if (currentStep === "create" && !isCreating && !createdUsername) {
			currentStep = "definition";
		}
	}

	function buildDefinition() {
		const effectiveAlias = alias.trim() || generateAlias();
		if (!alias.trim()) {
			alias = effectiveAlias;
		}

		const definition = buildScratchOrgDefinition({
			creationMode,
			snapshotName: selectedSnapshotName,
			template: selectedTemplate,
			edition,
			orgName,
			features,
			settings: settingEntries,
		});

		definitionJson = JSON.stringify(definition, null, 2);
		jsonError = "";
	}

	const canUseSnapshotMode = $derived(
		snapshotFetchState === "loaded" && snapshotEligibility === "enabled" && snapshots.length > 0,
	);

	const disabledSnapshotTooltip = $derived.by(() => {
		if (snapshotFetchState === "loading") {
			return "Loading snapshots...";
		}
		if (snapshotFetchState === "failed") {
			return snapshotError || "Could not reach Salesforce Tooling API. Retry in a moment.";
		}
		if (snapshotEligibility === "not-enabled") {
			return "Snapshots are not enabled on this Dev Hub. Enable them in Setup â†’ Dev Hub on the hub org.";
		}
		if (snapshotFetchState === "loaded" && snapshots.length === 0) {
			return "No snapshots available for this Dev Hub. Create one via the Salesforce CLI (sf org snapshot create).";
		}
		return "";
	});

	function selectCreationMode(mode: WizardCreationMode) {
		if (mode === "snapshot" && !canUseSnapshotMode) {
			return;
		}
		if (creationMode === mode) {
			return;
		}
		creationMode = mode;
		step3Snapshot = undefined;
		regeneratedNotice = false;
		if (mode === "snapshot" && selectedSnapshotName) {
			buildDefinition();
		}
	}

	async function loadSnapshotsForDevHub() {
		if (!selectedDevHubUsername) {
			return;
		}
		snapshotFetchState = "loading";
		snapshotError = "";
		snapshots = [];
		selectedSnapshotName = "";
		try {
			const response = await backendClient.listScratchOrgSnapshots(selectedDevHubUsername);
			snapshotEligibility = response.eligibility;
			snapshots = response.snapshots;
			snapshotFetchState = "loaded";
			if (response.snapshots.length > 0) {
				const firstSelectable = response.snapshots.find((snapshot) => !isExpiredSnapshot(snapshot));
				selectedSnapshotName = firstSelectable?.snapshotName ?? "";
			}
		} catch (error) {
			snapshotFetchState = "failed";
			snapshotError = error instanceof Error ? error.message : "Failed to load snapshots.";
			snapshotEligibility = "enabled";
		}
	}

	function isExpiredSnapshot(snapshot: OrgSnapshot): boolean {
		if (!snapshot.expirationDate) {
			return false;
		}
		return daysUntil(snapshot.expirationDate) < 0;
	}

	function daysUntil(dateIso: string): number {
		const targetDate = new Date(dateIso);
		if (Number.isNaN(targetDate.getTime())) {
			return 0;
		}
		const now = new Date();
		const targetUtcDate = Date.UTC(
			targetDate.getUTCFullYear(),
			targetDate.getUTCMonth(),
			targetDate.getUTCDate(),
		);
		// Compare the snapshot's UTC date against the user's local "today" calendar date.
		const nowUtcDate = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
		const msPerDay = 24 * 60 * 60 * 1000;
		return Math.floor((targetUtcDate - nowUtcDate) / msPerDay);
	}

	function snapshotBadge(snapshot: OrgSnapshot): string {
		if (!snapshot.expirationDate) {
			return "";
		}
		const days = daysUntil(snapshot.expirationDate);
		if (days < 0) {
			return "expired";
		}
		if (days <= 14) {
			return `${days}d âš `;
		}
		if (days <= 30) {
			return `${days}d`;
		}
		return "";
	}

	function snapshotBadgeClass(snapshot: OrgSnapshot): string {
		if (!snapshot.expirationDate) {
			return "";
		}
		const days = daysUntil(snapshot.expirationDate);
		if (days < 0) return "snapshot-badge snapshot-badge--expired";
		if (days <= 14) return "snapshot-badge snapshot-badge--warning";
		if (days <= 30) return "snapshot-badge snapshot-badge--caution";
		return "";
	}

	function formatSnapshotDate(iso: string): string {
		const value = new Date(iso);
		return Number.isNaN(value.getTime()) ? "â€”" : value.toLocaleDateString();
	}

	function onDefinitionInput(value: string) {
		definitionJson = value;
		regeneratedNotice = false;
		const result = validateDefinitionJson(value);
		jsonError = result.valid ? "" : result.error;
	}

	function onDurationInput(value: string) {
		const parsed = parseInt(value, 10);
		durationDays = isNaN(parsed) ? 0 : parsed;
		const result = validateDurationDays(durationDays);
		durationError = result.valid ? "" : result.error;
	}

	function addFeature() {
		const trimmed = featureInput.trim();
		if (trimmed && !features.includes(trimmed)) {
			features = [...features, trimmed];
		}
		featureInput = "";
	}

	function removeFeature(f: string) {
		features = features.filter((candidate) => candidate !== f);
	}

	function addSetting() {
		const trimmed = settingInput.trim();
		if (!trimmed) return;

		const curated = CURATED_SETTINGS.find(
			(g) =>
				g.label.toLowerCase() === trimmed.toLowerCase() ||
				g.group.toLowerCase() === trimmed.toLowerCase(),
		);

		const groupKey = curated ? curated.group : trimmed.charAt(0).toLowerCase() + trimmed.slice(1);

		if (settingEntries.some((e) => e.group === groupKey)) return;

		const subKeys: Record<string, boolean> = {};
		if (curated) {
			for (const subKey of curated.subKeys) {
				subKeys[subKey.name] = subKey.defaultValue;
			}
		}

		settingEntries = [...settingEntries, { group: groupKey, subKeys }];
		settingInput = "";
	}

	function removeSetting(group: string) {
		settingEntries = settingEntries.filter((e) => e.group !== group);
	}

	function toggleSubKey(group: string, subKeyName: string, value: boolean) {
		settingEntries = settingEntries.map((e) => {
			if (e.group !== group) return e;
			return { ...e, subKeys: { ...e.subKeys, [subKeyName]: value } };
		});
	}

	async function startCreate() {
		if (!jsonValidation.valid) {
			return;
		}

		isCreating = true;
		createError = "";
		createMessage = "Starting scratch org creation...";
		currentStep = "create";

		try {
			const started = await backendClient.startScratchOrgCreate({
				devHubUsername: selectedDevHubUsername,
				definition: jsonValidation.parsed,
				alias: alias.trim() || undefined,
				durationDays,
			});

			await pollUntilDone(started.operationId);
		} catch (error) {
			createError =
				error instanceof Error ? error.message : "Failed to start scratch org creation.";
			isCreating = false;
		}
	}

	async function pollUntilDone(operationId: string) {
		for (;;) {
			await new Promise((resolve) => setTimeout(resolve, 1500));

			try {
				const status = await backendClient.getScratchOrgCreateStatus({ operationId });
				createMessage = status.message;

				if (status.status === "succeeded") {
					createdUsername = status.username;
					createWarnings = status.warnings ?? [];
					isCreating = false;
					return;
				}

				if (status.status === "failed") {
					createError = status.message;
					isCreating = false;
					return;
				}
			} catch (error) {
				createError = error instanceof Error ? error.message : "Failed to get creation status.";
				isCreating = false;
				return;
			}
		}
	}

	async function handleDone() {
		if (createdUsername) {
			await onComplete(createdUsername);
		} else {
			onClose();
		}
	}

	async function handleSetActive() {
		if (createdUsername) {
			await onSetActive(createdUsername);
		}
	}

	function retryFromDefinition() {
		createError = "";
		createMessage = "";
		createdUsername = undefined;
		createWarnings = [];
		currentStep = "definition";
	}
</script>

<div class="modal-backdrop">
	<div class="modal wizard-modal" role="dialog" aria-modal="true" aria-label="Create Scratch Org">
		<header class="cart-drawer-header wizard-modal-header">
			<div class="cart-title-row">
				<span class="cart-header-icon" aria-hidden="true">
					<svg viewBox="0 0 24 24" focusable="false">
						<path d="M13 2 5 14h7l-1 8 8-12h-7z" />
					</svg>
				</span>
				<div>
					<h2>Create Scratch Org</h2>
					<p>STEP {currentStepIndex + 1} OF {stepLabels.length} â€” {currentStepLabel}</p>
				</div>
			</div>
			<button
				class="btn btn--ghost btn--icon close-drawer-button"
				type="button"
				onclick={onClose}
				disabled={isCreating}
				aria-label="Close"
			>
				<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
					<path d="m6 6 12 12M18 6 6 18" />
				</svg>
			</button>
		</header>

		<nav class="cart-stepper-shell" aria-label="Wizard steps">
			<ol class="cart-stepper">
				{#each stepLabels as { step, label }, index (step)}
					<li class:active={currentStep === step} class:complete={index < currentStepIndex}>
						<span class="step-marker" aria-hidden="true">
							{#if index < currentStepIndex}
								<svg viewBox="0 0 24 24" focusable="false">
									<path d="m6 12 4 4 8-8" />
								</svg>
							{:else}
								{index + 1}
							{/if}
						</span>
						<span class="step-label">{label}</span>
					</li>
				{/each}
			</ol>
		</nav>

		<div class="wizard-body">
			{#if currentStep === "devhub"}
				<div class="wizard-section">
					<p class="wizard-section-hint">Select the Dev Hub org to create your scratch org from.</p>

					{#if devHubOrgs.length > 0}
						<p class="field-label">Detected Dev Hubs</p>
						<div class="org-picker">
							{#each devHubOrgs as org (org.username)}
								<button
									class="org-pick-row"
									class:selected={selectedDevHubUsername === org.username}
									type="button"
									onclick={() => selectDevHub(org.username)}
								>
									<span class="org-pick-alias">{org.alias ?? org.username}</span>
									<span class="org-pick-username">{org.username}</span>
								</button>
							{/each}
						</div>
					{/if}

					{#if otherOrgs.length > 0}
						<p class="field-label other-orgs-label">
							Other Orgs <span class="badge-unknown">Dev Hub status unknown</span>
						</p>
						<div class="org-picker">
							{#each otherOrgs as org (org.username)}
								<button
									class="org-pick-row org-pick-row--uncertain"
									class:selected={selectedDevHubUsername === org.username}
									type="button"
									onclick={() => selectDevHub(org.username)}
								>
									<span class="org-pick-alias">{org.alias ?? org.username}</span>
									<span class="org-pick-username">{org.username}</span>
									<span class="org-pick-env">{org.environment}</span>
								</button>
							{/each}
						</div>
					{/if}

					{#if orgs.length === 0}
						<p class="empty-hint">No authenticated orgs found. Add an org first.</p>
					{/if}
				</div>
			{:else if currentStep === "settings"}
				<div class="wizard-section">
					<div class="field-group">
						<span class="field-label">Creation Method</span>
						<div class="creation-segmented">
							<button
								type="button"
								class="mode-button"
								class:active={creationMode === "standard"}
								onclick={() => selectCreationMode("standard")}
							>
								Standard (Scratch Def)
							</button>
							<button
								type="button"
								class="mode-button"
								class:active={creationMode === "snapshot"}
								onclick={() => selectCreationMode("snapshot")}
								disabled={!canUseSnapshotMode}
								title={disabledSnapshotTooltip}
							>
								Org Snapshot (Fast)
							</button>
						</div>
						{#if creationMode === "snapshot" && selectedSnapshotName}
							<p class="field-hint">Selected snapshot: {selectedSnapshotName}</p>
						{/if}
					</div>

					<div class="settings-grid-2">
						<label class="field-group">
							Alias <span class="field-hint">(leave blank to auto-generate)</span>
							<input
								type="text"
								bind:value={alias}
								placeholder="e.g. dev-force"
								autocomplete="off"
							/>
						</label>

						<label class="field-group" class:field-error={durationError !== ""}>
							Duration (days)
							<input
								type="number"
								value={durationDays}
								min="1"
								max="30"
								oninput={(e) => onDurationInput(e.currentTarget.value)}
							/>
							{#if durationError}
								<span class="error-text">{durationError}</span>
							{/if}
						</label>
					</div>

					{#if creationMode === "standard"}
						<div class="settings-grid-2">
							<label class="field-group">
								Template
								<select bind:value={selectedTemplate}>
									{#each Object.entries(TEMPLATE_LABELS) as [value, label] (value)}
										<option {value}>{label}</option>
									{/each}
								</select>
							</label>

							<label class="field-group">
								Edition
								<select bind:value={edition}>
									{#each EDITION_OPTIONS as opt (opt)}
										<option value={opt}>{opt}</option>
									{/each}
								</select>
							</label>
						</div>

						<label class="field-group">
							Org Name <span class="field-hint">(display name in Salesforce)</span>
							<input type="text" bind:value={orgName} autocomplete="off" />
						</label>

						<div class="field-group">
							<span class="field-label">Features</span>
							<div class="tag-input-row">
								<input
									list="feature-suggestions"
									type="text"
									bind:value={featureInput}
									placeholder="e.g. Communities"
									autocomplete="off"
									onkeydown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											addFeature();
										}
									}}
								/>
								<datalist id="feature-suggestions">
									{#each FEATURE_SUGGESTIONS as suggestion (suggestion)}
										<option value={suggestion}></option>
									{/each}
								</datalist>
								<button class="btn btn--ghost tag-add-btn" type="button" onclick={addFeature}
									>Add</button
								>
							</div>
							{#if features.length > 0}
								<div class="tag-list">
									{#each features as f (f)}
										<span class="tag">
											{f}
											<button
												type="button"
												class="tag-remove"
												onclick={() => removeFeature(f)}
												aria-label={`Remove ${f}`}>Ã—</button
											>
										</span>
									{/each}
								</div>
							{/if}
						</div>

						<div class="field-group">
							<span class="field-label">Settings</span>
							<div class="tag-input-row">
								<input
									list="settings-suggestions"
									type="text"
									bind:value={settingInput}
									placeholder="e.g. LightningExperienceSettings"
									autocomplete="off"
									onkeydown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											addSetting();
										}
									}}
								/>
								<datalist id="settings-suggestions">
									{#each CURATED_SETTINGS as g (g.group)}
										<option value={g.label}></option>
									{/each}
								</datalist>
								<button class="btn btn--ghost tag-add-btn" type="button" onclick={addSetting}
									>Add</button
								>
							</div>
							{#each settingEntries as entry (entry.group)}
								{@const curatedGroup = CURATED_SETTINGS.find((g) => g.group === entry.group)}
								<div class="settings-group-card">
									<div class="settings-group-header">
										<span class="settings-group-name">{curatedGroup?.label ?? entry.group}</span>
										<button
											type="button"
											class="tag-remove"
											onclick={() => removeSetting(entry.group)}
											aria-label={`Remove ${entry.group}`}>Ã—</button
										>
									</div>
									{#if curatedGroup && curatedGroup.subKeys.length > 0}
										<table class="settings-subkeys">
											<tbody>
												{#each curatedGroup.subKeys as subKey (subKey.name)}
													<tr>
														<td>
															<input
																type="checkbox"
																checked={entry.subKeys[subKey.name] ?? subKey.defaultValue}
																onchange={(e) =>
																	toggleSubKey(entry.group, subKey.name, e.currentTarget.checked)}
															/>
														</td>
														<td>{subKey.name}</td>
													</tr>
												{/each}
											</tbody>
										</table>
									{:else if !curatedGroup}
										<p class="settings-group-hint">
											Configure sub-keys in the JSON editor (Step 4).
										</p>
									{/if}
								</div>
							{/each}
						</div>
					{:else}
						{#if snapshotFetchState === "loading"}
							<p class="wizard-section-hint">Loading snapshots from the selected Dev Hub...</p>
						{:else if snapshotFetchState === "failed"}
							<p class="error-text">{snapshotError || "Failed to load snapshots."}</p>
						{/if}

						{#if canUseSnapshotMode}
							<div class="snapshot-list" role="list" aria-label="Available snapshots">
								{#each snapshots as snapshot (snapshot.id)}
									{@const badge = snapshotBadge(snapshot)}
									{@const isExpired = isExpiredSnapshot(snapshot)}
									<button
										type="button"
										class="snapshot-card"
										class:selected={selectedSnapshotName === snapshot.snapshotName}
										disabled={isExpired}
										onclick={() => {
											selectedSnapshotName = snapshot.snapshotName;
											step3Snapshot = undefined;
										}}
									>
										<div class="snapshot-card-header">
											<strong>{snapshot.snapshotName}</strong>
											<span class="snapshot-date">{formatSnapshotDate(snapshot.createdDate)}</span>
										</div>
										{#if snapshot.description}
											<p>{snapshot.description}</p>
										{/if}
										<div class="snapshot-meta">
											<span>Status: {snapshot.status}</span>
											{#if badge}
												<span class={snapshotBadgeClass(snapshot)}>{badge}</span>
											{/if}
										</div>
									</button>
								{/each}
							</div>
						{/if}
					{/if}
				</div>
			{:else if currentStep === "definition"}
				<div class="wizard-section">
					<p class="wizard-section-hint">
						Review and edit the scratch org definition JSON before creation. Edit freely â€” changes
						here are sent directly to Salesforce.
					</p>

					{#if regeneratedNotice}
						<p class="wizard-notice">JSON regenerated from updated settings.</p>
					{/if}

					{#if creationMode === "snapshot"}
						<p class="snapshot-advisory">
							<strong>Snapshot mode â€” advanced edits not recommended.</strong> When a
							<code>snapshot</code> key is present, Salesforce only honors a small set of co-supported
							fields. Adding or changing other keys here is allowed by the editor but will likely cause
							scratch org creation to fail. Stick with the pre-filled definition unless you know exactly
							which keys your snapshot supports.
						</p>
					{/if}

					<label class="field-group" class:field-error={jsonError !== ""}>
						Scratch Definition
						<textarea
							class="definition-editor"
							value={definitionJson}
							oninput={(e) => onDefinitionInput(e.currentTarget.value)}
							rows={20}
							spellcheck={false}
							aria-label="Scratch org definition JSON"
						></textarea>
						{#if jsonError}
							<span class="error-text">{jsonError}</span>
						{/if}
					</label>
				</div>
			{:else if currentStep === "create"}
				<div class="wizard-section">
					{#if isCreating}
						<div class="create-progress">
							<div class="deployment-status-active">
								<div class="spinner large-spinner" aria-hidden="true"></div>
								<h3>Creating...</h3>
								<p class="muted">{createMessage}</p>
							</div>
						</div>
					{:else}
						<div
							class="deployment-result-summary"
							class:success={!!createdUsername}
							class:failed={!!createError && !createdUsername}
						>
							<div class="result-icon-large" aria-hidden="true">
								{#if createdUsername}
									<svg viewBox="0 0 24 24" focusable="false">
										<path d="m6 12 4 4 8-8" />
									</svg>
								{:else}
									<svg viewBox="0 0 24 24" focusable="false">
										<path d="m7 7 10 10M17 7 7 17" />
									</svg>
								{/if}
							</div>
							<h3>{createdUsername ? "Success" : "Failed"}</h3>
							{#if createdUsername}
								<p class="result-message">Scratch org created successfully.</p>
								<div class="result-detail-card">
									<div>
										<span>Username</span>
										<strong>{createdUsername}</strong>
									</div>
									<div>
										<span>Alias</span>
										<strong>{alias || "â€”"}</strong>
									</div>
									<div>
										<span>Edition</span>
										<strong>{edition}</strong>
									</div>
									<div>
										<span>Duration</span>
										<strong>{durationDays} days</strong>
									</div>
								</div>
								{#if createWarnings.length > 0}
									<div class="warning-box result-warnings">
										{#each createWarnings as warning (warning)}
											<p>{warning}</p>
										{/each}
									</div>
								{/if}
							{:else if createError}
								<p class="result-message">{createError}</p>
								<p class="create-retry-hint">Your inputs are preserved. Fix the issue and retry.</p>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<footer class="cart-drawer-footer wizard-modal-footer">
			<!-- Left: secondary action -->
			{#if currentStep === "devhub"}
				<button class="btn btn--ghost drawer-secondary-action" type="button" onclick={onClose}
					>Cancel</button
				>
			{:else if currentStep === "settings" || currentStep === "definition"}
				<button class="btn btn--ghost drawer-secondary-action" type="button" onclick={goBack}
					>Back</button
				>
			{:else if currentStep === "create" && createdUsername}
				<button class="btn btn--ghost drawer-secondary-action" type="button" onclick={handleDone}
					>Done</button
				>
			{:else if currentStep === "create" && createError && !isCreating}
				<button
					class="btn btn--ghost drawer-secondary-action"
					type="button"
					onclick={retryFromDefinition}>Back to Definition</button
				>
			{:else}
				<span></span>
			{/if}

			<!-- Right: primary action -->
			{#if currentStep === "devhub"}
				<button
					class="btn btn--primary drawer-primary-action"
					type="button"
					onclick={goNext}
					disabled={!canProceedFromDevHub}
				>
					Next
				</button>
			{:else if currentStep === "settings"}
				<button
					class="btn btn--primary drawer-primary-action"
					type="button"
					onclick={goNext}
					disabled={!canProceedFromSettings}
				>
					Next
				</button>
			{:else if currentStep === "definition"}
				<button
					class="btn btn--primary drawer-primary-action"
					type="button"
					onclick={goNext}
					disabled={!canCreate}
				>
					Create Scratch Org
				</button>
			{:else if currentStep === "create" && createdUsername}
				<button
					class="btn btn--primary drawer-primary-action"
					type="button"
					onclick={handleSetActive}
				>
					Set as Active Org
				</button>
			{:else}
				<span></span>
			{/if}
		</footer>
	</div>
</div>

<style>
	.wizard-modal {
		width: 740px;
		max-width: 96vw;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		padding: 0;
	}

	.wizard-modal-header {
		border-bottom: 1px solid var(--color-border-subtle);
		padding: 20px 24px;
		flex-shrink: 0;
	}

	.wizard-modal-footer {
		padding: 18px 24px;
		flex-shrink: 0;
	}

	.wizard-body {
		flex: 1;
		overflow-y: auto;
		padding: 1.5rem 2rem;
	}

	.wizard-section {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.wizard-section-hint {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		margin: 0;
	}

	.wizard-notice {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		background: rgba(148, 163, 184, 0.08);
		border: 1px solid rgba(148, 163, 184, 0.2);
		border-radius: var(--radius);
		padding: 0.4rem 0.75rem;
		margin: 0;
	}

	.org-picker {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-height: 300px;
		overflow-y: auto;
		border: 1px solid var(--color-border-subtle);
		border-radius: 4px;
	}

	.org-pick-row {
		display: grid;
		grid-template-columns: 1fr 1.5fr auto;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		text-align: left;
		border: none;
		border-bottom: 1px solid var(--color-border-subtle);
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		font-size: 0.85rem;
	}

	.org-pick-row:last-child {
		border-bottom: none;
	}

	.org-pick-row:hover {
		background: var(--color-bg-hover);
	}

	.org-pick-row.selected {
		background: var(--color-primary-subtle);
		outline: 2px solid var(--color-primary);
		outline-offset: -2px;
	}

	.org-pick-row--uncertain {
		opacity: 0.85;
	}

	.org-pick-alias {
		font-weight: 600;
		color: var(--color-text-main);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.org-pick-username {
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.8rem;
	}

	.org-pick-env {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.badge-unknown {
		display: inline-block;
		font-size: 0.7rem;
		font-weight: 500;
		padding: 0.1rem 0.4rem;
		border-radius: 10px;
		background: rgba(234, 179, 8, 0.15);
		color: var(--color-warning);
		margin-left: 0.4rem;
	}

	.field-label {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-text-muted);
		margin: 0 0 0.25rem;
	}

	.other-orgs-label {
		margin-top: 0.75rem;
	}

	.field-group {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.875rem;
	}

	.creation-segmented {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.4rem;
	}

	.settings-grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem 1.5rem;
		align-items: end;
	}

	.mode-button {
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg-elevated);
		color: var(--color-text-secondary);
		padding: 0.6rem 0.8rem;
		text-align: center;
		font-size: 0.875rem;
		border-radius: 6px;
	}

	.mode-button.active {
		border-color: var(--color-primary);
		background: var(--color-primary-subtle);
		color: var(--color-primary);
		font-weight: 600;
	}

	.mode-button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.field-group input,
	.field-group select,
	.field-group textarea {
		width: 100%;
		box-sizing: border-box;
	}

	.field-group.field-error input,
	.field-group.field-error textarea {
		outline: 2px solid var(--color-danger);
	}

	.field-hint {
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.error-text {
		font-size: 0.775rem;
		color: var(--color-danger);
	}

	.tag-input-row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.tag-input-row input {
		flex: 1;
	}

	.tag-add-btn {
		white-space: nowrap;
		padding: 0.25rem 0.6rem;
		font-size: 0.8rem;
	}

	.tag-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.25rem;
	}

	.tag {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.15rem 0.5rem;
		background: var(--color-primary-subtle);
		border-radius: 12px;
		font-size: 0.8rem;
		color: var(--color-primary);
	}

	.tag-remove {
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
		font-size: 1rem;
		line-height: 1;
		color: inherit;
		opacity: 0.7;
	}

	.tag-remove:hover {
		opacity: 1;
	}

	.settings-group-card {
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-lg);
		background: var(--color-bg-recessed);
		margin-top: 0.4rem;
		overflow: hidden;
	}

	.settings-group-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.4rem 0.6rem 0.4rem 0.75rem;
		background: var(--color-bg-elevated);
	}

	.settings-group-name {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	.settings-subkeys {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
		color: var(--color-text-secondary);
	}

	.settings-subkeys td {
		padding: var(--space-1) var(--space-3);
		vertical-align: middle;
	}

	.settings-subkeys td:first-child {
		width: 32px;
		text-align: center;
	}

	.settings-group-hint {
		font-size: 0.78rem;
		color: var(--color-text-dim);
		font-style: italic;
		margin: 0;
		padding: 0.4rem 0.75rem 0.5rem;
	}

	.definition-editor {
		font-family: monospace;
		font-size: 0.8rem;
		resize: vertical;
		min-height: 300px;
		line-height: 1.5;
		white-space: pre;
		overflow-x: auto;
	}

	.snapshot-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-height: 420px;
		overflow-y: auto;
		padding-right: 0.125rem;
	}

	.snapshot-card {
		border: 1px solid var(--color-border-subtle);
		border-radius: 6px;
		background: var(--color-bg-elevated);
		padding: 0.6rem 0.7rem;
		text-align: left;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		color: var(--color-text-secondary);
	}

	.snapshot-card.selected {
		border-color: var(--color-primary);
		box-shadow: inset 0 0 0 1px var(--color-primary);
	}

	.snapshot-card:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.snapshot-card-header {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		align-items: center;
	}

	.snapshot-date {
		color: var(--color-text-muted);
		font-size: 0.75rem;
		white-space: nowrap;
	}

	.snapshot-card p {
		margin: 0;
		font-size: 0.8rem;
	}

	.snapshot-meta {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		align-items: center;
		font-size: 0.75rem;
	}

	.snapshot-badge {
		padding: 0.1rem 0.35rem;
		border-radius: 999px;
		font-weight: 600;
	}

	.snapshot-badge--caution {
		background: rgba(245, 158, 11, 0.2);
		color: #92400e;
	}

	.snapshot-badge--warning {
		background: rgba(217, 119, 6, 0.25);
		color: #78350f;
	}

	.snapshot-badge--expired {
		background: rgba(239, 68, 68, 0.2);
		color: #991b1b;
	}

	.snapshot-advisory {
		font-size: 0.8rem;
		color: var(--color-text-secondary);
		background: rgba(245, 158, 11, 0.12);
		border: 1px solid rgba(245, 158, 11, 0.35);
		border-radius: 6px;
		padding: 0.55rem 0.7rem;
		margin: 0;
	}

	.create-progress {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 2rem 0;
	}

	.result-warnings {
		margin-top: 1rem;
		max-width: 100%;
		text-align: left;
	}

	.create-retry-hint {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		margin: 0;
	}

	.empty-hint {
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.v2-tease {
		font-size: 0.775rem;
		color: var(--color-text-dim);
		font-style: italic;
		margin: 0;
	}
</style>
