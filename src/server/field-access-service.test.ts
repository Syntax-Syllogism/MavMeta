import { describe, expect, it, vi } from "vitest";

import { FieldAccessService } from "./field-access-service";

type QueryResult<TRecord> = {
	records: TRecord[];
	done: boolean;
	nextRecordsUrl?: string;
};

type MockConnection = {
	query: ReturnType<typeof vi.fn>;
	queryMore: ReturnType<typeof vi.fn>;
};

function createServiceWithConnection(
	connection: MockConnection,
	options: { maxAssignments?: number } = {},
) {
	return new FieldAccessService({
		connectionFactory: async () =>
			({
				query: connection.query,
				queryMore: connection.queryMore,
			}) as never,
		maxAssignments: options.maxAssignments,
	});
}

describe("FieldAccessService", () => {
	it("returns profile-only access", async () => {
		const query = vi.fn(async (soql: string): Promise<QueryResult<Record<string, unknown>>> => {
			if (
				soql.includes("FROM FieldPermissions") &&
				!soql.includes("Parent.IsOwnedByProfile = false")
			) {
				return {
					records: [
						{
							ParentId: "0PS-PROFILE",
							Parent: { IsOwnedByProfile: true, Profile: { Name: "System Administrator" } },
							PermissionsRead: true,
							PermissionsEdit: false,
						},
					],
					done: true,
				};
			}
			if (soql.includes("FROM PermissionSetAssignment")) {
				return {
					records: [
						{
							AssigneeId: "005A",
							Assignee: { Name: "Ada Admin", Username: "ada@example.com", IsActive: true },
							PermissionSetId: "0PS-PROFILE",
							PermissionSet: {
								IsOwnedByProfile: true,
								ProfileId: "00ePROFILE",
								Profile: { Name: "System Administrator" },
							},
						},
					],
					done: true,
				};
			}
			return { records: [], done: true };
		});

		const service = createServiceWithConnection({
			query,
			queryMore: vi.fn(),
		});
		const result = await service.resolve({
			target: { username: "user@example.com" },
			sobjectType: "Account",
			fieldFullName: "Account.Legacy_Code__c",
		});

		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]).toMatchObject({
			assignmentType: "Profile",
			accessLevel: "Read",
			sourceId: "00ePROFILE",
		});
		expect(result.stats.totalActiveUsersWithAccess).toBe(1);
		expect(result.stats.profileGrants).toBe(1);
		expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM FieldPermissions"));
		expect(query).toHaveBeenCalledWith(expect.stringContaining("LIMIT 2000"));
	});

	it("falls back to PermissionSet attribution when an IsOwnedByProfile row has no ProfileId", async () => {
		const query = vi.fn(async (soql: string): Promise<QueryResult<Record<string, unknown>>> => {
			if (
				soql.includes("FROM FieldPermissions") &&
				!soql.includes("Parent.IsOwnedByProfile = false")
			) {
				return {
					records: [
						{
							ParentId: "0PS-PROFILE",
							Parent: {
								IsOwnedByProfile: true,
								Profile: { Name: "System Administrator" },
								Name: "System Administrator",
							},
							PermissionsRead: true,
							PermissionsEdit: false,
						},
					],
					done: true,
				};
			}
			if (soql.includes("FROM PermissionSetAssignment")) {
				return {
					records: [
						{
							AssigneeId: "005A",
							Assignee: { Name: "Ada Admin", Username: "ada@example.com", IsActive: true },
							PermissionSetId: "0PS-PROFILE",
							PermissionSet: {
								Name: "Hidden Profile Parent PermSet",
								IsOwnedByProfile: true,
								ProfileId: null,
							},
						},
					],
					done: true,
				};
			}
			return { records: [], done: true };
		});

		const service = createServiceWithConnection({
			query,
			queryMore: vi.fn(),
		});
		const result = await service.resolve({
			target: { username: "user@example.com" },
			sobjectType: "Account",
			fieldFullName: "Account.Legacy_Code__c",
		});

		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]).toMatchObject({
			assignmentType: "PermissionSet",
			sourceId: "0PS-PROFILE",
			sourceName: "Hidden Profile Parent PermSet",
		});
		expect(result.stats.profileGrants).toBe(0);
		expect(result.stats.permissionSetGrants).toBe(1);
	});

	it("falls back to PermissionSet attribution when an IsOwnedByProfile row has a blank ProfileId", async () => {
		const query = vi.fn(async (soql: string): Promise<QueryResult<Record<string, unknown>>> => {
			if (
				soql.includes("FROM FieldPermissions") &&
				!soql.includes("Parent.IsOwnedByProfile = false")
			) {
				return {
					records: [
						{
							ParentId: "0PS-PROFILE-BLANK",
							Parent: {
								IsOwnedByProfile: true,
								Profile: { Name: "Standard User" },
								Name: "Standard User",
							},
							PermissionsRead: true,
							PermissionsEdit: false,
						},
					],
					done: true,
				};
			}
			if (soql.includes("FROM PermissionSetAssignment")) {
				return {
					records: [
						{
							AssigneeId: "005B",
							Assignee: { Name: "Bob Builder", Username: "bob@example.com", IsActive: true },
							PermissionSetId: "0PS-PROFILE-BLANK",
							PermissionSet: {
								Name: "Hidden Blank Profile Parent",
								IsOwnedByProfile: true,
								ProfileId: "   ",
							},
						},
					],
					done: true,
				};
			}
			return { records: [], done: true };
		});

		const service = createServiceWithConnection({
			query,
			queryMore: vi.fn(),
		});
		const result = await service.resolve({
			target: { username: "user@example.com" },
			sobjectType: "Account",
			fieldFullName: "Account.Legacy_Code__c",
		});

		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]).toMatchObject({
			assignmentType: "PermissionSet",
			sourceId: "0PS-PROFILE-BLANK",
			sourceName: "Hidden Blank Profile Parent",
		});
		expect(result.stats.profileGrants).toBe(0);
		expect(result.stats.permissionSetGrants).toBe(1);
	});

	it("returns standalone permission-set access without PSG mapping", async () => {
		const query = vi.fn(async (soql: string): Promise<QueryResult<Record<string, unknown>>> => {
			if (soql.includes("FROM FieldPermissions")) {
				return {
					records: [
						{
							ParentId: "0PS-STANDALONE",
							Parent: { IsOwnedByProfile: false, Type: "Regular", Name: "Standalone Grant" },
							PermissionsRead: true,
							PermissionsEdit: true,
						},
					],
					done: true,
				};
			}
			if (soql.includes("FROM PermissionSetGroupComponent")) {
				return {
					records: [],
					done: true,
				};
			}
			if (soql.includes("FROM PermissionSetAssignment")) {
				return {
					records: [
						{
							AssigneeId: "005A",
							Assignee: { Name: "Ada Admin", Username: "ada@example.com", IsActive: true },
							PermissionSetId: "0PS-STANDALONE",
							PermissionSet: { Name: "Standalone Grant", IsOwnedByProfile: false },
						},
					],
					done: true,
				};
			}
			return { records: [], done: true };
		});

		const service = createServiceWithConnection({ query, queryMore: vi.fn() });
		const result = await service.resolve({
			target: { username: "user@example.com" },
			sobjectType: "Account",
			fieldFullName: "Account.Legacy_Code__c",
		});

		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]).toMatchObject({
			assignmentType: "PermissionSet",
			accessLevel: "Edit",
			sourceId: "0PS-STANDALONE",
			sourceName: "Standalone Grant",
		});
		expect(result.stats.permissionSetGrants).toBe(1);
		expect(result.stats.totalActiveUsersWithAccess).toBe(1);
	});

	it("expands PSG grants into one row per underlying permission set when not muted", async () => {
		const query = vi.fn(async (soql: string): Promise<QueryResult<Record<string, unknown>>> => {
			if (
				soql.includes("FROM FieldPermissions") &&
				!soql.includes("Parent.IsOwnedByProfile = false")
			) {
				return {
					records: [
						{
							ParentId: "0PS1",
							Parent: { IsOwnedByProfile: false, Type: "Regular", Name: "PS Grant One" },
							PermissionsRead: true,
							PermissionsEdit: false,
						},
						{
							ParentId: "0PS2",
							Parent: { IsOwnedByProfile: false, Type: "Regular", Name: "PS Grant Two" },
							PermissionsRead: true,
							PermissionsEdit: true,
						},
					],
					done: true,
				};
			}
			if (
				soql.includes("FROM PermissionSetGroupComponent") &&
				soql.includes("PermissionSet.Type = 'Muting'")
			) {
				return { records: [], done: true };
			}
			if (soql.includes("FROM PermissionSetGroupComponent")) {
				return {
					records: [
						{
							PermissionSetGroupId: "0PG1",
							PermissionSetId: "0PS1",
							PermissionSetGroup: { MasterLabel: "Finance Group" },
						},
						{
							PermissionSetGroupId: "0PG1",
							PermissionSetId: "0PS2",
							PermissionSetGroup: { MasterLabel: "Finance Group" },
						},
					],
					done: true,
				};
			}
			if (soql.includes("FROM PermissionSetAssignment")) {
				return {
					records: [
						{
							AssigneeId: "005A",
							Assignee: { Name: "Ada Admin", Username: "ada@example.com", IsActive: true },
							PermissionSetGroupId: "0PG1",
							PermissionSetGroup: { MasterLabel: "Finance Group" },
						},
					],
					done: true,
				};
			}
			return { records: [], done: true };
		});

		const service = createServiceWithConnection({ query, queryMore: vi.fn() });
		const result = await service.resolve({
			target: { username: "user@example.com" },
			sobjectType: "Account",
			fieldFullName: "Account.Legacy_Code__c",
		});

		expect(result.rows).toHaveLength(2);
		expect(result.rows.map((row) => row.viaPermissionSetId).sort()).toEqual(["0PS1", "0PS2"]);
		expect(result.rows.every((row) => row.assignmentType === "PermissionSetGroup")).toBe(true);
		expect(result.rows.some((row) => row.accessLevel === "Edit")).toBe(true);
		expect(result.stats.permissionSetGroupGrants).toBe(1);
		expect(result.stats.totalActiveUsersWithAccess).toBe(1);
	});

	it("expands PSG access rows and marks muted rows as none", async () => {
		const query = vi.fn(async (soql: string): Promise<QueryResult<Record<string, unknown>>> => {
			if (
				soql.includes("FROM FieldPermissions") &&
				!soql.includes("Parent.IsOwnedByProfile = false")
			) {
				return {
					records: [
						{
							ParentId: "0PS1",
							Parent: { IsOwnedByProfile: false, Type: "Regular", Name: "Finance Read" },
							PermissionsRead: true,
							PermissionsEdit: false,
						},
						{
							ParentId: "0PS2",
							Parent: { IsOwnedByProfile: false, Type: "Regular", Name: "Finance Edit" },
							PermissionsRead: true,
							PermissionsEdit: true,
						},
					],
					done: true,
				};
			}
			if (
				soql.includes("FROM PermissionSetGroupComponent") &&
				soql.includes("PermissionSet.Type = 'Muting'")
			) {
				return {
					records: [
						{
							PermissionSetGroupId: "0PG1",
							PermissionSetId: "0PSM",
							PermissionSet: { Type: "Muting", Name: "Finance Muting" },
						},
					],
					done: true,
				};
			}
			if (soql.includes("FROM PermissionSetGroupComponent")) {
				return {
					records: [
						{
							PermissionSetGroupId: "0PG1",
							PermissionSetId: "0PS1",
							PermissionSetGroup: { MasterLabel: "Finance Group" },
						},
						{
							PermissionSetGroupId: "0PG1",
							PermissionSetId: "0PS2",
							PermissionSetGroup: { MasterLabel: "Finance Group" },
						},
					],
					done: true,
				};
			}
			if (soql.includes("FROM PermissionSetAssignment")) {
				return {
					records: [
						{
							AssigneeId: "005A",
							Assignee: { Name: "Ada Admin", Username: "ada@example.com", IsActive: true },
							PermissionSetGroupId: "0PG1",
							PermissionSetGroup: { MasterLabel: "Finance Group" },
						},
					],
					done: true,
				};
			}
			if (soql.includes("Parent.IsOwnedByProfile = false")) {
				return {
					records: [{ ParentId: "0PSM", PermissionsRead: false, PermissionsEdit: false }],
					done: true,
				};
			}
			return { records: [], done: true };
		});

		const service = createServiceWithConnection({
			query,
			queryMore: vi.fn(),
		});
		const result = await service.resolve({
			target: { username: "user@example.com" },
			sobjectType: "Account",
			fieldFullName: "Account.Legacy_Code__c",
		});

		expect(result.rows).toHaveLength(2);
		expect(result.rows.every((row) => row.accessLevel === "None (Muted)")).toBe(true);
		expect(result.stats.totalActiveUsersWithAccess).toBe(0);
		expect(result.stats.mutedUsers).toBe(1);
	});

	it("uses a human fallback label when muting permission set name is missing", async () => {
		const query = vi.fn(async (soql: string): Promise<QueryResult<Record<string, unknown>>> => {
			if (
				soql.includes("FROM FieldPermissions") &&
				!soql.includes("Parent.IsOwnedByProfile = false")
			) {
				return {
					records: [
						{
							ParentId: "0PS1",
							Parent: { IsOwnedByProfile: false, Type: "Regular", Name: "Finance Read" },
							PermissionsRead: true,
							PermissionsEdit: false,
						},
					],
					done: true,
				};
			}
			if (
				soql.includes("FROM PermissionSetGroupComponent") &&
				soql.includes("PermissionSet.Type = 'Muting'")
			) {
				return {
					records: [
						{
							PermissionSetGroupId: "0PG1",
							PermissionSetId: "0PSM",
							PermissionSet: { Type: "Muting" },
						},
					],
					done: true,
				};
			}
			if (soql.includes("FROM PermissionSetGroupComponent")) {
				return {
					records: [
						{
							PermissionSetGroupId: "0PG1",
							PermissionSetId: "0PS1",
							PermissionSetGroup: { MasterLabel: "Finance Group" },
						},
					],
					done: true,
				};
			}
			if (soql.includes("FROM PermissionSetAssignment")) {
				return {
					records: [
						{
							AssigneeId: "005A",
							Assignee: { Name: "Ada Admin", Username: "ada@example.com", IsActive: true },
							PermissionSetGroupId: "0PG1",
							PermissionSetGroup: { MasterLabel: "Finance Group" },
						},
					],
					done: true,
				};
			}
			if (soql.includes("Parent.IsOwnedByProfile = false")) {
				return {
					records: [{ ParentId: "0PSM", PermissionsRead: false, PermissionsEdit: false }],
					done: true,
				};
			}
			return { records: [], done: true };
		});

		const service = createServiceWithConnection({
			query,
			queryMore: vi.fn(),
		});
		const result = await service.resolve({
			target: { username: "user@example.com" },
			sobjectType: "Account",
			fieldFullName: "Account.Legacy_Code__c",
		});

		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.mutedBySourceName).toBe("(Unnamed Muting Permission Set)");
	});

	it("does not mute direct permission-set access from a separate assignment", async () => {
		const query = vi.fn(async (soql: string): Promise<QueryResult<Record<string, unknown>>> => {
			if (
				soql.includes("FROM FieldPermissions") &&
				!soql.includes("Parent.IsOwnedByProfile = false")
			) {
				return {
					records: [
						{
							ParentId: "0PS-IN-PSG",
							Parent: { IsOwnedByProfile: false, Type: "Regular", Name: "PSG Field Grant" },
							PermissionsRead: true,
							PermissionsEdit: false,
						},
						{
							ParentId: "0PS-DIRECT",
							Parent: { IsOwnedByProfile: false, Type: "Regular", Name: "Direct Field Edit" },
							PermissionsRead: true,
							PermissionsEdit: true,
						},
					],
					done: true,
				};
			}
			if (
				soql.includes("FROM PermissionSetGroupComponent") &&
				soql.includes("PermissionSet.Type = 'Muting'")
			) {
				return {
					records: [
						{
							PermissionSetGroupId: "0PG1",
							PermissionSetId: "0PSM",
							PermissionSet: { Type: "Muting", Name: "Group Muting" },
						},
					],
					done: true,
				};
			}
			if (soql.includes("FROM PermissionSetGroupComponent")) {
				return {
					records: [
						{
							PermissionSetGroupId: "0PG1",
							PermissionSetId: "0PS-IN-PSG",
							PermissionSetGroup: { MasterLabel: "Security Group" },
						},
					],
					done: true,
				};
			}
			if (soql.includes("FROM PermissionSetAssignment")) {
				return {
					records: [
						{
							AssigneeId: "005A",
							Assignee: { Name: "Ada Admin", Username: "ada@example.com", IsActive: true },
							PermissionSetGroupId: "0PG1",
							PermissionSetGroup: { MasterLabel: "Security Group" },
						},
						{
							AssigneeId: "005A",
							Assignee: { Name: "Ada Admin", Username: "ada@example.com", IsActive: true },
							PermissionSetId: "0PS-DIRECT",
							PermissionSet: { Name: "Direct Field Edit", IsOwnedByProfile: false },
						},
					],
					done: true,
				};
			}
			if (soql.includes("Parent.IsOwnedByProfile = false")) {
				return {
					records: [{ ParentId: "0PSM", PermissionsRead: false, PermissionsEdit: false }],
					done: true,
				};
			}
			return { records: [], done: true };
		});

		const service = createServiceWithConnection({
			query,
			queryMore: vi.fn(),
		});
		const result = await service.resolve({
			target: { username: "user@example.com" },
			sobjectType: "Account",
			fieldFullName: "Account.Legacy_Code__c",
		});

		expect(result.rows).toHaveLength(2);
		expect(
			result.rows.some(
				(row) => row.assignmentType === "PermissionSet" && row.accessLevel === "Edit",
			),
		).toBe(true);
		expect(
			result.rows.some(
				(row) => row.assignmentType === "PermissionSetGroup" && row.accessLevel === "None (Muted)",
			),
		).toBe(true);
		expect(result.stats.totalActiveUsersWithAccess).toBe(1);
		expect(result.stats.mutedUsers).toBe(1);
	});

	it("paginates permission-set assignments with queryMore", async () => {
		const queryMore = vi.fn(
			async (): Promise<QueryResult<Record<string, unknown>>> => ({
				records: [
					{
						AssigneeId: "005B",
						Assignee: { Name: "Bob Builder", Username: "bob@example.com", IsActive: true },
						PermissionSetId: "0PS1",
						PermissionSet: { Name: "Grant", IsOwnedByProfile: false },
					},
				],
				done: true,
			}),
		);
		const query = vi.fn(async (soql: string): Promise<QueryResult<Record<string, unknown>>> => {
			if (soql.includes("FROM FieldPermissions")) {
				return {
					records: [
						{
							ParentId: "0PS1",
							Parent: { IsOwnedByProfile: false, Type: "Regular", Name: "Grant" },
							PermissionsRead: true,
							PermissionsEdit: false,
						},
					],
					done: true,
				};
			}
			if (soql.includes("FROM PermissionSetAssignment")) {
				return {
					records: [
						{
							AssigneeId: "005A",
							Assignee: { Name: "Ada Admin", Username: "ada@example.com", IsActive: true },
							PermissionSetId: "0PS1",
							PermissionSet: { Name: "Grant", IsOwnedByProfile: false },
						},
					],
					done: false,
					nextRecordsUrl: "/next-page",
				};
			}
			return { records: [], done: true };
		});

		const service = createServiceWithConnection({ query, queryMore });
		const result = await service.resolve({
			target: { username: "user@example.com" },
			sobjectType: "Account",
			fieldFullName: "Account.Legacy_Code__c",
		});

		expect(queryMore).toHaveBeenCalledWith("/next-page");
		expect(result.rows).toHaveLength(2);
		expect(result.stats.totalActiveUsersWithAccess).toBe(2);
	});

	it("excludes Parent.Type='Group' rows from standalone PSG component lookup", async () => {
		const query = vi.fn(async (soql: string): Promise<QueryResult<Record<string, unknown>>> => {
			if (soql.includes("FROM FieldPermissions")) {
				return {
					records: [
						{
							ParentId: "0PS-GROUP-LIKE",
							Parent: { IsOwnedByProfile: false, Type: "Group", Name: "Group-Sourced Grant" },
							PermissionsRead: true,
							PermissionsEdit: false,
						},
					],
					done: true,
				};
			}
			if (soql.includes("FROM PermissionSetGroupComponent")) {
				return {
					records: [],
					done: true,
				};
			}
			if (soql.includes("FROM PermissionSetAssignment")) {
				return {
					records: [
						{
							AssigneeId: "005A",
							Assignee: { Name: "Ada Admin", Username: "ada@example.com", IsActive: true },
							PermissionSetId: "0PS-GROUP-LIKE",
							PermissionSet: { Name: "Group-Sourced Grant", IsOwnedByProfile: false },
						},
					],
					done: true,
				};
			}
			return { records: [], done: true };
		});

		const service = createServiceWithConnection({ query, queryMore: vi.fn() });
		await service.resolve({
			target: { username: "user@example.com" },
			sobjectType: "Account",
			fieldFullName: "Account.Legacy_Code__c",
		});

		const psgPhaseBCalls = query.mock.calls
			.map((call) => call[0] as string)
			.filter(
				(soql) =>
					soql.includes("FROM PermissionSetGroupComponent") &&
					!soql.includes("PermissionSet.Type = 'Muting'"),
			);
		expect(psgPhaseBCalls).toHaveLength(0);
	});

	it("caps assignment processing at maxAssignments and returns warning", async () => {
		const query = vi.fn(async (soql: string): Promise<QueryResult<Record<string, unknown>>> => {
			if (soql.includes("FROM FieldPermissions")) {
				return {
					records: [
						{
							ParentId: "0PS1",
							Parent: { IsOwnedByProfile: false, Type: "Regular", Name: "Grant" },
							PermissionsRead: true,
							PermissionsEdit: false,
						},
					],
					done: true,
				};
			}
			if (soql.includes("FROM PermissionSetAssignment")) {
				return {
					records: [
						{
							AssigneeId: "005A",
							Assignee: { Name: "Ada Admin", Username: "ada@example.com", IsActive: true },
							PermissionSetId: "0PS1",
							PermissionSet: { Name: "Grant", IsOwnedByProfile: false },
						},
						{
							AssigneeId: "005B",
							Assignee: { Name: "Bob Builder", Username: "bob@example.com", IsActive: true },
							PermissionSetId: "0PS1",
							PermissionSet: { Name: "Grant", IsOwnedByProfile: false },
						},
					],
					done: true,
				};
			}
			return { records: [], done: true };
		});

		const service = createServiceWithConnection(
			{ query, queryMore: vi.fn() },
			{ maxAssignments: 1 },
		);
		const result = await service.resolve({
			target: { username: "user@example.com" },
			sobjectType: "Account",
			fieldFullName: "Account.Legacy_Code__c",
		});

		expect(result.rows).toHaveLength(1);
		expect(result.warnings).toEqual([
			"Showing first 1 user assignments. Refine scope if you need a complete export.",
		]);
	});

	it("returns an empty response when no field permissions exist", async () => {
		const service = createServiceWithConnection({
			query: vi.fn(async () => ({ records: [], done: true })),
			queryMore: vi.fn(),
		});
		const result = await service.resolve({
			target: { username: "user@example.com" },
			sobjectType: "Account",
			fieldFullName: "Account.Missing__c",
		});

		expect(result.rows).toEqual([]);
		expect(result.stats).toEqual({
			totalActiveUsersWithAccess: 0,
			profileGrants: 0,
			permissionSetGrants: 0,
			permissionSetGroupGrants: 0,
			mutedUsers: 0,
		});
	});
});
