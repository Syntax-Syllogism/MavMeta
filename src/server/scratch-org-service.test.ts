import { beforeEach, describe, expect, it, vi } from "vitest";

import { ScratchOrgService } from "./scratch-org-service";
import type { Org } from "@salesforce/core";

function makeOrg(username: string) {
	return { username } as unknown as Org;
}

const fixedTime = 1_700_000_000_000;

type ServiceOverrides = {
	scratchOrgCreateFn?: (hubOrg: Org, orgConfig: Record<string, unknown>, durationDays: number) => Promise<{ username?: string; warnings: string[] }>;
	orgFactory?: (username: string) => Promise<Org>;
	authInfoFactory?: (username: string) => Promise<{ setAlias: (alias: string) => Promise<void> }>;
};

function makeService(overrides: ServiceOverrides = {}) {
	return new ScratchOrgService({
		uuidFactory: () => "test-op-id",
		now: () => fixedTime,
		orgFactory: overrides.orgFactory ?? (async (username) => makeOrg(username)),
		scratchOrgCreateFn: overrides.scratchOrgCreateFn,
		authInfoFactory: overrides.authInfoFactory,
	});
}

describe("ScratchOrgService", () => {
	let setAliasMock: ReturnType<typeof vi.fn>;
	let authInfoFactory: NonNullable<ConstructorParameters<typeof ScratchOrgService>[0]>["authInfoFactory"];

	beforeEach(() => {
		setAliasMock = vi.fn().mockResolvedValue(undefined);
		authInfoFactory = vi.fn().mockResolvedValue({ setAlias: setAliasMock });
	});

	it("startCreate returns an operationId immediately", async () => {
		const service = makeService({
			scratchOrgCreateFn: vi.fn().mockResolvedValue({
				username: "test@scratch.example.com",
				warnings: [],
			}),
		});

		const result = await service.startCreate({
			devHubUsername: "hub@example.com",
			definition: { edition: "Developer" },
			durationDays: 7,
		});

		expect(result).toEqual({ operationId: "test-op-id" });
	});

	it("transitions to succeeded status after successful creation", async () => {
		const scratchOrgCreateFn = vi.fn().mockResolvedValue({
			username: "new-scratch@example.com",
			warnings: [],
		});
		const service = makeService({ scratchOrgCreateFn, authInfoFactory });

		await service.startCreate({
			devHubUsername: "hub@example.com",
			definition: { edition: "Developer" },
			durationDays: 7,
		});

		// Allow the async runCreate to complete
		await new Promise((resolve) => setTimeout(resolve, 0));

		const status = await service.getStatus("test-op-id");

		expect(status.status).toBe("succeeded");
		expect(status.username).toBe("new-scratch@example.com");
		expect(status.message).toContain("new-scratch@example.com");
		expect(status.warnings).toEqual([]);
	});

	it("sets alias on AuthInfo after successful creation when alias is provided", async () => {
		const scratchOrgCreateFn = vi.fn().mockResolvedValue({
			username: "new-scratch@example.com",
			warnings: [],
		});
		const service = makeService({ scratchOrgCreateFn, authInfoFactory });

		await service.startCreate({
			devHubUsername: "hub@example.com",
			definition: { edition: "Developer" },
			alias: "my-scratch",
			durationDays: 7,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(authInfoFactory).toHaveBeenCalledWith("new-scratch@example.com");
		expect(setAliasMock).toHaveBeenCalledWith("my-scratch");
	});

	it("does not set alias when alias is blank", async () => {
		const scratchOrgCreateFn = vi.fn().mockResolvedValue({
			username: "new-scratch@example.com",
			warnings: [],
		});
		const service = makeService({ scratchOrgCreateFn, authInfoFactory });

		await service.startCreate({
			devHubUsername: "hub@example.com",
			definition: { edition: "Developer" },
			alias: "  ",
			durationDays: 7,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(setAliasMock).not.toHaveBeenCalled();
	});

	it("transitions to failed status when scratchOrgCreate throws", async () => {
		const scratchOrgCreateFn = vi.fn().mockRejectedValue(new Error("Org creation limit reached."));
		const service = makeService({ scratchOrgCreateFn, authInfoFactory });

		await service.startCreate({
			devHubUsername: "hub@example.com",
			definition: { edition: "Developer" },
			durationDays: 7,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		const status = await service.getStatus("test-op-id");

		expect(status.status).toBe("failed");
		expect(status.message).toBe("Org creation limit reached.");
		expect(status.username).toBeUndefined();
	});

	it("failed operation preserves no org state", async () => {
		const scratchOrgCreateFn = vi.fn().mockRejectedValue(new Error("Network timeout."));
		const service = makeService({ scratchOrgCreateFn, authInfoFactory });

		await service.startCreate({
			devHubUsername: "hub@example.com",
			definition: { edition: "Developer" },
			durationDays: 7,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		const status = await service.getStatus("test-op-id");

		expect(status.username).toBeUndefined();
		expect(status.warnings).toBeUndefined();
	});

	it("getStatus throws 404 for unknown operationId", async () => {
		const service = makeService();

		await expect(service.getStatus("nonexistent-id")).rejects.toThrow("nonexistent-id");
	});

	it("passes definition and durationDays to scratchOrgCreate", async () => {
		const scratchOrgCreateFn = vi.fn().mockResolvedValue({
			username: "test@scratch.example.com",
			warnings: [],
		});
		const orgFactory = vi.fn().mockResolvedValue(makeOrg("hub@example.com"));
		const service = makeService({ scratchOrgCreateFn, orgFactory, authInfoFactory });

		await service.startCreate({
			devHubUsername: "hub@example.com",
			definition: { edition: "Developer", features: ["Communities"] },
			durationDays: 14,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(orgFactory).toHaveBeenCalledWith("hub@example.com");
		expect(scratchOrgCreateFn).toHaveBeenCalledWith(
			makeOrg("hub@example.com"),
			{ edition: "Developer", features: ["Communities"] },
			14,
		);
	});

	it("prunes completed operations that exceed TTL", async () => {
		let currentTime = fixedTime;
		const scratchOrgCreateFn = vi.fn().mockResolvedValue({ username: "a@example.com", warnings: [] });

		const service = new ScratchOrgService({
			uuidFactory: (() => {
				let counter = 0;
				return () => `op-${++counter}`;
			})(),
			now: () => currentTime,
			orgFactory: async (username) => makeOrg(username),
			scratchOrgCreateFn,
			authInfoFactory: async () => ({ setAlias: vi.fn() }),
			completedOperationTtlMs: 1000,
		});

		await service.startCreate({
			devHubUsername: "hub@example.com",
			definition: {},
			durationDays: 7,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		currentTime = fixedTime + 2000;

		await service.startCreate({
			devHubUsername: "hub@example.com",
			definition: {},
			durationDays: 7,
		});

		await expect(service.getStatus("op-1")).rejects.toThrow("op-1");
	});

	it("listSnapshots maps tooling records when snapshots are enabled", async () => {
		const query = vi
			.fn()
			.mockResolvedValueOnce({ totalSize: 1, records: [] })
			.mockResolvedValueOnce({
				totalSize: 1,
				records: [
					{
						Id: "0Oo000000000001",
						SnapshotName: "baseline",
						Content: "Baseline snapshot",
						Status: "Active",
						ExpirationDate: "2026-06-30T00:00:00.000Z",
						CreatedDate: "2026-05-01T00:00:00.000Z",
						SourceOrg: "00D000000000001",
					},
					{
						Id: "",
						SnapshotName: "",
						CreatedDate: "",
					},
				],
			});
		const service = makeService({
			orgFactory: vi.fn().mockResolvedValue({
				getConnection: vi.fn().mockResolvedValue({ tooling: { query } }),
			} as unknown as Org),
		});

		const result = await service.listSnapshots("hub@example.com");
		expect(query).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining("ORDER BY CreatedDate DESC LIMIT 200"),
		);

		expect(result).toEqual({
			eligibility: "enabled",
			snapshots: [
				{
					id: "0Oo000000000001",
					snapshotName: "baseline",
					description: "Baseline snapshot",
					status: "Active",
					expirationDate: "2026-06-30T00:00:00.000Z",
					createdDate: "2026-05-01T00:00:00.000Z",
					sourceOrgId: "00D000000000001",
				},
			],
		});
	});

	it("listSnapshots returns not-enabled when OrgSnapshot is unavailable", async () => {
		const query = vi.fn().mockRejectedValue({
			errorCode: "INVALID_TYPE",
			message: "sObject type 'OrgSnapshot' is not supported.",
		});
		const service = makeService({
			orgFactory: vi.fn().mockResolvedValue({
				connection: { tooling: { query } },
			} as unknown as Org),
		});

		const result = await service.listSnapshots("hub@example.com");

		expect(result).toEqual({ eligibility: "not-enabled", snapshots: [] });
	});

	it("listSnapshots rethrows unrelated Tooling API errors", async () => {
		const query = vi.fn().mockRejectedValue({
			errorCode: "INVALID_SESSION_ID",
			message: "Session expired or invalid",
		});
		const service = makeService({
			orgFactory: vi.fn().mockResolvedValue({
				connection: { tooling: { query } },
			} as unknown as Org),
		});

		await expect(service.listSnapshots("hub@example.com")).rejects.toEqual({
			errorCode: "INVALID_SESSION_ID",
			message: "Session expired or invalid",
		});
	});

	it("listSnapshots preserves tooling query method context", async () => {
		const tooling = {
			marker: "tooling",
			query(this: { marker: string }, statement: string) {
				if (this.marker !== "tooling") {
					throw new Error("query context lost");
				}
				if (statement.includes("count()")) {
					return Promise.resolve({ totalSize: 1, records: [] });
				}
				return Promise.resolve({ totalSize: 0, records: [] });
			},
		};
		const service = makeService({
			orgFactory: vi.fn().mockResolvedValue({
				getConnection: vi.fn().mockResolvedValue({ tooling }),
			} as unknown as Org),
		});

		const result = await service.listSnapshots("hub@example.com");
		expect(result).toEqual({ eligibility: "enabled", snapshots: [] });
	});
});
