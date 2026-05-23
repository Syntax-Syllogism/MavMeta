import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import MetadataCartWizard from "./MetadataCartWizard.svelte";
import type { CartStep, StagedItem } from "./cart-view-model";
import type { CrossOrgDeployResult, DestructiveDeployResult } from "../../shared/deploy";

describe("MetadataCartWizard", () => {
	const stagedItems: StagedItem[] = [
		{
			id: "ApexClass:AccountController",
			orgUsername: "user@example.com",
			metadataType: "ApexClass",
			fullName: "AccountController",
			component: {
				fullName: "AccountController",
				type: "ApexClass",
			},
		},
	];

	const defaultProps = {
		isOpen: true,
		cartTitle: "Metadata Cart",
		cartSubtitle: "Manage your staged metadata",
		cartWorkflowSteps: [
			{ step: "list" as CartStep, label: "Staged Items" },
			{ step: "actions" as CartStep, label: "Select Action" },
			{ step: "confirm" as CartStep, label: "Confirm" },
			{ step: "result" as CartStep, label: "Result" },
		],
		cartStep: "list" as CartStep,
		cartStepIndex: 0,
		cartAction: undefined,
		activeOrgLabel: "my-org",
		activeOrgStagedItems: stagedItems,
		stagedItemGroups: [
			{
				metadataType: "ApexClass",
				items: stagedItems,
			},
		],
		saveListName: "",
		isListSaved: false,
		isLoadingSavedList: false,
		savedShoppingLists: [],
		skippedSavedListItems: [],
		runMode: "validate" as const,
		preflightDeployableCount: 1,
		isProductionLikeTarget: true,
		deployConfirmationPhrase: "confirmed for my-org",
		deployTypedConfirmation: "",
		preflightSkippedComponents: [],
		isRunningDeploy: false,
		deployProgressPercent: 0,
		deployProgressMessage: "",
		lastDeployResult: undefined as DestructiveDeployResult | CrossOrgDeployResult | undefined,
		canRunDeleteAction: true,
		canDeployValidatedResult: false,
		canDeployValidatedCrossOrgResult: false,
		deployTypedConfirmationMatches: false,
		sourceOrgLabel: "source-org",
		compareTargetOptions: [
			{
				username: "target@example.com",
				environment: "sandbox" as const,
				isDefault: false,
				authStatus: "connected" as const,
			},
		],
		compareTargetUsername: "target@example.com",
		compareTargetLabel: "target@example.com",
		compareResults: [],
		isRunningCompare: false,
		onSelectCompareTarget: vi.fn(),
		onClose: vi.fn(),
		onFinish: vi.fn(),
		onSaveList: vi.fn(),
		onLoadSavedList: vi.fn(),
		onRenameSavedList: vi.fn(),
		onDeleteSavedList: vi.fn(),
		onExportSavedList: vi.fn(),
		onImportPackageXml: vi.fn(),
		onClearCart: vi.fn(),
		onRemoveStagedItem: vi.fn(),
		onSelectCartAction: vi.fn(),
		onSetCartStep: vi.fn(),
		onContinueFromActions: vi.fn(),
		onRunDelete: vi.fn(),
		onRunCompare: vi.fn(),
		onDeployValidatedResult: vi.fn(),
		onDeployValidatedCrossOrgResult: vi.fn(),
		onOpenDeploymentStatusTargetOrg: vi.fn(),
		onOpenSpecificDeploymentStatus: vi.fn(),
		onCancelRunningDeploy: vi.fn(),
		quirkyDeployMessage: "calibrating meltdown vectors",
	};

	it("renders staged items and allows removal", async () => {
		const onRemoveStagedItem = vi.fn();
		render(MetadataCartWizard, {
			...defaultProps,
			onRemoveStagedItem,
		});

		expect(screen.getByText("AccountController")).toBeTruthy();
		const removeButton = screen.getByRole("button", { name: "Remove" });
		await fireEvent.click(removeButton);

		expect(onRemoveStagedItem).toHaveBeenCalledWith("ApexClass:AccountController");
	});

	it("shows empty state when no items are staged", () => {
		render(MetadataCartWizard, {
			...defaultProps,
			activeOrgStagedItems: [],
			stagedItemGroups: [],
		});

		expect(
			screen.getByText("No staged metadata. Stage components from Metadata Explorer first."),
		).toBeTruthy();
	});

	it("renders saved lists and supports saved-list actions", async () => {
		const onLoadSavedList = vi.fn();
		const onRenameSavedList = vi.fn();
		const onDeleteSavedList = vi.fn();
		const onExportSavedList = vi.fn();
		render(MetadataCartWizard, {
			...defaultProps,
			savedShoppingLists: [
				{
					id: "list-1",
					name: "Core smoke deploy",
					items: [{ metadataType: "ApexClass", fullName: "AccountController" }],
					createdAt: "2026-05-19T00:00:00.000Z",
					updatedAt: "2026-05-19T00:00:00.000Z",
				},
			],
			onLoadSavedList,
			onRenameSavedList,
			onDeleteSavedList,
			onExportSavedList,
		});

		await fireEvent.click(screen.getByRole("button", { name: "Load into cart" }));
		expect(onLoadSavedList).toHaveBeenCalledWith("list-1");
		await fireEvent.click(screen.getByRole("button", { name: "Rename" }));
		expect(onRenameSavedList).toHaveBeenCalledWith("list-1");
		await fireEvent.click(screen.getByRole("button", { name: "Export package.xml" }));
		expect(onExportSavedList).toHaveBeenCalledWith("list-1");
		await fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		expect(onDeleteSavedList).toHaveBeenCalledWith("list-1");
	});

	it("navigates cart wizard steps forward and backward", async () => {
		const onSetCartStep = vi.fn();
		render(MetadataCartWizard, {
			...defaultProps,
			onSetCartStep,
		});

		await fireEvent.click(screen.getByRole("button", { name: "Next" }));
		expect(onSetCartStep).toHaveBeenCalledWith("actions");
	});

	it("requires typed confirmation for production deploy mode", async () => {
		const { rerender } = render(MetadataCartWizard, {
			...defaultProps,
			cartStep: "confirm",
			cartStepIndex: 2,
			runMode: "deploy",
			isProductionLikeTarget: true,
			deployTypedConfirmationMatches: false,
		});

		const runButton = screen.getByRole("button", { name: "Run Delete" });
		expect(runButton).toHaveProperty("disabled", true);

		// In unit test, we simulate the parent updating the match prop
		await rerender({ deployTypedConfirmationMatches: true });
		expect(runButton).toHaveProperty("disabled", false);
	});

	it("shows progress during running deploy", () => {
		render(MetadataCartWizard, {
			...defaultProps,
			cartStep: "result",
			cartStepIndex: 3,
			isRunningDeploy: true,
			deployProgressPercent: 45,
			deployProgressMessage: "Processing 4/10",
		});

		expect(screen.getByText("45%")).toBeTruthy();
		expect(screen.getByText("Processing 4/10")).toBeTruthy();
	});

	it("shows success result and allows finishing", async () => {
		const onFinish = vi.fn();
		const lastDeployResult: DestructiveDeployResult = {
			target: { username: "user@example.com" },
			mode: "validate",
			environment: "production",
			success: true,
			state: "Succeeded",
			message: "Validation completed successfully.",
			skipped: [],
			failed: [],
			rawResult: { status: "Succeeded" },
		};

		render(MetadataCartWizard, {
			...defaultProps,
			cartStep: "result",
			cartStepIndex: 3,
			lastDeployResult,
			onFinish,
		});

		expect(screen.getByRole("heading", { name: "Success", level: 3 })).toBeTruthy();
		expect(screen.getByText("Validation completed successfully.")).toBeTruthy();

		await fireEvent.click(screen.getByRole("button", { name: "Finish & Close" }));
		expect(onFinish).toHaveBeenCalled();
	});

	it("offers deploy from a successful validation result", async () => {
		const onDeployValidatedResult = vi.fn();
		const lastDeployResult: DestructiveDeployResult = {
			target: { username: "user@example.com" },
			mode: "validate",
			environment: "production",
			success: true,
			state: "Succeeded",
			message: "Validation completed successfully.",
			skipped: [],
			failed: [],
			rawResult: { status: "Succeeded" },
		};

		render(MetadataCartWizard, {
			...defaultProps,
			cartStep: "result",
			cartStepIndex: 3,
			lastDeployResult,
			canDeployValidatedResult: true,
			onDeployValidatedResult,
		});

		const deployButton = screen.getByRole("button", { name: "Deploy" });
		await fireEvent.click(deployButton);
		expect(onDeployValidatedResult).toHaveBeenCalled();
	});

	it("cancels a running deploy when Escape is pressed", async () => {
		const onCancelRunningDeploy = vi.fn();
		render(MetadataCartWizard, {
			...defaultProps,
			cartStep: "result",
			cartStepIndex: 3,
			isRunningDeploy: true,
			onCancelRunningDeploy,
		});

		await fireEvent.keyDown(window, { key: "Escape" });
		expect(onCancelRunningDeploy).toHaveBeenCalled();
	});

	it("enables compare action from actions step", async () => {
		const onSelectCartAction = vi.fn();
		render(MetadataCartWizard, {
			...defaultProps,
			cartStep: "actions",
			cartStepIndex: 1,
			onSelectCartAction,
		});

		await fireEvent.click(screen.getByRole("button", { name: /Compare with org/i }));
		expect(onSelectCartAction).toHaveBeenCalledWith("compare");
	});

	it("runs compare from compare confirmation step", async () => {
		const onRunCompare = vi.fn();
		render(MetadataCartWizard, {
			...defaultProps,
			cartStep: "confirm",
			cartStepIndex: 2,
			cartAction: "compare",
			onRunCompare,
		});
		await fireEvent.click(screen.getByRole("button", { name: "Run Compare" }));
		expect(onRunCompare).toHaveBeenCalled();
	});

	it("renders cross-org deploy confirmation copy for deploy action", () => {
		render(MetadataCartWizard, {
			...defaultProps,
			cartStep: "confirm",
			cartStepIndex: 2,
			cartAction: "deploy",
			runMode: "deploy",
		});

		expect(screen.getByText("Cross-org deploy summary")).toBeTruthy();
		expect(screen.queryByText("Final destructive summary")).toBeNull();
		expect(screen.getByRole("button", { name: "Run Deploy" })).toBeTruthy();
	});

	it("requires typed confirmation for production-like cross-org deploy mode", async () => {
		const { rerender } = render(MetadataCartWizard, {
			...defaultProps,
			cartStep: "confirm",
			cartStepIndex: 2,
			cartAction: "deploy",
			runMode: "deploy",
			isProductionLikeTarget: true,
			deployTypedConfirmationMatches: false,
		});

		const runButton = screen.getByRole("button", { name: "Run Deploy" });
		expect(runButton).toHaveProperty("disabled", true);

		await rerender({ deployTypedConfirmationMatches: true });
		expect(runButton).toHaveProperty("disabled", false);
	});

	it("renders compare results grouped by metadata type", () => {
		render(MetadataCartWizard, {
			...defaultProps,
			cartStep: "result",
			cartStepIndex: 3,
			cartAction: "compare",
			compareResults: [
				{ metadataType: "ApexClass", fullName: "Zeta", state: "Changed" },
				{ metadataType: "ApexClass", fullName: "Alpha", state: "Same" },
				{ metadataType: "CustomObject", fullName: "MyObject", state: "MissingInTarget" },
			],
		});

		expect(screen.getByText("ApexClass")).toBeTruthy();
		expect(screen.getByText("CustomObject")).toBeTruthy();
		expect(screen.getByText("Alpha")).toBeTruthy();
		expect(screen.getByText("Zeta")).toBeTruthy();
		expect(screen.getByText("MyObject")).toBeTruthy();
	});

	it("shows cross-org source/target and raw diagnostics in deploy result", () => {
		const lastDeployResult: CrossOrgDeployResult = {
			source: { username: "source@example.com" },
			target: { username: "target@example.com" },
			mode: "deploy",
			environment: "sandbox",
			success: true,
			state: "Succeeded",
			message: "Deploy completed.",
			skipped: [],
			failed: [],
			rawResult: { status: "Succeeded", id: "0Afxx0000009" },
		};

		render(MetadataCartWizard, {
			...defaultProps,
			cartStep: "result",
			cartStepIndex: 3,
			cartAction: "deploy",
			lastDeployResult,
			sourceOrgLabel: "source-alias",
			compareTargetLabel: "target-alias",
		});

		expect(screen.getByText("source-alias")).toBeTruthy();
		expect(screen.getAllByText("target-alias").length).toBeGreaterThan(0);
		expect(screen.getByText("View raw diagnostics")).toBeTruthy();
	});

	it("offers deploy from a successful cross-org validation result", async () => {
		const onDeployValidatedCrossOrgResult = vi.fn();
		const lastDeployResult: CrossOrgDeployResult = {
			source: { username: "source@example.com" },
			target: { username: "target@example.com" },
			mode: "validate",
			environment: "sandbox",
			success: true,
			state: "Succeeded",
			message: "Validation completed successfully.",
			skipped: [],
			failed: [],
			rawResult: { status: "Succeeded" },
		};

		render(MetadataCartWizard, {
			...defaultProps,
			cartStep: "result",
			cartStepIndex: 3,
			cartAction: "deploy",
			lastDeployResult,
			canDeployValidatedCrossOrgResult: true,
			onDeployValidatedCrossOrgResult,
		});

		const deployButton = screen.getByRole("button", { name: "Deploy" });
		await fireEvent.click(deployButton);
		expect(onDeployValidatedCrossOrgResult).toHaveBeenCalled();
	});

	it("opens deployment status from deploy result", async () => {
		const onOpenDeploymentStatusTargetOrg = vi.fn();
		const onOpenSpecificDeploymentStatus = vi.fn();
		const lastDeployResult: DestructiveDeployResult = {
			target: { username: "user@example.com" },
			mode: "deploy",
			environment: "production",
			success: true,
			state: "Succeeded",
			message: "Deploy completed successfully.",
			skipped: [],
			failed: [],
			rawResult: { status: "Succeeded", id: "0Af000000000001AAA" },
		};

		render(MetadataCartWizard, {
			...defaultProps,
			cartStep: "result",
			cartStepIndex: 3,
			lastDeployResult,
			onOpenDeploymentStatusTargetOrg,
			onOpenSpecificDeploymentStatus,
		});

		await fireEvent.click(screen.getByRole("button", { name: "Open Deployment Status" }));
		expect(onOpenDeploymentStatusTargetOrg).toHaveBeenCalled();
		await fireEvent.click(screen.getByRole("button", { name: "Open This Deployment" }));
		expect(onOpenSpecificDeploymentStatus).toHaveBeenCalled();
	});

	it("shows deployment status link while deploy is running", () => {
		render(MetadataCartWizard, {
			...defaultProps,
			cartStep: "result",
			cartStepIndex: 3,
			isRunningDeploy: true,
			cartAction: "deploy",
		});

		expect(screen.getByRole("button", { name: "Open Deployment Status" })).toBeTruthy();
	});

	it("shows compare state summary and allows retry from result step", async () => {
		const onRunCompare = vi.fn();
		render(MetadataCartWizard, {
			...defaultProps,
			cartStep: "result",
			cartStepIndex: 3,
			cartAction: "compare",
			onRunCompare,
			compareResults: [
				{ metadataType: "ApexClass", fullName: "A", state: "Changed" },
				{ metadataType: "ApexClass", fullName: "B", state: "Changed" },
				{ metadataType: "CustomObject", fullName: "Obj", state: "MissingInTarget" },
			],
		});

		expect(screen.getAllByText("Changed").length).toBeGreaterThan(0);
		expect(screen.getAllByText("MissingInTarget").length).toBeGreaterThan(0);

		await fireEvent.click(screen.getByRole("button", { name: "Retry Compare" }));
		expect(onRunCompare).toHaveBeenCalled();
	});

	it("renders source and target XML details for compare results", async () => {
		render(MetadataCartWizard, {
			...defaultProps,
			cartStep: "result",
			cartStepIndex: 3,
			cartAction: "compare",
			compareResults: [
				{
					metadataType: "LightningComponentBundle",
					fullName: "c:myBundle",
					fileName: "myBundle.js",
					state: "Changed",
					sourceXml: "<source>const a = 1;</source>",
					targetXml: "<target>const a = 2;</target>",
				},
				{
					metadataType: "LightningComponentBundle",
					fullName: "c:myBundle",
					fileName: "myBundle.html",
					state: "Changed",
					sourceXml: "<source><template>one</template></source>",
					targetXml: "<target><template>two</template></target>",
				},
			],
		});

		expect(screen.getByText("myBundle.js")).toBeTruthy();
		expect(screen.getByText("myBundle.html")).toBeTruthy();

		// "View diff" buttons open the diff modal
		const viewDiffButtons = screen.getAllByRole("button", { name: "View diff" });
		expect(viewDiffButtons.length).toBe(2);

		// Open the first diff modal (myBundle.js)
		await fireEvent.click(viewDiffButtons[0]!);
		const diffModal = screen.getByRole("dialog", { name: "XML diff viewer" });
		expect(diffModal).toBeTruthy();
		// diff content rendered via DiffViewerModal
		expect(screen.getByText("<source>const a = 1;</source>")).toBeTruthy();
		expect(screen.getByText("<target>const a = 2;</target>")).toBeTruthy();
		// changed lines get diff-cell-remove / diff-cell-add classes
		expect(document.querySelector(".diff-cell-remove")).toBeTruthy();
		expect(document.querySelector(".diff-cell-add")).toBeTruthy();

		// Closing the modal removes it
		await fireEvent.click(screen.getByRole("button", { name: "Close diff viewer" }));
		expect(screen.queryByRole("dialog", { name: "XML diff viewer" })).toBeNull();
	});

	it("clears open diff modal when wizard closes and does not remount it on reopen", async () => {
		const compareResults = [
			{
				metadataType: "ApexClass",
				fullName: "MyClass",
				state: "Changed" as const,
				sourceXml: "<source/>",
				targetXml: "<target/>",
			},
		];
		const { rerender } = render(MetadataCartWizard, {
			...defaultProps,
			cartStep: "result",
			cartStepIndex: 3,
			cartAction: "compare",
			compareResults,
		});

		// Open the diff modal
		await fireEvent.click(screen.getByRole("button", { name: "View diff" }));
		expect(screen.getByRole("dialog", { name: "XML diff viewer" })).toBeTruthy();

		// Close the wizard (isOpen → false)
		await rerender({ isOpen: false });
		expect(screen.queryByRole("dialog", { name: "XML diff viewer" })).toBeNull();

		// Reopen the wizard without explicitly re-opening the diff modal
		await rerender({ isOpen: true });
		expect(screen.queryByRole("dialog", { name: "XML diff viewer" })).toBeNull();
	});
});
