import { fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App.svelte";
import { backendClient } from "./backend/backend-client";
import type { OrgListResponse, OrgSummary } from "../shared/org";

const connectedOrg: OrgSummary = {
	alias: "my-org",
	username: "user@example.com",
	orgId: "00D123456789012345",
	instanceUrl: "https://instance-url.com",
	loginUrl: "https://login-url.com",
	environment: "production",
	isDefault: true,
	authStatus: "connected",
};

const sandboxOrg: OrgSummary = {
	alias: "sandbox-org",
	username: "sandbox@example.com",
	orgId: "00D123456789012346",
	instanceUrl: "https://sandbox-instance-url.com",
	loginUrl: "https://sandbox-login-url.com",
	environment: "sandbox",
	isDefault: false,
	authStatus: "expired",
};

const defaultOrgList: OrgListResponse = {
	orgs: [connectedOrg, sandboxOrg],
	activeOrg: connectedOrg,
};

vi.mock("./backend/backend-client", () => ({
	backendClient: {
		announceReady: vi.fn(),
		listOrgs: vi.fn(),
		openOrg: vi.fn(),
		setActiveOrg: vi.fn(),
		refreshOrgStatus: vi.fn(),
		deleteScratchOrg: vi.fn(),
		logoutOrg: vi.fn(),
		setAlias: vi.fn(),
		authOrg: vi.fn(),
		reauthOrg: vi.fn(),
		listMetadataTypes: vi.fn(),
		listMetadataComponents: vi.fn(),
		getComponentSource: vi.fn(),
		startDestructiveDeploy: vi.fn(),
		getDestructiveDeployStatus: vi.fn(),
		cancelDestructiveDeploy: vi.fn(),
		executeRestRequest: vi.fn(),
		soqlDescribeGlobal: vi.fn(),
		soqlDescribeObject: vi.fn(),
		soqlValidate: vi.fn(),
		soqlRun: vi.fn(),
		listObjects: vi.fn(),
		listObjectChildren: vi.fn(),
		listFieldAccess: vi.fn(),
		listLwcBundles: vi.fn(),
		getLwcBundle: vi.fn(),
		deployLwcBundle: vi.fn(),
	},
}));

const mockedBackendClient = vi.mocked(backendClient);

describe("App Smoke Tests", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
		window.localStorage.clear();
		mockedBackendClient.announceReady.mockResolvedValue(undefined);
		mockedBackendClient.listOrgs.mockResolvedValue(defaultOrgList);
		mockedBackendClient.openOrg.mockResolvedValue({
			message: "Org opened successfully",
		});
		mockedBackendClient.setActiveOrg.mockResolvedValue({
			message: "Active org set successfully",
		});
		mockedBackendClient.listMetadataTypes.mockResolvedValue({
			target: { username: connectedOrg.username },
			types: [
				{
					xmlName: "ApexClass",
					label: "Apex Class",
					directoryName: "classes",
					childXmlNames: [],
					inFolder: false,
					metaFile: false,
				},
			],
			apiVersion: "58.0",
		});
		mockedBackendClient.listMetadataComponents.mockResolvedValue({
			target: { username: connectedOrg.username },
			metadataType: "ApexClass",
			components: [
				{
					fullName: "AccountController",
					type: "ApexClass",
					fileName: "classes/AccountController.cls",
					lastModifiedByName: "Ada Admin",
					lastModifiedDate: "2026-05-01T00:00:00.000Z",
					raw: { fullName: "AccountController" },
				},
			],
			apiVersion: "58.0",
			errors: [],
		});
		mockedBackendClient.startDestructiveDeploy.mockResolvedValue({
			operationId: "op-1",
		});
		mockedBackendClient.listObjects.mockResolvedValue({
			target: { username: connectedOrg.username },
			objects: [],
		});
		mockedBackendClient.listObjectChildren.mockResolvedValue({
			target: { username: connectedOrg.username },
			objectApiName: "Account",
			children: {},
			errors: [],
		});
		mockedBackendClient.listFieldAccess.mockResolvedValue({
			rows: [],
			stats: {
				totalActiveUsersWithAccess: 0,
				profileGrants: 0,
				permissionSetGrants: 0,
				permissionSetGroupGrants: 0,
				mutedUsers: 0,
			},
			warnings: [],
		});
		mockedBackendClient.listLwcBundles.mockResolvedValue({
			bundles: [],
		});
		mockedBackendClient.soqlDescribeGlobal.mockResolvedValue({ sobjects: [] });
		mockedBackendClient.soqlDescribeObject.mockResolvedValue({ sobject: "Account", fields: [] });
		mockedBackendClient.soqlValidate.mockResolvedValue({ valid: true });
		mockedBackendClient.soqlRun.mockResolvedValue({ records: [], totalSize: 0, done: true });
		mockedBackendClient.getDestructiveDeployStatus.mockResolvedValue({
			operationId: "op-1",
			status: "succeeded",
			percentComplete: 100,
			message: "Succeeded",
			deployState: "Succeeded",
			componentsProcessed: 1,
			componentsTotal: 1,
			result: {
				target: { username: connectedOrg.username },
				mode: "validate",
				environment: "production",
				success: true,
				state: "Succeeded",
				message: "Validation completed successfully.",
				skipped: [],
				failed: [],
				rawResult: { status: "Succeeded" },
			},
		});
	});

	it("renders org list and allows opening an org", async () => {
		render(App);
		const orgLink = await screen.findByRole("button", { name: "my-org" });
		await fireEvent.click(orgLink);
		expect(mockedBackendClient.openOrg).toHaveBeenCalledWith({
			username: "user@example.com",
		});
	});

	it("shows busy state while backend actions are pending", async () => {
		let resolveOpenOrg: (value: { message: string }) => void = () => {};
		mockedBackendClient.openOrg.mockReturnValue(
			new Promise((resolve) => {
				resolveOpenOrg = resolve;
			}),
		);

		const { container } = render(App);
		await screen.findByRole("button", { name: "my-org" });
		await fireEvent.click(screen.getAllByText("Open Org")[0]);

		expect(container.firstElementChild?.classList.contains("busy")).toBe(true);
		expect(screen.getByRole("progressbar")).toBeTruthy();

		resolveOpenOrg({ message: "Org opened successfully" });
		await waitFor(() => {
			expect(container.firstElementChild?.classList.contains("busy")).toBe(false);
		});
	});

	it("navigates from metadata discovery to destructive validation", async () => {
		vi.useFakeTimers();
		try {
			render(App);

			// 1. Load Metadata Types
			await screen.findByRole("button", { name: "my-org" });
			await fireEvent.click(screen.getByRole("button", { name: "Metadata Explorer" }));

			const apexClassRow = await screen.findByRole("button", { name: /Apex Class/i });
			await fireEvent.click(apexClassRow);

			// 2. List and Stage Component
			const stageButton = await screen.findByRole("button", { name: "Stage" });
			await fireEvent.click(stageButton);

			// 3. Open Cart and Navigate Wizard
			await fireEvent.click(screen.getByRole("button", { name: /Metadata Cart/ }));
			await screen.findByRole("dialog", { name: "Metadata cart workflow" });

			await fireEvent.click(screen.getByRole("button", { name: "Next" })); // To Actions
			await fireEvent.click(screen.getByRole("button", { name: /Delete from org/ }));
			await fireEvent.click(screen.getByRole("button", { name: "Next" })); // To Confirm

			// 4. Run Validation
			await fireEvent.click(screen.getByRole("button", { name: "Run Validate" }));
			await vi.advanceTimersByTimeAsync(3200);

			await waitFor(() => {
				expect(mockedBackendClient.startDestructiveDeploy).toHaveBeenCalledWith({
					target: { username: connectedOrg.username },
					mode: "validate",
					components: [{ metadataType: "ApexClass", fullName: "AccountController" }],
				});
			});

			await screen.findByRole("heading", { name: "Success" });
		} finally {
			vi.useRealTimers();
		}
	}, 15000);

	it("prompts before clearing cart on org switch", async () => {
		render(App);

		// Stage something first
		await screen.findByRole("button", { name: "my-org" });
		await fireEvent.click(screen.getByRole("button", { name: "Metadata Explorer" }));
		await fireEvent.click(await screen.findByRole("button", { name: /Apex Class/i }));
		await fireEvent.click(await screen.findByRole("button", { name: "Stage" }));

		// Switch Org
		const switcher = screen.getByLabelText("Switch Org");
		await fireEvent.change(switcher, { target: { value: "sandbox@example.com" } });

		const alert = await screen.findByRole("dialog", { name: "Confirm org switch" });
		expect(within(alert).getByText(/Switching active org will empty your cart/)).toBeTruthy();

		await fireEvent.click(within(alert).getByRole("button", { name: "Clear Cart & Switch" }));
		await waitFor(() => {
			expect(mockedBackendClient.setActiveOrg).toHaveBeenCalledWith({
				username: "sandbox@example.com",
			});
		});
	});

	it("renders icon rail navigation with accessible labels", async () => {
		render(App);

		await screen.findByRole("img", {
			name: (name) => name.includes("MavMeta") && name.includes("Admin Workbench"),
		});
		expect(screen.getByRole("button", { name: "Environment Explorer" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Metadata Explorer" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Object Explorer" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "LWC Editor" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "REST Explorer" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "SOQL Explorer" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Toggle color theme" })).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Settings (coming soon)" }).getAttribute("aria-disabled"),
		).toBe("true");
		expect(screen.getByText("Admin Workbench")).toBeTruthy();
	});

	it("toggles theme class from the rail toggle button", async () => {
		const { container } = render(App);
		await screen.findByRole("button", { name: "Toggle color theme" });
		expect(container.firstElementChild?.classList.contains("light-theme")).toBe(false);

		await fireEvent.click(screen.getByRole("button", { name: "Toggle color theme" }));
		expect(container.firstElementChild?.classList.contains("light-theme")).toBe(true);
	});

	it("clears skipped saved-list summary when clearing cart", async () => {
		window.localStorage.setItem(
			"rogueforce.savedMetadataShoppingLists.v1",
			JSON.stringify({
				version: 1,
				lists: [
					{
						id: "saved-1",
						name: "Missing-only list",
						createdAt: "2026-05-19T00:00:00.000Z",
						updatedAt: "2026-05-19T00:00:00.000Z",
						items: [{ metadataType: "ApexClass", fullName: "MissingClass" }],
					},
				],
			}),
		);

		render(App);
		await screen.findByRole("button", { name: "my-org" });
		await fireEvent.click(screen.getByRole("button", { name: /Metadata Cart/ }));
		await screen.findByRole("dialog", { name: "Metadata cart workflow" });
		await fireEvent.click(screen.getByRole("button", { name: "Load into cart" }));

		await screen.findByText("View 1 skipped components");
		await fireEvent.click(screen.getByRole("button", { name: "Clear All" }));
		await waitFor(() => {
			expect(screen.queryByText("View 1 skipped components")).toBeNull();
		});
	});

	it("reuses cached metadata types when revisiting metadata tool", async () => {
		render(App);
		await screen.findByRole("button", { name: "my-org" });

		await fireEvent.click(screen.getByRole("button", { name: "Metadata Explorer" }));
		await screen.findByText("Apex Class");
		await fireEvent.click(screen.getByRole("button", { name: "Environment Explorer" }));
		await fireEvent.click(screen.getByRole("button", { name: "Metadata Explorer" }));
		await screen.findByText("Apex Class");

		expect(mockedBackendClient.listMetadataTypes).toHaveBeenCalledTimes(1);
	});

	it("reuses cached object list when revisiting object tool", async () => {
		render(App);
		await screen.findByRole("button", { name: "my-org" });

		await fireEvent.click(screen.getByRole("button", { name: "Object Explorer" }));
		await screen.findByText(/No objects loaded/i);
		await fireEvent.click(screen.getByRole("button", { name: "Environment Explorer" }));
		await fireEvent.click(screen.getByRole("button", { name: "Object Explorer" }));
		await screen.findByText(/No objects loaded/i);

		expect(mockedBackendClient.listObjects).toHaveBeenCalledTimes(1);
	});

	it("reuses cached lwc bundle list when revisiting lwc tool", async () => {
		render(App);
		await screen.findByRole("button", { name: "my-org" });

		await fireEvent.click(screen.getByRole("button", { name: "LWC Editor" }));
		await screen.findByText(/no lwc bundles found/i);
		await fireEvent.click(screen.getByRole("button", { name: "Environment Explorer" }));
		await fireEvent.click(screen.getByRole("button", { name: "LWC Editor" }));
		await screen.findByText(/no lwc bundles found/i);

		expect(mockedBackendClient.listLwcBundles).toHaveBeenCalledTimes(1);
	});
});
