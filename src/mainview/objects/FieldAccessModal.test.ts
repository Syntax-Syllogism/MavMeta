import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FieldAccessResponse } from "../../shared/field-access";
import type { OrgSummary } from "../../shared/org";
import FieldAccessModal from "./FieldAccessModal.svelte";
import { backendClient } from "../backend/backend-client";

vi.mock("../backend/backend-client", () => ({
	backendClient: {
		listFieldAccess: vi.fn(),
	},
}));

const mockedBackendClient = vi.mocked(backendClient);

const defaultResponse: FieldAccessResponse = {
	rows: [
		{
			userId: "005A",
			userName: "Ada Admin",
			username: "ada@example.com",
			isActive: true,
			accessLevel: "Read",
			assignmentType: "PermissionSet",
			sourceId: "0PS1",
			sourceName: "Finance Read",
		},
		{
			userId: "005B",
			userName: "Bob Builder",
			username: "bob@example.com",
			isActive: true,
			accessLevel: "None (Muted)",
			assignmentType: "PermissionSetGroup",
			sourceId: "0PG1",
			sourceName: "Finance Group",
			viaPermissionSetId: "0PS2",
			viaPermissionSetName: "Finance Edit",
			mutedBySourceId: "0PSM",
			mutedBySourceName: "Finance Muting",
		},
	],
	stats: {
		totalActiveUsersWithAccess: 1,
		profileGrants: 0,
		permissionSetGrants: 1,
		permissionSetGroupGrants: 1,
		mutedUsers: 1,
	},
	warnings: [],
};

describe("FieldAccessModal", () => {
	const activeOrg: OrgSummary = {
		alias: "dev",
		username: "dev@example.com",
		instanceUrl: "https://example.my.salesforce.com",
		environment: "sandbox",
		isDefault: true,
		authStatus: "connected",
	};

	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		mockedBackendClient.listFieldAccess.mockResolvedValue(defaultResponse);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("shows loading state while field access is still resolving", async () => {
		mockedBackendClient.listFieldAccess.mockImplementation(() => new Promise(() => undefined));

		render(FieldAccessModal, {
			activeOrg,
			sobjectType: "Account",
			fieldFullName: "Account.Legacy_Code__c",
			onClose: vi.fn(),
		});

		await screen.findByRole("heading", { name: "Loading access audit" });
		expect(screen.queryByRole("table")).toBeNull();
	});

	it("shows error state and retries fetch", async () => {
		mockedBackendClient.listFieldAccess
			.mockRejectedValueOnce(new Error("Boom"))
			.mockResolvedValueOnce(defaultResponse);

		render(FieldAccessModal, {
			activeOrg,
			sobjectType: "Account",
			fieldFullName: "Account.Legacy_Code__c",
			onClose: vi.fn(),
		});

		await screen.findByText("Boom");
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();

		await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() => {
			expect(mockedBackendClient.listFieldAccess).toHaveBeenCalledTimes(2);
		});
		await screen.findByText("Ada Admin");
	});

	it("shows explicit empty state when no FLS rows are returned", async () => {
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

		render(FieldAccessModal, {
			activeOrg,
			sobjectType: "Account",
			fieldFullName: "Account.Legacy_Code__c",
			onClose: vi.fn(),
		});

		await screen.findByRole("heading", {
			name: "No explicit FLS records were found for this field",
		});
		expect(
			screen.getByText(/Standard fields with base object visibility may still be readable/i),
		).toBeTruthy();
	});

	it("shows empty-by-filter messaging while keeping controls visible", async () => {
		render(FieldAccessModal, {
			activeOrg,
			sobjectType: "Account",
			fieldFullName: "Account.Legacy_Code__c",
			onClose: vi.fn(),
		});

		await screen.findByText("Ada Admin");
		const filterInput = screen.getByPlaceholderText("User, username, or source name");
		await fireEvent.input(filterInput, { target: { value: "no-matching-user" } });

		await screen.findByText("No rows match the current filters.");
		expect(screen.getByPlaceholderText("User, username, or source name")).toBeTruthy();
		expect(screen.getByRole("checkbox", { name: "Include muted users" })).toBeTruthy();
	});

	it("filters muted rows by default, can include muted rows, and builds deep links from instanceUrl", async () => {
		render(FieldAccessModal, {
			activeOrg,
			sobjectType: "Account",
			fieldFullName: "Account.Legacy_Code__c",
			onClose: vi.fn(),
		});

		await screen.findByRole("dialog", { name: "Who Has Access: Account.Legacy_Code__c" });
		await screen.findByText("Ada Admin");
		expect(screen.queryByText("Bob Builder")).toBeNull();

		const includeMuted = screen.getByRole("checkbox", { name: "Include muted users" });
		await fireEvent.click(includeMuted);
		await screen.findByText("Bob Builder");

		const userLink = screen.getByRole("link", { name: "Ada Admin" });
		expect(userLink.getAttribute("href")).toBe(
			"https://example.my.salesforce.com/lightning/setup/ManageUsers/page?address=%2F005A",
		);

		const filterInput = screen.getByPlaceholderText("User, username, or source name");
		await fireEvent.input(filterInput, { target: { value: "finance group" } });
		await waitFor(() => {
			expect(screen.queryByText("Ada Admin")).toBeNull();
			expect(screen.getByText("Bob Builder")).toBeTruthy();
		});
	});

	it("exports filtered rows to CSV", async () => {
		let capturedBlob: Blob | undefined;
		const clickSpy = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(() => undefined);
		const createObjectUrlSpy = vi
			.spyOn(URL, "createObjectURL")
			.mockImplementation((blob: Blob | MediaSource) => {
				if (blob instanceof Blob) {
					capturedBlob = blob;
				}
				return "blob:field-access-export";
			});
		const revokeObjectUrlSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

		render(FieldAccessModal, {
			activeOrg,
			sobjectType: "Account",
			fieldFullName: "Account.Legacy_Code__c",
			onClose: vi.fn(),
		});

		await screen.findByText("Ada Admin");
		await fireEvent.click(screen.getByRole("checkbox", { name: "Include muted users" }));
		await fireEvent.input(screen.getByPlaceholderText("User, username, or source name"), {
			target: { value: "bob" },
		});
		await waitFor(() => {
			expect(screen.getByText("Bob Builder")).toBeTruthy();
			expect(screen.queryByText("Ada Admin")).toBeNull();
		});
		await fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

		expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
		expect(clickSpy).toHaveBeenCalledTimes(1);
		expect(revokeObjectUrlSpy).toHaveBeenCalledWith("blob:field-access-export");

		const csv = (await capturedBlob?.text()) ?? "";
		expect(csv).toBeTruthy();
		expect(csv).toContain(
			"userName,username,accessLevel,assignmentType,sourceName,viaPermissionSetName,mutedBySourceName,userId,sourceId,viaPermissionSetId,mutedBySourceId,isActive",
		);
		expect(csv).toContain(
			"Bob Builder,bob@example.com,None (Muted),PermissionSetGroup,Finance Group",
		);
		expect(csv).not.toContain("Ada Admin,ada@example.com,Read,PermissionSet,Finance Read");

		const downloadAnchor = clickSpy.mock.instances[0] as HTMLAnchorElement | undefined;
		expect(downloadAnchor?.download).toMatch(
			/^field-access_Account_Legacy_Code__c_\d{8}-\d{4}\.csv$/,
		);
	});
});
