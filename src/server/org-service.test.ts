import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrgService } from "./org-service";
import type { ActiveOrgStoreApi } from "./active-org-store";

const salesforceCoreMocks = vi.hoisted(() => ({
	listAllAuthorizations: vi.fn(),
	authInfoCreate: vi.fn(),
	orgCreate: vi.fn(),
	webOAuthServerCreate: vi.fn(),
}));

vi.mock("@salesforce/core", () => ({
	AuthInfo: {
		listAllAuthorizations: salesforceCoreMocks.listAllAuthorizations,
		create: salesforceCoreMocks.authInfoCreate,
	},
	AuthRemover: {
		create: vi.fn(),
	},
	Org: {
		create: salesforceCoreMocks.orgCreate,
	},
	WebOAuthServer: {
		create: salesforceCoreMocks.webOAuthServerCreate,
	},
}));

vi.mock("./system-browser", () => ({
	openInSystemBrowser: vi.fn().mockResolvedValue(undefined),
}));

describe("OrgService", () => {
	const inMemoryActiveOrgStore = (): ActiveOrgStoreApi => {
		let activeUsername: string | undefined;
		return {
			getActiveUsername: () => activeUsername,
			setActiveUsername: (username: string) => {
				activeUsername = username;
			},
			clear: () => {
				activeUsername = undefined;
			},
		};
	};

	beforeEach(() => {
		vi.clearAllMocks();
		salesforceCoreMocks.authInfoCreate.mockResolvedValue({
			getUsername: () => "sandbox@example.com",
		});
		salesforceCoreMocks.orgCreate.mockImplementation(async ({ aliasOrUsername }) => ({
			getConnection: () => ({
				query: async () => ({
					records: [{ TrialExpirationDate: aliasOrUsername === "scratch@example.com" ? "2026-06-01T00:00:00.000Z" : null }],
				}),
			}),
		}));
		salesforceCoreMocks.webOAuthServerCreate.mockResolvedValue({
			start: vi.fn().mockResolvedValue(undefined),
			getAuthorizationUrl: vi.fn().mockReturnValue("https://login.salesforce.com/auth"),
			authorizeAndSave: vi.fn().mockResolvedValue({
				getUsername: () => "new@example.com",
				setAlias: vi.fn().mockResolvedValue(undefined),
			}),
		});
	});

	it("maps Salesforce auth records into org summaries with active default org", async () => {
		salesforceCoreMocks.listAllAuthorizations.mockResolvedValue([
			{
				username: "prod@example.com",
				orgId: "00D000000000001",
				aliases: ["prod"],
				configs: ["target-org"],
				isScratchOrg: false,
				isSandbox: false,
				isDevHub: false,
				instanceUrl: "https://prod.example.com",
				isExpired: false,
			},
			{
				username: "sandbox@example.com",
				orgId: "00D000000000002",
				aliases: ["qa"],
				configs: [],
				isScratchOrg: false,
				isSandbox: true,
				isDevHub: false,
				instanceUrl: "https://sandbox.example.com",
				isExpired: true,
			},
		]);
		const service = new OrgService(inMemoryActiveOrgStore());

		const result = await service.listOrgs();

		expect(result.activeOrg?.username).toBe("prod@example.com");
		expect(result.orgs).toEqual([
			{
				alias: "prod",
				username: "prod@example.com",
				orgId: "00D000000000001",
				instanceUrl: "https://prod.example.com",
				environment: "production",
				isDefault: true,
				authStatus: "connected",
			},
			{
				alias: "qa",
				username: "sandbox@example.com",
				orgId: "00D000000000002",
				instanceUrl: "https://sandbox.example.com",
				environment: "sandbox",
				isDefault: false,
				authStatus: "expired",
			},
		]);
	});

	it("keeps MavMeta active org in app state without mutating global defaults", async () => {
		salesforceCoreMocks.listAllAuthorizations.mockResolvedValue([
			{
				username: "prod@example.com",
				orgId: "00D000000000001",
				aliases: ["prod"],
				configs: ["target-org"],
				isScratchOrg: false,
				isSandbox: false,
				isDevHub: false,
				instanceUrl: "https://prod.example.com",
				isExpired: false,
			},
			{
				username: "sandbox@example.com",
				orgId: "00D000000000002",
				aliases: ["qa"],
				configs: [],
				isScratchOrg: false,
				isSandbox: true,
				isDevHub: false,
				instanceUrl: "https://sandbox.example.com",
				isExpired: false,
			},
		]);
		const service = new OrgService(inMemoryActiveOrgStore());

		await service.setActiveOrg({ username: "sandbox@example.com" });
		const result = await service.listOrgs();

		expect(salesforceCoreMocks.authInfoCreate).toHaveBeenCalledWith({
			username: "sandbox@example.com",
		});
		expect(result.activeOrg?.username).toBe("sandbox@example.com");
		expect(result.orgs.find((org) => org.username === "sandbox@example.com")?.isDefault).toBe(false);
	});

	it("maps scratch org trial expiration date from organization query", async () => {
		salesforceCoreMocks.listAllAuthorizations.mockResolvedValue([
			{
				username: "scratch@example.com",
				orgId: "00D000000000003",
				aliases: ["scratch"],
				configs: [],
				isScratchOrg: true,
				isSandbox: true,
				isDevHub: false,
				instanceUrl: "https://scratch.example.com",
				isExpired: false,
			},
		]);
		const service = new OrgService(inMemoryActiveOrgStore());

		const result = await service.listOrgs();

		expect(result.orgs).toEqual([
			{
				alias: "scratch",
				username: "scratch@example.com",
				orgId: "00D000000000003",
				instanceUrl: "https://scratch.example.com",
				trialExpirationDate: "2026-06-01T00:00:00.000Z",
				environment: "scratch",
				isDefault: false,
				authStatus: "connected",
			},
		]);
	});

	it("does not query TrialExpirationDate for non-scratch orgs", async () => {
		salesforceCoreMocks.listAllAuthorizations.mockResolvedValue([
			{
				username: "prod@example.com",
				orgId: "00D000000000001",
				aliases: ["prod"],
				configs: ["target-org"],
				isScratchOrg: false,
				isSandbox: false,
				isDevHub: false,
				instanceUrl: "https://prod.example.com",
				isExpired: false,
			},
		]);
		const service = new OrgService(inMemoryActiveOrgStore());

		await service.listOrgs();

		expect(salesforceCoreMocks.orgCreate).not.toHaveBeenCalled();
	});

	it("caches TrialExpirationDate lookup across list refreshes", async () => {
		salesforceCoreMocks.listAllAuthorizations.mockResolvedValue([
			{
				username: "scratch@example.com",
				orgId: "00D000000000003",
				aliases: ["scratch"],
				configs: [],
				isScratchOrg: true,
				isSandbox: true,
				isDevHub: false,
				instanceUrl: "https://scratch.example.com",
				isExpired: false,
			},
		]);
		const service = new OrgService(inMemoryActiveOrgStore(), { trialExpirationCacheTtlMs: 60000 });

		await service.listOrgs();
		await service.listOrgs();

		expect(salesforceCoreMocks.orgCreate).toHaveBeenCalledTimes(1);
	});

	it("returns an actionable auth error when the Salesforce OAuth callback port is busy", async () => {
		salesforceCoreMocks.webOAuthServerCreate.mockResolvedValue({
			start: vi.fn().mockRejectedValue(
				new Error("Cannot start the OAuth redirect server on port 1717."),
			),
			getAuthorizationUrl: vi.fn(),
			authorizeAndSave: vi.fn(),
		});
		const service = new OrgService(inMemoryActiveOrgStore());

		await expect(service.authOrg({ loginUrl: "https://login.salesforce.com" }))
			.rejects.toMatchObject({
				statusCode: 409,
				code: "AUTH_PORT_IN_USE",
				message: expect.stringContaining("localhost port 1717 is already in use"),
			});
	});

	it("rejects a second auth request while one is already in progress", async () => {
		let resolveStart: (() => void) | undefined;
		const startPromise = new Promise<void>((resolve) => {
			resolveStart = resolve;
		});
		salesforceCoreMocks.listAllAuthorizations.mockResolvedValue([
			{
				username: "new@example.com",
				orgId: "00D000000000004",
				aliases: [],
				configs: [],
				isScratchOrg: false,
				isSandbox: false,
				isDevHub: false,
				instanceUrl: "https://new.example.com",
				isExpired: false,
			},
		]);
		salesforceCoreMocks.webOAuthServerCreate.mockResolvedValue({
			start: vi.fn().mockReturnValue(startPromise),
			getAuthorizationUrl: vi.fn().mockReturnValue("https://login.salesforce.com/auth"),
			authorizeAndSave: vi.fn().mockResolvedValue({
				getUsername: () => "new@example.com",
				setAlias: vi.fn().mockResolvedValue(undefined),
			}),
		});
		const service = new OrgService(inMemoryActiveOrgStore());

		const firstAuth = service.authOrg({ loginUrl: "login.salesforce.com" });
		await Promise.resolve();

		await expect(service.authOrg({ loginUrl: "login.salesforce.com" }))
			.rejects.toMatchObject({
				statusCode: 409,
				code: "AUTH_IN_PROGRESS",
			});

		resolveStart?.();
		await expect(firstAuth).resolves.toMatchObject({
			message: "new@example.com authenticated.",
		});
	});
});
