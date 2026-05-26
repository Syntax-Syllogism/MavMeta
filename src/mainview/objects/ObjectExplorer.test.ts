import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OrgSummary } from "../../shared/org";
import ObjectExplorer from "./ObjectExplorer.svelte";
import { objectChildrenCache, objectListCache } from "./object-explorer-cache";
import { backendClient } from "../backend/backend-client";

vi.mock("../backend/backend-client", () => ({
	backendClient: {
		listObjects: vi.fn(),
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
		mockedBackendClient.listObjects.mockResolvedValue({
			target: { username: activeOrg.username },
			objects: [{ apiName: "Account", label: "Account", objectType: "standard" }],
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
});
