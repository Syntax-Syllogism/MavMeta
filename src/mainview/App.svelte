<script lang="ts">
	import { onMount } from "svelte";
	import type { ComponentType } from "svelte";
	import Building2 from "@lucide/svelte/icons/building-2";
	import Code2 from "@lucide/svelte/icons/code-2";
	import Layers from "@lucide/svelte/icons/layers";
	import Database from "@lucide/svelte/icons/database";
	import Moon from "@lucide/svelte/icons/moon";
	import Settings from "@lucide/svelte/icons/settings";
	import Sun from "@lucide/svelte/icons/sun";
	import Table2 from "@lucide/svelte/icons/table-2";
	import Terminal from "@lucide/svelte/icons/terminal";

	import AliasModal from "./AliasModal.svelte";
	import CreateScratchOrgModal from "./orgs/CreateScratchOrgModal.svelte";
	import OrgDirectory from "./orgs/OrgDirectory.svelte";
	import ScratchDeleteModal from "./ScratchDeleteModal.svelte";
	import StatusBar from "./StatusBar.svelte";
	import MetadataCartWizard from "./cart/MetadataCartWizard.svelte";
	import { backendClient } from "./backend/backend-client";
	import type { OrgListResponse, OrgSummary } from "../shared/org";
	import type {
		CrossOrgDiffResult,
		MetadataComponentSummary,
		MetadataTypeSummary,
	} from "../shared/metadata";
	import type {
		CrossOrgDeployResult,
		DestructiveDeployResult,
		HitListComponentInput,
	} from "../shared/deploy";
	import {
		buildStagedItemGroups,
		deriveSingleSourceOrgUsername,
		formatItemCount,
		getCartTitle,
		listEligibleTargetOrgs,
		toStagedItemId,
		type CartAction,
		type CartStep,
		type StagedItem,
	} from "./cart/cart-view-model";
	import {
		buildPackageXml,
		DEFAULT_METADATA_API_VERSION,
		parsePackageXml,
		parseSavedMetadataShoppingListsPayload,
		SAVED_METADATA_SHOPPING_LISTS_STORAGE_KEY,
		serializeSavedMetadataShoppingLists,
		type SavedMetadataShoppingList,
		type SavedMetadataShoppingListItem,
	} from "./cart/saved-shopping-lists";
	import type { DeployMode } from "./cart/types";
	import {
		buildPreflightSkippedComponents,
		getDeployConfirmationPhrase,
	} from "./deploy/deploy-view-model";
	import {
		buildMetadataComponentGroups,
		matchesMetadataComponentSearch,
		matchesMetadataTypeFilter,
	} from "./metadata/metadata-view-model";
	import MetadataExplorer from "./metadata/MetadataExplorer.svelte";
	import ObjectExplorer from "./objects/ObjectExplorer.svelte";
	import RestExplorer from "./rest/RestExplorer.svelte";
	import SoqlExplorer from "./soql/SoqlExplorer.svelte";
	import LwcPlayground from "./lwc/LwcPlayground.svelte";

	type WorkbenchTool = "Orgs" | "Metadata" | "Objects" | "REST" | "LWC" | "SOQL";

	let orgs = $state<OrgSummary[]>([]);
	let activeOrg = $state<OrgSummary | undefined>();
	let isLoadingOrgs = $state(true);
	let isLoadingMetadataTypes = $state(false);
	let activeAction = $state<string | undefined>();
	let statusMessage = $state("Loading authenticated orgs.");
	let authLoginUrl = $state("https://login.salesforce.com");
	let authAlias = $state("");
	let aliasEditorOrg = $state<OrgSummary | undefined>();
	let aliasDraft = $state("");
	let scratchDeleteOrg = $state<OrgSummary | undefined>();
	let scratchDeleteConfirmed = $state(false);
	let isCreateScratchOrgModalOpen = $state(false);
	let selectedTool = $state<WorkbenchTool>("Orgs");
	let metadataTypes = $state<MetadataTypeSummary[]>([]);
	let metadataTypeFilter = $state("");
	let metadataApiVersion = $state<string | undefined>();
	let metadataTargetUsername = $state<string | undefined>();
	let selectedMetadataTypeXmlName = $state("");
	let isLoadingMetadataComponents = $state(false);
	let metadataComponents = $state<MetadataComponentSummary[]>([]);
	let metadataComponentErrors = $state<string[]>([]);
	let metadataComponentSearch = $state("");
	let metadataComponentTargetType = $state<string | undefined>();
	let selectedMetadataComponentFullName = $state<string | undefined>();
	let expandedMetadataGroups = $state<string[]>([]);
	let isMetadataInspectorExpanded = $state(true);
	let isXmlSectionOpen = $state(false);
	let isLoadingComponentSource = $state(false);
	let componentSource = $state<string | undefined>();
	let componentSourceError = $state<string | undefined>();
	let currentSourceRequestId = 0;
	let activeListingRequestId = 0;
	let stagedItems = $state<StagedItem[]>([]);
	let isCartOpen = $state(false);
	let isOrgSwitchAlertOpen = $state(false);
	let pendingOrgToSwitch = $state<OrgSummary | undefined>();
	let cartStep = $state<CartStep>("list");
	let cartAction = $state<CartAction | undefined>();
	let saveListName = $state("");
	let isListSaved = $state(false);
	let saveListToastTimer: ReturnType<typeof setTimeout> | undefined;
	let savedMetadataShoppingLists = $state<SavedMetadataShoppingList[]>([]);
	let isLoadingSavedList = $state(false);
	let lastSkippedSavedListItems = $state<SavedMetadataShoppingListItem[]>([]);
	let deployTypedConfirmation = $state("");
	let isRunningDeploy = $state(false);
	let quirkyDeployMessageIndex = $state(0);
	let lastDeployResult = $state<DestructiveDeployResult | CrossOrgDeployResult | undefined>();
	let activeDeployOperationId = $state<string | undefined>();
	let deployProgressPercent = $state(0);
	let deployProgressMessage = $state("");
	let compareTargetUsername = $state<string | undefined>();
	let isRunningCompare = $state(false);
	let compareResults = $state<CrossOrgDiffResult[]>([]);
	const metadataTypesCache = new Map<
		string,
		{ types: MetadataTypeSummary[]; apiVersion?: string }
	>();
	const metadataComponentsCache = new Map<
		string,
		{
			components: MetadataComponentSummary[];
			errors: Array<{ scope?: string; message: string }>;
			apiVersion?: string;
		}
	>();
	const STAGED_ITEMS_STORAGE_KEY = "mavmeta:staged-items";
	const DEPLOY_STATUS_POLL_INTERVAL_MS = 3000;
	const COMPARE_QUIRKY_MESSAGE_INTERVAL_MS = 3000;
	const DEPLOYMENT_STATUS_START_PATH = "/lightning/setup/DeployStatus/home";

	const quirkyDeployMessages = [
		"deconstructing safeguards",
		"discombobulating metadata",
		"calibrating meltdown vectors",
		"untangling component entropy",
		"aligning destructive payload",
	];
	const cartWorkflowSteps: Array<{ step: CartStep; label: string }> = [
		{ step: "list", label: "List" },
		{ step: "actions", label: "Actions" },
		{ step: "confirm", label: "Confirm" },
		{ step: "result", label: "Result" },
	];
	const toolNavItems: Array<{
		tool: WorkbenchTool;
		tooltip: string;
		ariaLabel: string;
		icon: ComponentType;
	}> = [
		{ tool: "Orgs", tooltip: "Orgs", ariaLabel: "Environment Explorer", icon: Building2 },
		{ tool: "Metadata", tooltip: "Metadata", ariaLabel: "Metadata Explorer", icon: Layers },
		{ tool: "Objects", tooltip: "Objects", ariaLabel: "Object Explorer", icon: Table2 },
		{ tool: "LWC", tooltip: "LWC", ariaLabel: "LWC Editor", icon: Code2 },
		{ tool: "REST", tooltip: "REST", ariaLabel: "REST Explorer", icon: Terminal },
		{ tool: "SOQL", tooltip: "SOQL", ariaLabel: "SOQL Explorer", icon: Database },
	];

	const activeOrgLabel = $derived(activeOrg?.alias ?? activeOrg?.username ?? "No active org");
	const isBusy = $derived(
		activeAction !== undefined ||
			isLoadingOrgs ||
			isLoadingMetadataTypes ||
			isLoadingMetadataComponents ||
			isRunningDeploy,
	);
	const selectedMetadataType = $derived(
		metadataTypes.find((metadataType) => metadataType.xmlName === selectedMetadataTypeXmlName),
	);
	const visibleMetadataTypes = $derived(
		metadataTypes.filter((metadataType) =>
			matchesMetadataTypeFilter(metadataType, metadataTypeFilter),
		),
	);
	const filteredMetadataComponents = $derived(
		metadataComponents.filter((component) =>
			matchesMetadataComponentSearch(component, metadataComponentSearch),
		),
	);
	const metadataComponentGroups = $derived(
		buildMetadataComponentGroups(filteredMetadataComponents, expandedMetadataGroups),
	);
	const shouldGroupMetadataComponents = $derived(selectedMetadataType?.inFolder === true);
	const selectedMetadataComponent = $derived(
		metadataComponents.find(
			(component) => component.fullName === selectedMetadataComponentFullName,
		),
	);
	const activeOrgStagedItems = $derived(
		activeOrg ? stagedItems.filter((item) => item.orgUsername === activeOrg.username) : [],
	);
	const stagedItemGroups = $derived(buildStagedItemGroups(activeOrgStagedItems));
	const sourceOrgUsername = $derived(deriveSingleSourceOrgUsername(activeOrgStagedItems));
	const sourceOrgLabel = $derived(
		orgs.find((org) => org.username === sourceOrgUsername)?.alias ??
			sourceOrgUsername ??
			"Unknown source org",
	);
	const compareTargetOptions = $derived(listEligibleTargetOrgs(orgs, sourceOrgUsername));
	const compareTargetLabel = $derived(
		orgs.find((org) => org.username === compareTargetUsername)?.alias ??
			compareTargetUsername ??
			"Select target org",
	);
	const compareTargetInstanceUrl = $derived(selectedCrossTargetOrg?.instanceUrl);
	const isProductionLikeTarget = $derived(
		activeOrg?.environment === "production" || activeOrg?.environment === "developer",
	);
	const selectedCrossTargetOrg = $derived(
		orgs.find((org) => org.username === compareTargetUsername),
	);
	const isCrossTargetProductionLike = $derived(
		selectedCrossTargetOrg?.environment === "production" ||
			selectedCrossTargetOrg?.environment === "developer",
	);
	const deployConfirmationPhrase = $derived(
		getDeployConfirmationPhrase(
			cartAction === "deploy"
				? compareTargetLabel === "Select target org"
					? undefined
					: compareTargetLabel
				: (activeOrg?.alias ?? activeOrg?.username),
		),
	);
	const deployTypedConfirmationMatches = $derived(
		deployTypedConfirmation === deployConfirmationPhrase,
	);
	const preflightSkippedComponents = $derived(
		buildPreflightSkippedComponents(activeOrgStagedItems),
	);
	const preflightDeployableCount = $derived(
		activeOrgStagedItems.length - preflightSkippedComponents.length,
	);
	const canRunDeleteAction = $derived(
		(cartAction === "delete" || cartAction === "deploy") &&
			preflightDeployableCount > 0 &&
			!isRunningDeploy,
	);
	const canDeployValidatedResult = $derived(
		cartAction === "delete" &&
			lastDeployResult?.state === "Succeeded" &&
			lastDeployResult.mode === "validate" &&
			activeOrgStagedItems.length > 0 &&
			preflightDeployableCount > 0 &&
			!isRunningDeploy,
	);
	const canDeployValidatedCrossOrgResult = $derived(
		cartAction === "deploy" &&
			lastDeployResult?.state === "Succeeded" &&
			lastDeployResult.mode === "validate" &&
			activeOrgStagedItems.length > 0 &&
			preflightDeployableCount > 0 &&
			!isRunningDeploy,
	);
	const quirkyDeployMessage = $derived(
		quirkyDeployMessages[quirkyDeployMessageIndex % quirkyDeployMessages.length],
	);
	const cartStepIndex = $derived(
		cartWorkflowSteps.findIndex((workflowStep) => workflowStep.step === cartStep),
	);
	const cartTitle = $derived(getCartTitle(cartStep));
	const cartSubtitle = $derived(
		`${formatItemCount(activeOrgStagedItems.length)} staged from ${activeOrgLabel}`,
	);

	onMount(() => {
		restoreStagedItemsFromStorage();
		restoreSavedMetadataShoppingLists();
		void loadOrgs();
		void backendClient.announceReady();
	});

	$effect(() => {
		if (typeof window === "undefined") return;
		if (!stagedItems.length) {
			localStorage.removeItem(STAGED_ITEMS_STORAGE_KEY);
			return;
		}
		localStorage.setItem(STAGED_ITEMS_STORAGE_KEY, JSON.stringify(stagedItems));
	});

	$effect(() => {
		if (typeof window === "undefined") return;
		if (!savedMetadataShoppingLists.length) {
			localStorage.removeItem(SAVED_METADATA_SHOPPING_LISTS_STORAGE_KEY);
			return;
		}
		localStorage.setItem(
			SAVED_METADATA_SHOPPING_LISTS_STORAGE_KEY,
			serializeSavedMetadataShoppingLists(savedMetadataShoppingLists),
		);
	});

	$effect(() => {
		if (!orgs.length || !stagedItems.length) return;
		const validOrgUsernames = new Set(orgs.map((org) => org.username));
		const nextStagedItems = stagedItems.filter((item) => validOrgUsernames.has(item.orgUsername));
		if (nextStagedItems.length !== stagedItems.length) {
			stagedItems = nextStagedItems;
		}
	});

	$effect(() => {
		if (!isRunningCompare) return;
		const interval = window.setInterval(() => {
			quirkyDeployMessageIndex += 1;
		}, COMPARE_QUIRKY_MESSAGE_INTERVAL_MS);
		return () => window.clearInterval(interval);
	});

	async function loadOrgs() {
		isLoadingOrgs = true;
		statusMessage = "Loading authenticated orgs.";

		try {
			const response = await backendClient.listOrgs();
			applyOrgList(response);
			statusMessage = response.orgs.length ? "Org list loaded." : "No Salesforce orgs found yet.";
		} catch (error) {
			statusMessage = toErrorMessage(error);
		} finally {
			isLoadingOrgs = false;
		}
	}

	function selectTool(tool: WorkbenchTool) {
		selectedTool = tool;

		if (tool === "Metadata") {
			void loadMetadataTypes();
		}
	}

	async function loadMetadataTypes(forceRefresh = false) {
		if (!activeOrg) {
			statusMessage = "Select an active org before discovering metadata.";
			metadataTypes = [];
			metadataApiVersion = undefined;
			metadataTargetUsername = undefined;
			return;
		}

		const cached = metadataTypesCache.get(activeOrg.username);
		if (!forceRefresh && cached) {
			metadataTypes = cached.types;
			metadataApiVersion = cached.apiVersion;
			metadataTargetUsername = activeOrg.username;
			statusMessage = `Loaded ${cached.types.length} cached metadata types.`;
			return;
		}

		isLoadingMetadataTypes = true;
		metadataTargetUsername = activeOrg.username;
		statusMessage = `Discovering metadata types for ${activeOrg.alias ?? activeOrg.username}.`;

		try {
			const response = await backendClient.listMetadataTypes({
				target: { username: activeOrg.username },
			});
			metadataTypes = response.types;
			metadataApiVersion = response.apiVersion;
			metadataTypesCache.set(activeOrg.username, {
				types: response.types,
				apiVersion: response.apiVersion,
			});
			if (
				selectedMetadataTypeXmlName &&
				!response.types.some((metadataType) => metadataType.xmlName === selectedMetadataTypeXmlName)
			) {
				clearMetadataComponentExplorer();
			}
			statusMessage = `Discovered ${response.types.length} metadata types.`;
		} catch (error) {
			metadataTypes = [];
			metadataApiVersion = undefined;
			statusMessage = toErrorMessage(error);
		} finally {
			isLoadingMetadataTypes = false;
		}
	}

	async function authOrg() {
		const aliasLabel = authAlias.trim() ? ` as ${authAlias.trim()}` : "";
		statusMessage = `Authorizing ${authLoginUrl}${aliasLabel}...`;
		await runOrgAction("auth-org", async () => {
			const response = await backendClient.authOrg({
				loginUrl: authLoginUrl,
				alias: authAlias.trim() || undefined,
			});
			statusMessage = response.message;
			authAlias = "";
			await loadOrgs();
		});
	}

	function selectMetadataComponent(fullName: string) {
		if (selectedMetadataComponentFullName === fullName) {
			return;
		}
		selectedMetadataComponentFullName = fullName;
		componentSource = undefined;
		componentSourceError = undefined;
	}

	async function listMetadataComponents(
		metadataType: MetadataTypeSummary | undefined = selectedMetadataType,
		forceRefresh = false,
	) {
		if (!activeOrg) {
			statusMessage = "Select an active org before listing metadata components.";
			return;
		}

		if (!metadataType) {
			statusMessage = "Select a metadata type before listing components.";
			return;
		}

		const requestId = ++activeListingRequestId;
		selectedMetadataTypeXmlName = metadataType.xmlName;
		isLoadingMetadataComponents = true;
		metadataComponents = [];
		metadataComponentErrors = [];
		selectedMetadataComponentFullName = undefined;
		expandedMetadataGroups = [];
		metadataComponentTargetType = metadataType.xmlName;
		statusMessage = `Listing ${metadataType.label} components for ${activeOrg.alias ?? activeOrg.username}.`;
		const cacheKey = `${activeOrg.username}::${metadataType.xmlName.toLowerCase()}`;
		const cached = metadataComponentsCache.get(cacheKey);
		if (!forceRefresh && cached) {
			metadataComponents = cached.components;
			metadataComponentErrors = cached.errors.map((error) =>
				error.scope ? `${error.scope}: ${error.message}` : error.message,
			);
			if (cached.components.length > 0) {
				selectMetadataComponent(cached.components[0].fullName);
			} else {
				selectedMetadataComponentFullName = undefined;
				componentSource = undefined;
				componentSourceError = undefined;
			}
			expandedMetadataGroups = [];
			statusMessage = cached.components.length
				? `Loaded ${cached.components.length} cached ${metadataType.label} components.`
				: `No ${metadataType.label} components returned.`;
			isLoadingMetadataComponents = false;
			return;
		}

		try {
			const response = await backendClient.listMetadataComponents({
				target: { username: activeOrg.username },
				metadataType: metadataType.xmlName,
			});
			if (requestId !== activeListingRequestId) return;
			metadataComponents = response.components;
			metadataComponentErrors = response.errors.map((error) =>
				error.scope ? `${error.scope}: ${error.message}` : error.message,
			);
			metadataComponentsCache.set(cacheKey, {
				components: response.components,
				errors: response.errors,
				apiVersion: response.apiVersion,
			});
			if (response.components.length > 0) {
				selectMetadataComponent(response.components[0].fullName);
			} else {
				selectedMetadataComponentFullName = undefined;
				componentSource = undefined;
				componentSourceError = undefined;
			}
			// All groups collapsed by default per user feedback
			expandedMetadataGroups = [];
			statusMessage = response.components.length
				? `Listed ${response.components.length} ${metadataType.label} components.`
				: `No ${metadataType.label} components returned.`;
		} catch (error) {
			if (requestId !== activeListingRequestId) return;
			const message = toMetadataComponentListErrorMessage(error);
			metadataComponentErrors = [message];
			statusMessage = message;
		} finally {
			if (requestId === activeListingRequestId) {
				isLoadingMetadataComponents = false;
			}
		}
	}

	function cancelMetadataListing() {
		if (!isLoadingMetadataComponents) return;
		activeListingRequestId++;
		isLoadingMetadataComponents = false;
		statusMessage = "Component listing canceled.";
	}

	function clearMetadataComponentExplorer() {
		metadataComponents = [];
		metadataComponentErrors = [];
		metadataComponentSearch = "";
		metadataComponentTargetType = undefined;
		selectedMetadataComponentFullName = undefined;
		expandedMetadataGroups = [];
		isXmlSectionOpen = false;
		componentSource = undefined;
		componentSourceError = undefined;
		isLoadingComponentSource = false;
	}

	async function loadComponentSource() {
		if (!activeOrg || !selectedMetadataComponent) {
			return;
		}

		// If we already have the source for this specific component, don't reload.
		// componentSource is cleared in selectMetadataComponent whenever selection changes.
		if (componentSource || isLoadingComponentSource) {
			return;
		}

		const requestId = ++currentSourceRequestId;
		const targetFullName = selectedMetadataComponent.fullName;
		const targetType = selectedMetadataComponent.type;

		isLoadingComponentSource = true;
		componentSourceError = undefined;

		try {
			const response = await backendClient.getComponentSource({
				target: { username: activeOrg.username },
				metadataType: targetType,
				fullName: targetFullName,
			});

			// Verification: are we still interested in this specific request?
			if (requestId !== currentSourceRequestId) {
				return;
			}

			if (response.error) {
				componentSourceError = response.error.message;
			} else {
				componentSource = response.source;
			}
		} catch (error) {
			if (requestId === currentSourceRequestId) {
				componentSourceError = toErrorMessage(error);
			}
		} finally {
			if (requestId === currentSourceRequestId) {
				isLoadingComponentSource = false;
			}
		}
	}

	function toggleMetadataGroup(groupName: string) {
		expandedMetadataGroups = expandedMetadataGroups.includes(groupName)
			? expandedMetadataGroups.filter((candidate) => candidate !== groupName)
			: [...expandedMetadataGroups, groupName];
	}

	async function openOrg(org: OrgSummary) {
		statusMessage = `Opening ${org.alias ?? org.username} in browser...`;
		await runOrgAction(`open-${org.username}`, async () => {
			const response = await backendClient.openOrg({ username: org.username });
			statusMessage = response.message;
		});
	}

	async function setActiveOrg(org: OrgSummary) {
		if (activeOrg && activeOrg.username !== org.username && activeOrgStagedItems.length > 0) {
			pendingOrgToSwitch = org;
			isOrgSwitchAlertOpen = true;
			return;
		}

		await performOrgSwitch(org);
	}

	async function performOrgSwitch(org: OrgSummary) {
		statusMessage = `Switching MavMeta to ${org.alias ?? org.username}...`;
		await runOrgAction(`active-${org.username}`, async () => {
			const response = await backendClient.setActiveOrg({ username: org.username });
			statusMessage = response.message;
			await loadOrgs();
		});
	}

	function confirmOrgSwitch() {
		if (!pendingOrgToSwitch || !activeOrg) {
			return;
		}

		stagedItems = stagedItems.filter((item) => item.orgUsername !== activeOrg.username);

		const org = pendingOrgToSwitch;
		pendingOrgToSwitch = undefined;
		isOrgSwitchAlertOpen = false;
		void performOrgSwitch(org);
	}

	function cancelOrgSwitch() {
		pendingOrgToSwitch = undefined;
		isOrgSwitchAlertOpen = false;
		statusMessage = "Active org switch cancelled.";
	}

	async function refreshOrgStatus(org: OrgSummary) {
		statusMessage = `Refreshing status for ${org.alias ?? org.username}...`;
		await runOrgAction(`refresh-${org.username}`, async () => {
			const response = await backendClient.refreshOrgStatus({
				username: org.username,
			});
			metadataTypesCache.delete(org.username);
			for (const key of metadataComponentsCache.keys()) {
				if (key.startsWith(`${org.username}::`)) {
					metadataComponentsCache.delete(key);
				}
			}
			statusMessage = response.message;
			await loadOrgs();
		});
	}

	async function reauthOrg(org: OrgSummary) {
		statusMessage = `Reauthorizing ${org.alias ?? org.username} in browser...`;
		await runOrgAction(`reauth-${org.username}`, async () => {
			const response = await backendClient.reauthOrg({
				username: org.username,
			});
			statusMessage = response.message;
			await loadOrgs();
		});
	}

	function startAliasEdit(org: OrgSummary) {
		aliasEditorOrg = org;
		aliasDraft = org.alias ?? "";
	}

	function cancelAliasEdit() {
		aliasEditorOrg = undefined;
		aliasDraft = "";
	}

	function startCreateScratchOrg() {
		isCreateScratchOrgModalOpen = true;
	}

	function cancelCreateScratchOrg() {
		isCreateScratchOrgModalOpen = false;
	}

	async function completeCreateScratchOrg(username: string) {
		isCreateScratchOrgModalOpen = false;
		statusMessage = `Scratch org ${username} created.`;
		await loadOrgs();
	}

	async function setCreatedScratchOrgActive(username: string) {
		isCreateScratchOrgModalOpen = false;
		await loadOrgs();
		const org = orgs.find((candidate) => candidate.username === username);
		if (org) {
			await setActiveOrg(org);
		}
	}

	function startScratchDelete(org: OrgSummary) {
		scratchDeleteOrg = org;
		scratchDeleteConfirmed = false;
	}

	function cancelScratchDelete() {
		scratchDeleteOrg = undefined;
		scratchDeleteConfirmed = false;
	}

	async function confirmScratchDelete() {
		const org = scratchDeleteOrg;
		if (!org || !scratchDeleteConfirmed) {
			return;
		}

		statusMessage = `Deleting scratch org ${org.alias ?? org.username}...`;
		await runOrgAction(`delete-${org.username}`, async () => {
			const response = await backendClient.deleteScratchOrg({
				username: org.username,
			});
			statusMessage = response.message;
			cancelScratchDelete();
			await loadOrgs();
		});
	}

	async function saveAlias() {
		const org = aliasEditorOrg;
		const alias = aliasDraft.trim();

		if (!org || !alias) {
			return;
		}

		statusMessage = `Saving alias "${alias}" for ${org.username}...`;
		await runOrgAction(`alias-${org.username}`, async () => {
			const response = await backendClient.setAlias({
				target: { username: org.username },
				alias,
			});
			statusMessage = response.message;
			cancelAliasEdit();
			await loadOrgs();
		});
	}

	async function logoutOrg(org: OrgSummary) {
		const label = org.alias ?? org.username;
		const confirmed = window.confirm(`Remove local auth for ${label}?`);

		if (!confirmed) {
			return;
		}

		statusMessage = `Logging out of ${label}...`;
		await runOrgAction(`logout-${org.username}`, async () => {
			const response = await backendClient.logoutOrg({ username: org.username });
			statusMessage = response.message;
			await loadOrgs();
		});
	}

	async function runOrgAction(actionName: string, action: () => Promise<void>) {
		activeAction = actionName;

		try {
			await action();
		} catch (error) {
			statusMessage = toErrorMessage(error);
		} finally {
			activeAction = undefined;
		}
	}

	function applyOrgList(response: OrgListResponse) {
		const previousActiveUsername = activeOrg?.username;
		orgs = response.orgs;
		activeOrg = response.activeOrg ?? response.orgs.find((org) => org.isDefault);

		if (activeOrg?.username !== previousActiveUsername) {
			metadataTypes = [];
			metadataApiVersion = undefined;
			metadataTargetUsername = undefined;
			selectedMetadataTypeXmlName = "";
			clearMetadataComponentExplorer();
		}
	}

	function restoreStagedItemsFromStorage() {
		if (typeof window === "undefined") return;
		const serialized = localStorage.getItem(STAGED_ITEMS_STORAGE_KEY);
		if (!serialized) return;
		try {
			const parsed = JSON.parse(serialized);
			if (!Array.isArray(parsed)) {
				localStorage.removeItem(STAGED_ITEMS_STORAGE_KEY);
				return;
			}
			stagedItems = parsed.filter(isStoredStagedItem);
		} catch {
			localStorage.removeItem(STAGED_ITEMS_STORAGE_KEY);
		}
	}

	function restoreSavedMetadataShoppingLists() {
		if (typeof window === "undefined") return;
		const serialized = localStorage.getItem(SAVED_METADATA_SHOPPING_LISTS_STORAGE_KEY);
		if (!serialized) return;
		try {
			savedMetadataShoppingLists = parseSavedMetadataShoppingListsPayload(serialized);
		} catch {
			localStorage.removeItem(SAVED_METADATA_SHOPPING_LISTS_STORAGE_KEY);
			savedMetadataShoppingLists = [];
		}
	}

	function isStoredStagedItem(value: unknown): value is StagedItem {
		if (!value || typeof value !== "object") return false;
		const candidate = value as Partial<StagedItem>;
		return (
			typeof candidate.id === "string" &&
			typeof candidate.orgUsername === "string" &&
			typeof candidate.metadataType === "string" &&
			typeof candidate.fullName === "string" &&
			!!candidate.component &&
			typeof candidate.component === "object"
		);
	}

	function toggleStagedItem(component: MetadataComponentSummary, metadataType: string) {
		if (!activeOrg) {
			statusMessage = "Select an active org before staging metadata.";
			return;
		}

		const id = toStagedItemId(activeOrg.username, metadataType, component.fullName);
		const existing = stagedItems.find((item) => item.id === id);

		if (existing) {
			stagedItems = stagedItems.filter((item) => item.id !== id);
			statusMessage = `Unstaged ${component.fullName}.`;
			return;
		}

		stagedItems = [
			...stagedItems,
			{
				id,
				orgUsername: activeOrg.username,
				metadataType,
				fullName: component.fullName,
				component,
			},
		];
		statusMessage = `Staged ${component.fullName}.`;
	}

	function toggleAllStagedItems(components: MetadataComponentSummary[], metadataType: string) {
		if (!activeOrg) {
			statusMessage = "Select an active org before staging metadata.";
			return;
		}

		const componentIds = components.map((c) =>
			toStagedItemId(activeOrg!.username, metadataType, c.fullName),
		);
		const stagedInBatch = stagedItems.filter((item) => componentIds.includes(item.id));
		const allStaged = stagedInBatch.length === components.length && components.length > 0;

		if (allStaged) {
			stagedItems = stagedItems.filter((item) => !componentIds.includes(item.id));
			statusMessage = `Unstaged ${components.length} items.`;
		} else {
			const alreadyStagedIds = new Set(stagedInBatch.map((item) => item.id));
			const newStagedItems: StagedItem[] = components
				.filter(
					(c) =>
						!alreadyStagedIds.has(toStagedItemId(activeOrg!.username, metadataType, c.fullName)),
				)
				.map((c) => ({
					id: toStagedItemId(activeOrg!.username, metadataType, c.fullName),
					orgUsername: activeOrg!.username,
					metadataType,
					fullName: c.fullName,
					component: c,
				}));
			stagedItems = [...stagedItems, ...newStagedItems];
			statusMessage = `Staged ${newStagedItems.length} new items (${components.length} total in batch).`;
		}
	}

	function isComponentStaged(component: MetadataComponentSummary, metadataType: string) {
		if (!activeOrg) {
			return false;
		}

		const id = toStagedItemId(activeOrg.username, metadataType, component.fullName);
		return stagedItems.some((item) => item.id === id);
	}

	function removeStagedItem(itemId: string) {
		stagedItems = stagedItems.filter((item) => item.id !== itemId);
	}

	function clearActiveOrgCart() {
		if (!activeOrg) {
			return;
		}

		stagedItems = stagedItems.filter((item) => item.orgUsername !== activeOrg.username);
		clearSavedListLoadFeedback();
		cartAction = undefined;
		cartStep = "list";
		deployTypedConfirmation = "";
		statusMessage = "Cleared cart for active org.";
	}

	function openMetadataCart() {
		isCartOpen = true;
		clearSavedListLoadFeedback();
		if (!activeOrgStagedItems.length) {
			cartStep = "list";
			cartAction = undefined;
		}
	}

	function closeMetadataCart() {
		isCartOpen = false;
		clearSavedListLoadFeedback();
		if (isRunningDeploy) {
			return;
		}
		if (cartStep !== "result") {
			deployTypedConfirmation = "";
			cartAction = undefined;
		}
	}

	function finishMetadataCartWorkflow() {
		if (isRunningDeploy) {
			return;
		}

		isCartOpen = false;
		resetCartWorkflowState();
	}

	function resetCartWorkflowState() {
		cartStep = "list";
		cartAction = undefined;
		runMode = "validate";
		deployTypedConfirmation = "";
		lastDeployResult = undefined;
		deployProgressPercent = 0;
		deployProgressMessage = "";
		compareTargetUsername = undefined;
		compareResults = [];
		isRunningCompare = false;
		clearSavedListLoadFeedback();
		if (saveListToastTimer) {
			clearTimeout(saveListToastTimer);
			saveListToastTimer = undefined;
		}
		isListSaved = false;
	}

	function clearSavedListLoadFeedback() {
		lastSkippedSavedListItems = [];
		isLoadingSavedList = false;
	}

	function setCartStep(step: CartStep) {
		cartStep = step;
	}

	function selectCartAction(action: CartAction) {
		if (action === "delete") {
			cartAction = action;
			if (!activeOrg || !activeOrgStagedItems.length) {
				statusMessage = "Stage at least one component before deleting.";
			} else {
				statusMessage = "Selected destructive delete for staged metadata.";
			}
			return;
		}

		if (action === "compare") {
			cartAction = action;
			compareResults = [];
			if (!sourceOrgUsername) {
				statusMessage = "Staged metadata must come from exactly one source org.";
				return;
			}
			if (!compareTargetUsername && compareTargetOptions.length) {
				compareTargetUsername = compareTargetOptions[0]?.username;
			}
			statusMessage = "Selected cross-org compare for staged metadata.";
			return;
		}

		if (action === "deploy") {
			cartAction = action;
			if (!sourceOrgUsername) {
				statusMessage = "Staged metadata must come from exactly one source org.";
				return;
			}
			if (!compareTargetUsername && compareTargetOptions.length) {
				compareTargetUsername = compareTargetOptions[0]?.username;
			}
			statusMessage = "Selected cross-org deploy for staged metadata.";
			return;
		}

		statusMessage = "Unknown cart action.";
	}

	function continueFromCartActions() {
		if (cartAction === "delete") {
			startDeleteConfirmation(runMode);
			return;
		}

		if (cartAction === "compare") {
			if (!sourceOrgUsername) {
				statusMessage = "Source org is missing. Re-stage metadata and try again.";
				return;
			}
			if (!compareTargetUsername) {
				statusMessage = "Select a target org before continuing.";
				return;
			}
			cartStep = "confirm";
			statusMessage = "Reviewing cross-org compare request.";
			return;
		}

		if (cartAction === "deploy") {
			if (!sourceOrgUsername) {
				statusMessage = "Source org is missing. Re-stage metadata and try again.";
				return;
			}
			if (!compareTargetUsername) {
				statusMessage = "Select a target org before continuing.";
				return;
			}
			cartStep = "confirm";
			statusMessage = "Reviewing cross-org deploy request.";
			return;
		}

		statusMessage = "Select an available action before continuing.";
	}

	function startDeleteConfirmation(mode: DeployMode, action: "delete" | "deploy" = "delete") {
		if (!activeOrg || !activeOrgStagedItems.length) {
			statusMessage = "Stage at least one component before deploying.";
			return;
		}

		cartAction = action;
		deployTypedConfirmation = "";
		cartStep = "confirm";
		statusMessage =
			action === "deploy"
				? mode === "validate"
					? "Reviewing cross-org validation preflight."
					: "Reviewing cross-org deploy preflight."
				: mode === "validate"
					? "Reviewing destructive validation preflight."
					: "Reviewing destructive deploy preflight.";
		runMode = mode;
	}

	let runMode = $state<DeployMode>("validate");

	function deployValidatedResult() {
		if (!canDeployValidatedResult) {
			statusMessage = "Run a successful validation before deploying.";
			return;
		}

		startDeleteConfirmation("deploy");
	}

	function deployValidatedCrossOrgResult() {
		if (!canDeployValidatedCrossOrgResult) {
			statusMessage = "Run a successful cross-org validation before deploying.";
			return;
		}

		startDeleteConfirmation("deploy", "deploy");
	}

	async function openDeploymentStatusTargetOrg() {
		const targetUsername =
			lastDeployResult?.target.username ??
			(cartAction === "deploy" ? compareTargetUsername : activeOrg?.username);
		if (!targetUsername) {
			statusMessage = "No target org available.";
			return;
		}
		try {
			const response = await backendClient.openOrg({
				username: targetUsername,
				startPath: DEPLOYMENT_STATUS_START_PATH,
			});
			statusMessage = response.message;
		} catch (error) {
			statusMessage = toErrorMessage(error);
		}
	}

	async function openSpecificDeploymentStatus() {
		if (!lastDeployResult) {
			statusMessage = "No deploy result available.";
			return;
		}
		const deployId = extractDeployJobId(lastDeployResult);
		if (!deployId) {
			statusMessage = "Deployment ID unavailable for deep link.";
			return;
		}
		try {
			const response = await backendClient.openOrg({
				username: lastDeployResult.target.username,
				startPath: `/changemgmt/monitorDeploymentsDetails.apexp?asyncId=${encodeURIComponent(deployId)}`,
			});
			statusMessage = response.message;
		} catch (error) {
			statusMessage = toErrorMessage(error);
		}
	}

	async function cancelRunningDeploy() {
		if (!activeDeployOperationId) {
			statusMessage = "No running deploy to cancel.";
			return;
		}

		try {
			const response =
				cartAction === "deploy"
					? await backendClient.cancelCrossOrgDeploy({
							operationId: activeDeployOperationId,
						})
					: await backendClient.cancelDestructiveDeploy({
							operationId: activeDeployOperationId,
						});
			statusMessage = response.message;
		} catch (error) {
			statusMessage = toErrorMessage(error);
		}
	}

	function saveCurrentCartAsSavedList() {
		const trimmedName = saveListName.trim();
		if (!trimmedName) {
			statusMessage = "Enter a list name before saving.";
			return;
		}
		if (!activeOrgStagedItems.length) {
			statusMessage = "Stage metadata in the cart before saving a list.";
			return;
		}

		const existing = savedMetadataShoppingLists.find(
			(list) => list.name.toLowerCase() === trimmedName.toLowerCase(),
		);
		if (
			existing &&
			!window.confirm(`A saved list named "${existing.name}" already exists. Replace it?`)
		) {
			statusMessage = "Save cancelled.";
			return;
		}

		const now = new Date().toISOString();
		const items: SavedMetadataShoppingListItem[] = activeOrgStagedItems.map((item) => ({
			metadataType: item.metadataType,
			fullName: item.fullName,
		}));
		const nextList: SavedMetadataShoppingList = {
			id: existing?.id ?? crypto.randomUUID(),
			name: trimmedName,
			items,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		};
		savedMetadataShoppingLists = existing
			? savedMetadataShoppingLists.map((list) => (list.id === existing.id ? nextList : list))
			: [nextList, ...savedMetadataShoppingLists];

		if (saveListToastTimer) {
			clearTimeout(saveListToastTimer);
		}
		isListSaved = true;
		statusMessage = `Saved ${items.length} metadata items as "${trimmedName}".`;
		saveListToastTimer = setTimeout(() => {
			isListSaved = false;
			saveListToastTimer = undefined;
		}, 2500);
	}

	async function loadSavedShoppingList(listId: string) {
		if (!activeOrg) {
			statusMessage = "Select an active org before loading a saved list.";
			return;
		}
		const list = savedMetadataShoppingLists.find((candidate) => candidate.id === listId);
		if (!list) {
			statusMessage = "Saved list not found.";
			return;
		}
		if (isLoadingSavedList) {
			statusMessage = "A saved-list load is already running.";
			return;
		}
		if (activeOrgStagedItems.length > 0) {
			const shouldReplace = window.confirm(
				"Current cart has staged items. Replace cart with this saved list?",
			);
			if (!shouldReplace) {
				statusMessage = "Load cancelled.";
				return;
			}
		}

		isLoadingSavedList = true;
		clearSavedListLoadFeedback();
		statusMessage = `Validating ${list.items.length} saved items against ${activeOrg.alias ?? activeOrg.username}...`;
		try {
			const validation = await validateSavedListItemsForActiveOrg(list.items);
			const foundItems = validation.found.map(
				({ item, component }) =>
					({
						id: toStagedItemId(activeOrg.username, item.metadataType, item.fullName),
						orgUsername: activeOrg.username,
						metadataType: item.metadataType,
						fullName: item.fullName,
						component,
					}) satisfies StagedItem,
			);
			stagedItems = [
				...stagedItems.filter((item) => item.orgUsername !== activeOrg.username),
				...foundItems,
			];
			lastSkippedSavedListItems = validation.missing;
			cartAction = undefined;
			cartStep = "list";
			deployTypedConfirmation = "";

			const summaryParts = [`Loaded ${foundItems.length} items from "${list.name}".`];
			if (validation.missing.length) {
				summaryParts.push(`${validation.missing.length} were not found and were skipped.`);
			}
			if (validation.erroredTypes.length) {
				const erroredCount = validation.erroredTypes.reduce((count, next) => count + next.count, 0);
				summaryParts.push(
					`${erroredCount} could not be validated due to metadata-type lookup errors.`,
				);
			}
			statusMessage = summaryParts.join(" ");
		} finally {
			isLoadingSavedList = false;
		}
	}

	function renameSavedShoppingList(listId: string) {
		const list = savedMetadataShoppingLists.find((candidate) => candidate.id === listId);
		if (!list) {
			statusMessage = "Saved list not found.";
			return;
		}
		const nextName = window.prompt("Rename saved list", list.name)?.trim();
		if (!nextName) return;
		if (
			savedMetadataShoppingLists.some(
				(candidate) =>
					candidate.id !== list.id && candidate.name.toLowerCase() === nextName.toLowerCase(),
			)
		) {
			statusMessage = `A saved list named "${nextName}" already exists.`;
			return;
		}
		const now = new Date().toISOString();
		savedMetadataShoppingLists = savedMetadataShoppingLists.map((candidate) =>
			candidate.id === list.id ? { ...candidate, name: nextName, updatedAt: now } : candidate,
		);
		statusMessage = `Renamed saved list to "${nextName}".`;
	}

	function deleteSavedShoppingList(listId: string) {
		const list = savedMetadataShoppingLists.find((candidate) => candidate.id === listId);
		if (!list) {
			statusMessage = "Saved list not found.";
			return;
		}
		if (!window.confirm(`Delete saved list "${list.name}"?`)) {
			return;
		}
		savedMetadataShoppingLists = savedMetadataShoppingLists.filter(
			(candidate) => candidate.id !== list.id,
		);
		statusMessage = `Deleted saved list "${list.name}".`;
	}

	function exportSavedShoppingListPackageXml(listId: string) {
		const list = savedMetadataShoppingLists.find((candidate) => candidate.id === listId);
		if (!list) {
			statusMessage = "Saved list not found.";
			return;
		}
		const xml = buildPackageXml(list.items, metadataApiVersion ?? DEFAULT_METADATA_API_VERSION);
		const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
		const href = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = href;
		const slugBase = list.name
			.replace(/[^a-z0-9-_]+/gi, "-")
			.replace(/^-+/, "")
			.replace(/-+$/, "")
			.toLowerCase();
		anchor.download = `${slugBase || "saved-list"}.package.xml`;
		document.body.append(anchor);
		anchor.click();
		anchor.remove();
		URL.revokeObjectURL(href);
		statusMessage = `Exported "${list.name}" as package.xml.`;
	}

	async function importSavedShoppingListPackageXml(file: File) {
		if (!activeOrg) {
			statusMessage = "Select an active org before importing package.xml.";
			return;
		}
		const listName = window.prompt("Name for imported shopping list")?.trim();
		if (!listName) {
			statusMessage = "Import cancelled.";
			return;
		}

		try {
			const xml = await file.text();
			const items = parsePackageXml(xml);
			if (!items.length) {
				throw new Error("No metadata members found in package.xml.");
			}
			const now = new Date().toISOString();
			const existing = savedMetadataShoppingLists.find(
				(list) => list.name.toLowerCase() === listName.toLowerCase(),
			);
			if (
				existing &&
				!window.confirm(`A saved list named "${existing.name}" already exists. Replace it?`)
			) {
				statusMessage = "Import cancelled.";
				return;
			}
			const nextList: SavedMetadataShoppingList = {
				id: existing?.id ?? crypto.randomUUID(),
				name: listName,
				items,
				createdAt: existing?.createdAt ?? now,
				updatedAt: now,
			};
			savedMetadataShoppingLists = existing
				? savedMetadataShoppingLists.map((list) => (list.id === existing.id ? nextList : list))
				: [nextList, ...savedMetadataShoppingLists];

			statusMessage = `Imported ${items.length} items into saved list "${listName}".`;
			const shouldLoadNow = window.confirm("Load imported list into the current cart now?");
			if (shouldLoadNow) {
				await loadSavedShoppingList(nextList.id);
			}
		} catch (error) {
			statusMessage =
				error instanceof Error
					? `Import failed: ${error.message}`
					: "Import failed: invalid package.xml.";
		}
	}

	async function validateSavedListItemsForActiveOrg(items: SavedMetadataShoppingListItem[]) {
		if (!activeOrg) {
			return { found: [], missing: items, erroredTypes: [] };
		}
		const found: Array<{
			item: SavedMetadataShoppingListItem;
			component: MetadataComponentSummary;
		}> = [];
		const missing: SavedMetadataShoppingListItem[] = [];
		const erroredTypes: Array<{ metadataType: string; reason: string; count: number }> = [];
		const byType = new Map<string, SavedMetadataShoppingListItem[]>();
		for (const item of items) {
			const existing = byType.get(item.metadataType) ?? [];
			existing.push(item);
			byType.set(item.metadataType, existing);
		}

		const typeEntries = Array.from(byType.entries());
		const results = await Promise.all(
			typeEntries.map(async ([metadataType, typeItems]) => {
				try {
					const response = await backendClient.listMetadataComponents({
						target: { username: activeOrg.username },
						metadataType,
					});
					const byFullName = new Map(
						response.components.map((component) => [component.fullName.toLowerCase(), component]),
					);
					const foundForType: Array<{
						item: SavedMetadataShoppingListItem;
						component: MetadataComponentSummary;
					}> = [];
					const missingForType: SavedMetadataShoppingListItem[] = [];
					for (const item of typeItems) {
						const component = byFullName.get(item.fullName.toLowerCase());
						if (component) {
							foundForType.push({ item, component });
						} else {
							missingForType.push(item);
						}
					}
					return { found: foundForType, missing: missingForType };
				} catch (error) {
					const reason = error instanceof Error ? error.message : "Lookup failed.";
					console.error(`[saved-list-validation] ${metadataType} lookup failed`, error);
					return {
						found: [] as Array<{
							item: SavedMetadataShoppingListItem;
							component: MetadataComponentSummary;
						}>,
						missing: [] as SavedMetadataShoppingListItem[],
						erroredType: { metadataType, reason, count: typeItems.length },
					};
				}
			}),
		);

		for (const result of results) {
			found.push(...result.found);
			missing.push(...result.missing);
			if (result.erroredType) {
				erroredTypes.push(result.erroredType);
			}
		}

		return { found, missing, erroredTypes };
	}

	async function runDeleteFromCart() {
		if (!activeOrg || !activeOrgStagedItems.length) {
			return;
		}

		if (cartAction === "deploy") {
			await runCrossOrgDeployFromCart();
			return;
		}
		if (cartAction !== "delete") {
			return;
		}

		if (preflightDeployableCount <= 0) {
			statusMessage = "No deployable components. Remove unsupported types and retry.";
			return;
		}

		if (runMode === "deploy" && isProductionLikeTarget && !deployTypedConfirmationMatches) {
			statusMessage = "Typed confirmation does not match required phrase.";
			return;
		}

		isRunningDeploy = true;
		cartStep = "result";
		lastDeployResult = undefined;
		deployProgressPercent = 0;
		deployProgressMessage = "Preparing deploy...";
		const modeLabel = runMode === "validate" ? "validation" : "deploy";
		statusMessage = `Starting destructive ${modeLabel}.`;

		try {
			const started = await backendClient.startDestructiveDeploy({
				target: { username: activeOrg.username },
				mode: runMode,
				components: activeOrgStagedItems.map(
					(item): HitListComponentInput => ({
						metadataType: item.metadataType,
						fullName: item.fullName,
					}),
				),
			});
			activeDeployOperationId = started.operationId;
			const status = await waitForDeployCompletion(started.operationId);
			lastDeployResult = status.result;
			if (status.result) {
				applyDeployResult(status.result);
			}
			statusMessage = status.message;
			deployProgressPercent = 100;
			deployProgressMessage = status.message;
		} catch (error) {
			statusMessage = toErrorMessage(error);
		} finally {
			activeDeployOperationId = undefined;
			isRunningDeploy = false;
		}
	}

	async function runCompareFromCart() {
		if (!sourceOrgUsername || !compareTargetUsername || cartAction !== "compare") {
			return;
		}

		isRunningCompare = true;
		cartStep = "result";
		compareResults = [];
		statusMessage = "Running cross-org metadata compare.";

		try {
			const response = await backendClient.getCrossOrgDiff({
				source: { username: sourceOrgUsername },
				target: { username: compareTargetUsername },
				components: activeOrgStagedItems.map((item) => ({
					metadataType: item.metadataType,
					fullName: item.fullName,
					fileName: item.component.fileName,
					folder: item.component.folder,
				})),
			});
			compareResults = response.results;
			statusMessage = `Compare complete: ${response.results.length} components evaluated.`;
		} catch (error) {
			statusMessage = toErrorMessage(error);
		} finally {
			isRunningCompare = false;
		}
	}

	async function runCrossOrgDeployFromCart() {
		if (!sourceOrgUsername || !compareTargetUsername || cartAction !== "deploy") {
			return;
		}
		if (preflightDeployableCount <= 0) {
			statusMessage = "No deployable components. Remove unsupported types and retry.";
			return;
		}
		if (runMode === "deploy" && isCrossTargetProductionLike && !deployTypedConfirmationMatches) {
			statusMessage = "Typed confirmation does not match required phrase.";
			return;
		}

		isRunningDeploy = true;
		cartStep = "result";
		lastDeployResult = undefined;
		deployProgressPercent = 0;
		deployProgressMessage = "Preparing deploy...";
		statusMessage = `Starting cross-org ${runMode === "validate" ? "validation" : "deploy"}.`;

		try {
			const started = await backendClient.startCrossOrgDeploy({
				source: { username: sourceOrgUsername },
				target: { username: compareTargetUsername },
				mode: runMode,
				components: activeOrgStagedItems.map(
					(item): HitListComponentInput => ({
						metadataType: item.metadataType,
						fullName: item.fullName,
					}),
				),
			});
			activeDeployOperationId = started.operationId;
			const status = await waitForDeployCompletion(started.operationId, true);
			lastDeployResult = status.result;
			statusMessage = status.message;
			deployProgressPercent = 100;
			deployProgressMessage = status.message;
		} catch (error) {
			statusMessage = toErrorMessage(error);
		} finally {
			activeDeployOperationId = undefined;
			isRunningDeploy = false;
		}
	}

	async function waitForDeployCompletion(operationId: string, isCrossOrg = false) {
		for (;;) {
			await new Promise((resolve) => setTimeout(resolve, DEPLOY_STATUS_POLL_INTERVAL_MS));
			const status = isCrossOrg
				? await backendClient.getCrossOrgDeployStatus({ operationId })
				: await backendClient.getDestructiveDeployStatus({ operationId });
			quirkyDeployMessageIndex += 1;

			const baseMessage =
				status.deployState &&
				status.componentsTotal !== undefined &&
				status.componentsProcessed !== undefined
					? `${status.deployState} ${status.percentComplete}% (${status.componentsProcessed}/${status.componentsTotal} components)`
					: status.message;

			if (status.status === "running" && quirkyDeployMessageIndex % 4 === 0) {
				const quirky = quirkyDeployMessages[quirkyDeployMessageIndex % quirkyDeployMessages.length];
				statusMessage = `${baseMessage} - ${quirky}`;
			} else {
				statusMessage = baseMessage;
			}
			deployProgressPercent = status.percentComplete;
			deployProgressMessage = baseMessage;

			if (
				status.status === "succeeded" ||
				status.status === "failed" ||
				status.status === "canceled"
			) {
				return status;
			}
		}
	}

	function applyDeployResult(result: DestructiveDeployResult) {
		if (!activeOrg) {
			return;
		}

		if (result.mode === "validate") {
			return;
		}

		if (result.success) {
			const skippedKeys = new Set(
				result.skipped.map((item) =>
					toStagedItemId(result.target.username, item.metadataType, item.fullName),
				),
			);
			stagedItems = stagedItems.filter((item) => {
				if (item.orgUsername !== activeOrg.username) {
					return true;
				}
				return skippedKeys.has(item.id);
			});
			return;
		}

		if (!result.failed.length) {
			return;
		}

		const failedKeys = new Set(
			result.failed.map((item) =>
				toStagedItemId(result.target.username, item.metadataType, item.fullName),
			),
		);
		stagedItems = stagedItems.filter((item) => {
			if (item.orgUsername !== activeOrg.username) {
				return true;
			}
			return failedKeys.has(item.id);
		});
	}

	function toErrorMessage(error: unknown) {
		return error instanceof Error ? error.message : "MavMeta could not reach the backend process.";
	}

	function toMetadataComponentListErrorMessage(error: unknown) {
		const message = toErrorMessage(error);

		if (message.includes("no handler") && message.includes("listMetadataComponents")) {
			return "The backend has not loaded component listing yet. Restart MavMeta so the new endpoint handlers are registered.";
		}

		return message;
	}

	function extractDeployJobId(
		result: DestructiveDeployResult | CrossOrgDeployResult,
	): string | undefined {
		const candidate =
			result.rawResult && typeof result.rawResult === "object"
				? (result.rawResult as Record<string, unknown>).id
				: undefined;
		if (typeof candidate !== "string") return undefined;
		const normalized = candidate.trim();
		return /^0Af[a-zA-Z0-9]{12,15}$/.test(normalized) ? normalized : undefined;
	}

	function isActionRunning(actionName: string) {
		return activeAction === actionName;
	}

	let isDarkTheme = $state(true);

	onMount(() => {
		const saved = localStorage.getItem("theme");
		if (saved === "light") isDarkTheme = false;
	});

	function toggleTheme() {
		isDarkTheme = !isDarkTheme;
		localStorage.setItem("theme", isDarkTheme ? "dark" : "light");
	}

	function openSettingsPlaceholder() {
		statusMessage = "Settings â€” coming soon.";
	}
