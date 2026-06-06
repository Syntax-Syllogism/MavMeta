import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OrgSummary } from "../../shared/org";
import ObjectExplorer from "./ObjectExplorer.svelte";
import { objectChildrenCache, objectListCache } from "./object-explorer-cache";
import { backendClient } from "../backend/backend-client";

vi.mock("../backend/backend-client", () => ({
	backendClient: {
		listObjectsPage: vi.fn(),
		listObjectChildren: vi.fn(),
		getComponentSource: vi.fn(),
		listFieldAccess: vi.fn(),
	},
}));

const mockedBackendClient = vi.mocked(backendClient);

describe("ObjectExplorer row actions", () => {
	const activeOrg: OrgSummary = {
		alias: "dev",
		username: "dev@example.com",
		instanceUrl: "https://example.my.salesforce.com",
		environment: "sandbox",
		isDefault: true,
		authStatus: "connected",
	};

	beforeEach(() => {
		vi.clearAllMocks();
		objectListCache.clear();
		objectChildrenCache.clear();
		mockedBackendClient.listObjectsPage.mockResolvedValue({
			target: { username: activeOrg.username },
			objects: [{ apiName: "Account", label: "Account", objectType: "standard" }],
			nextCursor: undefined,
		});
		mockedBackendClient.listObjectChildren.mockResolvedValue({
			target: { username: activeOrg.username },
			objectApiName: "Account",
			children: {
				CustomField: [
					{
						fullName: "Account.Custom_Tier__c",
						childApiName: "Custom_Tier__c",
						parentObject: "Account",
						metadataType: "CustomField",
					},
					{
						fullName: "Account.Industry",
						childApiName: "Industry",
						parentObject: "Account",
						metadataType: "CustomField",
					},
				],
			},
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
	});

	it("renders a row menu for each field, allows staging standard fields, and opens access modal", async () => {
		render(ObjectExplorer, {
			activeOrg,
			onIsChildStaged: () => false,
			onToggleStagedChild: vi.fn(),
			onToggleAllStagedChildren: vi.fn(),
		});

		const accountRow = await screen.findByRole("button", { name: /^Account Account$/ });
		await fireEvent.click(accountRow);
		await screen.findByRole("button", { name: "Custom_Tier__c" });

		const actionMenus = document.querySelectorAll("details.action-menu");
		expect(actionMenus.length).toBe(2);

		const actionSummaries = document.querySelectorAll("details.action-menu summary");
		await fireEvent.click(actionSummaries[1] as HTMLElement);
		const standardRowMenu = actionSummaries[1]?.parentElement as HTMLDetailsElement;
		expect(standardRowMenu.open).toBe(true);

		await fireEvent.mouseDown(document.body);
		await waitFor(() => {
			expect(standardRowMenu.open).toBe(false);
		});

		await fireEvent.click(actionSummaries[1] as HTMLElement);

		const standardFieldActionSummary = screen.getByLabelText("Actions for Account.Industry");
		const standardFieldMenu = standardFieldActionSummary.closest("details.action-menu");
		const standardFieldStageButton = standardFieldMenu?.querySelector("button[title]");
		expect(standardFieldStageButton).toBeTruthy();
		expect(standardFieldStageButton?.getAttribute("title")).toBe(
			"Stage this field in the metadata cart",
		);
		expect(standardFieldStageButton?.hasAttribute("disabled")).toBe(false);

		await fireEvent.click(screen.getAllByRole("button", { name: "Who Has Access?" })[1]);
		await waitFor(() => {
			expect(screen.getByRole("dialog", { name: "Who Has Access: Account.Industry" })).toBeTruthy();
		});
		expect(mockedBackendClient.listFieldAccess).toHaveBeenCalledWith(
			{
				target: { username: activeOrg.username },
				sobjectType: "Account",
				fieldFullName: "Account.Industry",
			},
			expect.any(Object),
		);
	});

	it("loads another object page when the sentinel intersects", async () => {
		let intersectionCallback: IntersectionObserverCallback | undefined;
		const originalObserver = globalThis.IntersectionObserver;
		class FakeIntersectionObserver {
			readonly root = null;
			readonly rootMargin = "";
			readonly thresholds = [];

			constructor(callback: IntersectionObserverCallback) {
				intersectionCallback = callback;
			}

			observe = vi.fn();
			unobserve = vi.fn();
			disconnect = vi.fn();
			takeRecords = vi.fn(() => []);
		}
		globalThis.IntersectionObserver =
			FakeIntersectionObserver as unknown as typeof IntersectionObserver;
		mockedBackendClient.listObjectsPage
			.mockResolvedValueOnce({
				target: { username: activeOrg.username },
				objects: [{ apiName: "Account", label: "Account", objectType: "standard" }],
				nextCursor: "Account",
			})
			.mockResolvedValueOnce({
				target: { username: activeOrg.username },
				objects: [{ apiName: "Contact", label: "Contact", objectType: "standard" }],
				nextCursor: undefined,
			});

		try {
			render(ObjectExplorer, {
				activeOrg,
				onIsChildStaged: () => false,
				onToggleStagedChild: vi.fn(),
				onToggleAllStagedChildren: vi.fn(),
			});

			await screen.findByRole("button", { name: /^Account Account$/ });
			expect(intersectionCallback).toBeTruthy();
			intersectionCallback?.(
				[{ isIntersecting: true } as IntersectionObserverEntry],
				{} as IntersectionObserver,
			);

			await screen.findByRole("button", { name: /^Contact Contact$/ });
			expect(mockedBackendClient.listObjectsPage).toHaveBeenLastCalledWith({
				target: { username: activeOrg.username },
				cursor: "Account",
				search: undefined,
				limit: 200,
			});
		} finally {
			globalThis.IntersectionObserver = originalObserver;
		}
	});

	it("shows an empty loaded state instead of the waiting-for-org copy", async () => {
		mockedBackendClient.listObjectsPage.mockResolvedValueOnce({
			target: { username: activeOrg.username },
			objects: [],
			nextCursor: undefined,
		});

		render(ObjectExplorer, {
			activeOrg,
			onIsChildStaged: () => false,
			onToggleStagedChild: vi.fn(),
			onToggleAllStagedChildren: vi.fn(),
		});

		await screen.findByRole("heading", { name: "No objects found" });
		expect(screen.queryByText(/Objects will load automatically/i)).toBeNull();
	});

	it("debounces search and keeps cached result sets separate", async () => {
		vi.useFakeTimers();
		mockedBackendClient.listObjectsPage
			.mockResolvedValueOnce({
				target: { username: activeOrg.username },
				objects: [{ apiName: "Account", label: "Account", objectType: "standard" }],
				nextCursor: undefined,
			})
			.mockResolvedValueOnce({
				target: { username: activeOrg.username },
				objects: [{ apiName: "Invoice__c", label: "Invoice", objectType: "custom" }],
				nextCursor: undefined,
			});

		try {
			render(ObjectExplorer, {
				activeOrg,
				onIsChildStaged: () => false,
				onToggleStagedChild: vi.fn(),
				onToggleAllStagedChildren: vi.fn(),
			});

			await screen.findByRole("button", { name: /^Account Account$/ });
			await fireEvent.input(screen.getByLabelText("Filter Objects"), {
				target: { value: "invoice" },
			});
			await vi.advanceTimersByTimeAsync(250);

			await screen.findByRole("button", { name: /^Invoice Invoice__c$/ });
			expect(mockedBackendClient.listObjectsPage).toHaveBeenLastCalledWith({
				target: { username: activeOrg.username },
				cursor: undefined,
				search: "invoice",
				limit: 200,
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("starts a superseding search request while the initial object load is still pending", async () => {
		vi.useFakeTimers();
		mockedBackendClient.listObjectsPage
			.mockImplementationOnce(() => new Promise(() => {}))
			.mockResolvedValueOnce({
				target: { username: activeOrg.username },
				objects: [{ apiName: "Invoice__c", label: "Invoice", objectType: "custom" }],
				nextCursor: undefined,
			});

		try {
			render(ObjectExplorer, {
				activeOrg,
				onIsChildStaged: () => false,
				onToggleStagedChild: vi.fn(),
				onToggleAllStagedChildren: vi.fn(),
			});

			await screen.findByRole("heading", { name: "Loading objects" });
			const searchInput = screen.getByLabelText("Filter Objects");
			expect(searchInput.hasAttribute("disabled")).toBe(false);

			await fireEvent.input(searchInput, { target: { value: "invoice" } });
			await vi.advanceTimersByTimeAsync(250);

			await waitFor(() => {
				expect(mockedBackendClient.listObjectsPage).toHaveBeenCalledTimes(2);
			});
			await screen.findByRole("button", { name: /^Invoice Invoice__c$/ });
			expect(mockedBackendClient.listObjectsPage).toHaveBeenLastCalledWith({
				target: { username: activeOrg.username },
				cursor: undefined,
				search: "invoice",
				limit: 200,
			});
		} finally {
			vi.useRealTimers();
		}
	});
});