</script>

<main class="app-shell" class:busy={isBusy} class:light-theme={!isDarkTheme}>
	<aside class="sidebar" aria-label="Primary">
		<div class="brand-icon tooltip-trigger" role="img" aria-label="MavMeta â€” Admin Workbench">
			<span class="brand-mark" aria-hidden="true"></span>
			<span class="nav-tooltip" role="tooltip" aria-hidden="true">MavMeta â€” Admin Workbench</span>
		</div>

		<nav class="nav-list" aria-label="Workbench tools">
			{#each toolNavItems as item (item.tool)}
				<button
					class="nav-item tooltip-trigger"
					class:active={selectedTool === item.tool}
					type="button"
					aria-label={item.ariaLabel}
					onclick={() => selectTool(item.tool)}
				>
					<item.icon size={20} strokeWidth={1.9} aria-hidden="true" />
					<span class="nav-tooltip" role="tooltip" aria-hidden="true">{item.tooltip}</span>
				</button>
			{/each}
		</nav>

		<div class="rail-utilities">
			<button
				class="nav-item utility-item tooltip-trigger"
				type="button"
				aria-label="Toggle color theme"
				onclick={toggleTheme}
			>
				{#if isDarkTheme}
					<Sun size={20} strokeWidth={1.9} aria-hidden="true" />
				{:else}
					<Moon size={20} strokeWidth={1.9} aria-hidden="true" />
				{/if}
				<span class="nav-tooltip" role="tooltip" aria-hidden="true">
					{isDarkTheme ? "Switch to light mode" : "Switch to dark mode"}
				</span>
			</button>
			<button
				class="nav-item utility-item tooltip-trigger is-disabled"
				type="button"
				aria-label="Settings (coming soon)"
				aria-disabled="true"
				onclick={openSettingsPlaceholder}
			>
				<Settings size={20} strokeWidth={1.9} aria-hidden="true" />
				<span class="nav-tooltip" role="tooltip" aria-hidden="true">Settings â€” coming soon</span>
			</button>
		</div>
	</aside>

	<section class="workspace">
		<header class="topbar">
			<div class="topbar-info">
				<div class="topbar-meta">
					<p class="eyebrow">MavMeta</p>
					<strong>Admin Workbench</strong>
				</div>
				<span class="topbar-divider" aria-hidden="true"></span>
				<div class="topbar-active-org">
					<p class="eyebrow">Active Org</p>
					<strong>{activeOrgLabel}</strong>
				</div>
			</div>
			<div class="topbar-actions">
				<label class="quick-switcher">
					Switch Org
					<select
						value={activeOrg?.username ?? ""}
						onchange={(event) => {
							const username = event.currentTarget.value;
							const org = orgs.find((candidate) => candidate.username === username);

							if (org) {
								void setActiveOrg(org);
							}
						}}
						disabled={!orgs.length || activeAction !== undefined}
					>
						<option value="" disabled>No active org</option>
						{#each orgs as org (org.username)}
							<option value={org.username}>
								{org.alias ?? org.username}
							</option>
						{/each}
					</select>
				</label>
				<button
					class="cart-entry-button"
					class:has-items={activeOrgStagedItems.length > 0}
					type="button"
					onclick={openMetadataCart}
				>
					<span class="cart-icon" aria-hidden="true">
						<svg viewBox="0 0 24 24" focusable="false">
							<path d="M5 5h2l1.2 9.2a2 2 0 0 0 2 1.8h6.7a2 2 0 0 0 1.9-1.4L21 8H8" />
							<circle cx="10" cy="20" r="1.4" />
							<circle cx="18" cy="20" r="1.4" />
						</svg>
					</span>
					<span class="cart-label">Metadata Cart</span>
					<span class="cart-count">{activeOrgStagedItems.length}</span>
				</button>
			</div>
		</header>

		<section class="content-grid" aria-label={`${selectedTool} workspace`}>
			{#if selectedTool === "Orgs"}
				<OrgDirectory
					{orgs}
					{activeOrg}
					{isLoadingOrgs}
					bind:authLoginUrl
					bind:authAlias
					isAuthorizing={isActionRunning("auth-org")}
					{activeAction}
					onRefreshOrgs={loadOrgs}
					onAuthOrg={authOrg}
					onOpenOrg={openOrg}
					onSetActiveOrg={setActiveOrg}
					onRefreshOrgStatus={refreshOrgStatus}
					onReauthOrg={reauthOrg}
					onStartAliasEdit={startAliasEdit}
					onStartScratchDelete={startScratchDelete}
					onLogoutOrg={logoutOrg}
					onStartCreateScratchOrg={startCreateScratchOrg}
				/>
			{:else if selectedTool === "Objects"}
				<ObjectExplorer
					{activeOrg}
					onIsChildStaged={isComponentStaged}
					onToggleStagedChild={toggleStagedItem}
					onToggleAllStagedChildren={toggleAllStagedItems}
				/>
			{:else if selectedTool === "REST"}
				<RestExplorer {activeOrg} apiVersion={metadataApiVersion} />
			{:else if selectedTool === "SOQL"}
				<SoqlExplorer {activeOrg} />
			{:else if selectedTool === "LWC"}
				<LwcPlayground {activeOrg} />
			{:else if selectedTool === "Metadata"}
				<MetadataExplorer
					{activeOrg}
					{isLoadingMetadataTypes}
					onLoadMetadataTypes={loadMetadataTypes}
					bind:metadataTypeFilter
					{metadataApiVersion}
					{metadataTypes}
					{visibleMetadataTypes}
					{selectedMetadataTypeXmlName}
					{metadataComponents}
					onListMetadataComponents={listMetadataComponents}
					{isLoadingMetadataComponents}
					onCancelMetadataListing={cancelMetadataListing}
					{selectedMetadataComponent}
					bind:isMetadataInspectorExpanded
					bind:metadataComponentSearch
					{metadataComponentErrors}
					{shouldGroupMetadataComponents}
					{metadataComponentGroups}
					onToggleMetadataGroup={toggleMetadataGroup}
					onIsComponentStaged={isComponentStaged}
					onToggleStagedItem={toggleStagedItem}
					onToggleAllStagedItems={toggleAllStagedItems}
					{selectedMetadataComponentFullName}
					onSelectMetadataComponent={selectMetadataComponent}
					{filteredMetadataComponents}
					{metadataComponentTargetType}
					{metadataTargetUsername}
					{isLoadingComponentSource}
					{componentSource}
					{componentSourceError}
					bind:isXmlSectionOpen
					onLoadComponentSource={loadComponentSource}
				/>
			{/if}
		</section>

		<StatusBar {isBusy} {statusMessage} />
	</section>

	{#if aliasEditorOrg}
		<AliasModal
			org={aliasEditorOrg}
			bind:aliasDraft
			isSaving={isActionRunning(`alias-${aliasEditorOrg.username}`)}
			onCancel={cancelAliasEdit}
			onSave={saveAlias}
		/>
	{/if}

	{#if scratchDeleteOrg}
		<ScratchDeleteModal
			org={scratchDeleteOrg}
			bind:confirmed={scratchDeleteConfirmed}
			isDeleting={isActionRunning(`delete-${scratchDeleteOrg.username}`)}
			onCancel={cancelScratchDelete}
			onConfirm={confirmScratchDelete}
		/>
	{/if}

	{#if isCreateScratchOrgModalOpen}
		<CreateScratchOrgModal
			{orgs}
			onClose={cancelCreateScratchOrg}
			onComplete={completeCreateScratchOrg}
			onSetActive={setCreatedScratchOrgActive}
		/>
	{/if}

	{#if isOrgSwitchAlertOpen}
		<div class="modal-backdrop">
			<div
				class="modal warning-modal"
				role="dialog"
				aria-modal="true"
				aria-label="Confirm org switch"
			>
				<div>
					<p class="eyebrow danger-text">Critical Alert</p>
					<h2>Switching active org will empty your cart</h2>
				</div>
				<p>
					Your cart contains <strong>{activeOrgStagedItems.length}</strong> items staged from
					<strong>{activeOrgLabel}</strong>. Switching to
					<strong>{pendingOrgToSwitch?.alias ?? pendingOrgToSwitch?.username}</strong>
					will clear these items.
				</p>
				<div class="modal-actions">
					<button class="btn btn--ghost" type="button" onclick={cancelOrgSwitch}>Cancel</button>
					<button class="btn btn--danger" type="button" onclick={confirmOrgSwitch}>
						Clear Cart & Switch
					</button>
				</div>
			</div>
		</div>
	{/if}

	<MetadataCartWizard
		isOpen={isCartOpen}
		{cartTitle}
		{cartSubtitle}
		{cartWorkflowSteps}
		{cartStep}
		{cartStepIndex}
		{cartAction}
		{activeOrgLabel}
		activeOrgInstanceUrl={activeOrg?.instanceUrl}
		activeOrgEnvironment={activeOrg?.environment}
		{activeOrgStagedItems}
		{stagedItemGroups}
		bind:saveListName
		{isListSaved}
		{isLoadingSavedList}
		savedShoppingLists={savedMetadataShoppingLists}
		skippedSavedListItems={lastSkippedSavedListItems}
		bind:runMode
		{preflightDeployableCount}
		isProductionLikeTarget={cartAction === "deploy"
			? isCrossTargetProductionLike
			: isProductionLikeTarget}
		{deployConfirmationPhrase}
		bind:deployTypedConfirmation
		{preflightSkippedComponents}
		{isRunningDeploy}
		{deployProgressPercent}
		{deployProgressMessage}
		{lastDeployResult}
		{canRunDeleteAction}
		{canDeployValidatedResult}
		{canDeployValidatedCrossOrgResult}
		{deployTypedConfirmationMatches}
		{sourceOrgLabel}
		{compareTargetOptions}
		{compareTargetUsername}
		{compareTargetLabel}
		{compareTargetInstanceUrl}
		compareTargetEnvironment={selectedCrossTargetOrg?.environment}
		{compareResults}
		{isRunningCompare}
		onSelectCompareTarget={(username) => (compareTargetUsername = username)}
		onClose={closeMetadataCart}
		onFinish={finishMetadataCartWorkflow}
		onSaveList={saveCurrentCartAsSavedList}
		onLoadSavedList={loadSavedShoppingList}
		onRenameSavedList={renameSavedShoppingList}
		onDeleteSavedList={deleteSavedShoppingList}
		onExportSavedList={exportSavedShoppingListPackageXml}
		onImportPackageXml={importSavedShoppingListPackageXml}
		onClearCart={clearActiveOrgCart}
		onRemoveStagedItem={removeStagedItem}
		onSelectCartAction={selectCartAction}
		onSetCartStep={setCartStep}
		onContinueFromActions={continueFromCartActions}
		onRunDelete={runDeleteFromCart}
		onRunCompare={runCompareFromCart}
		onDeployValidatedResult={deployValidatedResult}
		onDeployValidatedCrossOrgResult={deployValidatedCrossOrgResult}
		onOpenDeploymentStatusTargetOrg={openDeploymentStatusTargetOrg}
		onOpenSpecificDeploymentStatus={openSpecificDeploymentStatus}
		onCancelRunningDeploy={cancelRunningDeploy}
		{quirkyDeployMessage}
	/>
</main>
