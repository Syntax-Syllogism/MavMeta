import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { InjectOptions } from "light-my-request";

import { createApp } from "./app";
import type { DeployServiceApi } from "./deploy-service";
import type { LwcServiceApi } from "./lwc-service";
import type { MetadataServiceApi } from "./metadata-service";
import type { OrgServiceApi } from "./org-service";
import type { RestServiceApi } from "./rest-service";
import type { SoqlServiceApi } from "./soql-service";
import type { ScratchOrgServiceApi } from "./scratch-org-service";

function createOrgServiceMock(): OrgServiceApi {
	return {
		listOrgs: vi.fn().mockResolvedValue({ orgs: [] }),
		setActiveOrg: vi.fn().mockResolvedValue({ message: "active" }),
		authOrg: vi.fn().mockResolvedValue({ message: "auth" }),
		reauthOrg: vi.fn().mockResolvedValue({ message: "reauth" }),
		openOrg: vi.fn().mockResolvedValue({ message: "open" }),
		logoutOrg: vi.fn().mockResolvedValue({ message: "logout" }),
		setAlias: vi.fn().mockResolvedValue({ message: "alias" }),
		refreshOrgStatus: vi.fn().mockResolvedValue({ message: "refresh" }),
		deleteScratchOrg: vi.fn().mockResolvedValue({ message: "delete" }),
	};
}

function createMetadataServiceMock(): MetadataServiceApi {
	return {
		listMetadataTypes: vi.fn().mockResolvedValue({
			target: { username: "user@example.com" },
			apiVersion: "66.0",
			types: [],
		}),
		listMetadataComponents: vi.fn().mockResolvedValue({
			target: { username: "user@example.com" },
			metadataType: "ApexClass",
			apiVersion: "66.0",
			components: [],
			errors: [],
		}),
		getComponentSource: vi.fn().mockResolvedValue({
			target: { username: "user@example.com" },
			metadataType: "ApexClass",
			fullName: "MyClass",
			source: "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ApexClass xmlns=\"http://soap.sforce.com/2006/04/metadata\"></ApexClass>",
		}),
		getCrossOrgComponentDiff: vi.fn().mockResolvedValue({
			source: { username: "source@example.com" },
			target: { username: "target@example.com" },
			results: [
				{
					metadataType: "ApexClass",
					fullName: "MyClass",
					state: "Changed",
				},
			],
		}),
	};
}

function createDeployServiceMock(): DeployServiceApi {
	return {
		startDestructiveDeploy: vi.fn().mockResolvedValue({ operationId: "op-1" }),
		getDestructiveDeployStatus: vi.fn().mockResolvedValue({
			operationId: "op-1",
			status: "running",
			percentComplete: 50,
			message: "InProgress 50% (1/2 components processed)",
		}),
		cancelDestructiveDeploy: vi.fn().mockResolvedValue({
			operationId: "op-1",
			canceled: true,
			message: "Deploy cancel request sent.",
		}),
		startCrossOrgDeploy: vi.fn().mockResolvedValue({ operationId: "xop-1" }),
		getCrossOrgDeployStatus: vi.fn().mockResolvedValue({
			operationId: "xop-1",
			status: "running",
			percentComplete: 20,
			message: "InProgress 20%",
		}),
		cancelCrossOrgDeploy: vi.fn().mockResolvedValue({
			operationId: "xop-1",
			canceled: true,
			message: "Deploy cancel request sent.",
		}),
	};
}

function createRestServiceMock(): RestServiceApi {
	return {
		executeRequest: vi.fn().mockResolvedValue({
			status: 200,
			headers: { "content-type": "application/json" },
			body: { total: 0 },
			isJson: true,
			durationMs: 42,
		}),
	};
}

function createLwcServiceMock(): LwcServiceApi {
	return {
		listBundles: vi.fn().mockResolvedValue({ bundles: [] }),
		getBundle: vi.fn().mockResolvedValue({ bundle: {}, files: [] }),
		deployBundle: vi.fn().mockResolvedValue({
			status: "success",
			durationMs: 100,
			newLastModifiedDate: "2024-01-01T00:01:00.000Z",
		}),
	};
}

function createSoqlServiceMock(): SoqlServiceApi {
	return {
		describeGlobal: vi.fn().mockResolvedValue({ sobjects: [] }),
		describeObject: vi.fn().mockResolvedValue({ sobject: "Account", fields: [] }),
		validateQuery: vi.fn().mockResolvedValue({ valid: true }),
		runQuery: vi.fn().mockResolvedValue({
			records: [],
			totalSize: 0,
			done: true,
		}),
		startBulkQuery: vi.fn().mockResolvedValue({ jobId: "750xx0000000001AAA" }),
		getBulkQueryStatus: vi.fn().mockResolvedValue({ jobId: "750xx0000000001AAA", state: "JobComplete" }),
		getBulkQueryResult: vi.fn().mockResolvedValue("Id,Name\n001,Acme\n"),
	};
}

function createScratchOrgServiceMock(): ScratchOrgServiceApi {
	return {
		startCreate: vi.fn().mockResolvedValue({ operationId: "scratch-op-1" }),
		getStatus: vi.fn().mockResolvedValue({
			operationId: "scratch-op-1",
			status: "running",
			message: "Creating scratch org...",
		}),
		listSnapshots: vi.fn().mockResolvedValue({
			eligibility: "enabled",
			snapshots: [],
		}),
	};
}

const apps: ReturnType<typeof createApp>[] = [];
const TEST_SESSION_TOKEN = "test-session-token";
const TEST_HOST = "localhost:8787";
const TEST_ORIGIN = "http://localhost:8787";

function createTestApp(options: Parameters<typeof createApp>[0] = {}) {
	return createApp({
		sessionToken: TEST_SESSION_TOKEN,
		hostAllowlist: [TEST_HOST, "127.0.0.1:8787"],
		originAllowlist: [TEST_ORIGIN, "http://127.0.0.1:8787"],
		...options,
	});
}

function withApiHeaders(
	request: InjectOptions,
): InjectOptions {
	return {
		...request,
		headers: {
			host: TEST_HOST,
			"x-mavmeta-session": TEST_SESSION_TOKEN,
			...(request.headers as Record<string, string> | undefined),
		},
	};
}

afterEach(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("createApp", () => {
	it("returns health response", async () => {
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "GET",
			url: "/api/health",
		}));

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ status: "ok" });
	});

	it("lists org snapshots for a dev hub via query parameter", async () => {
		const scratchOrgService = createScratchOrgServiceMock();
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
			scratchOrgService,
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "GET",
			url: "/api/orgs/snapshots?devHub=hub%40example.com",
		}));

		expect(response.statusCode).toBe(200);
		expect(scratchOrgService.listSnapshots).toHaveBeenCalledWith("hub@example.com");
	});

	it("rejects snapshot requests without devHub query", async () => {
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
			scratchOrgService: createScratchOrgServiceMock(),
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "GET",
			url: "/api/orgs/snapshots",
		}));

		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({
			code: "INVALID_REQUEST",
			message: 'Missing required field "devHub".',
		});
	});

	it("validates org target requests with structured errors", async () => {
		const orgService = createOrgServiceMock();
		const app = createTestApp({
			orgService,
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/orgs/open",
			payload: { username: "" },
		}));

		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({
			code: "INVALID_REQUEST",
			message: 'Field "username" must be a non-empty string.',
		});
		expect(orgService.openOrg).not.toHaveBeenCalled();
	});

	it("rejects invalid startPath for org open requests", async () => {
		const orgService = createOrgServiceMock();
		const app = createTestApp({
			orgService,
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/orgs/open",
			payload: { username: "user@example.com", startPath: "lightning/setup/DeployStatus/home" },
		}));

		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({
			code: "INVALID_REQUEST",
			message: 'Field "startPath" must start with "/".',
		});
		expect(orgService.openOrg).not.toHaveBeenCalled();
	});

	it("calls reauth endpoint with parsed target", async () => {
		const orgService = createOrgServiceMock();
		const app = createTestApp({
			orgService,
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/orgs/reauth",
			payload: { username: "user@example.com" },
		}));

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ message: "reauth" });
		expect(orgService.reauthOrg).toHaveBeenCalledWith({
			username: "user@example.com",
		});
	});

	it("passes metadata components request to service", async () => {
		const metadataService = createMetadataServiceMock();
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService,
			deployService: createDeployServiceMock(),
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/metadata/components",
			payload: {
				target: { username: "user@example.com" },
				metadataType: "ApexClass",
				search: "controller",
			},
		}));

		expect(response.statusCode).toBe(200);
		expect(metadataService.listMetadataComponents).toHaveBeenCalledWith({
			target: { username: "user@example.com" },
			metadataType: "ApexClass",
			search: "controller",
			folder: undefined,
		});
	});

	it("passes get component source request to service", async () => {
		const metadataService = createMetadataServiceMock();
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService,
			deployService: createDeployServiceMock(),
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/metadata/component-source",
			payload: {
				target: { username: "user@example.com" },
				metadataType: "ApexClass",
				fullName: "MyClass",
			},
		}));

		expect(response.statusCode).toBe(200);
		expect(metadataService.getComponentSource).toHaveBeenCalledWith({
			target: { username: "user@example.com" },
			metadataType: "ApexClass",
			fullName: "MyClass",
			fileName: undefined,
			folder: undefined,
		});
	});

	it("passes cross-org metadata diff request to service", async () => {
		const metadataService = createMetadataServiceMock();
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService,
			deployService: createDeployServiceMock(),
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/metadata/diff",
			payload: {
				source: { username: "source@example.com" },
				target: { username: "target@example.com" },
				components: [{ metadataType: "ApexClass", fullName: "MyClass" }],
			},
		}));

		expect(response.statusCode).toBe(200);
		expect(metadataService.getCrossOrgComponentDiff).toHaveBeenCalledWith({
			source: { username: "source@example.com" },
			target: { username: "target@example.com" },
			components: [
				{
					metadataType: "ApexClass",
					fullName: "MyClass",
					fileName: undefined,
					folder: undefined,
				},
			],
		});
	});

	it("starts destructive deploy with validated payload", async () => {
		const deployService = createDeployServiceMock();
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService,
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/deploy/start",
			payload: {
				target: { username: "user@example.com" },
				mode: "validate",
				components: [{ metadataType: "ApexClass", fullName: "MyClass" }],
			},
		}));

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ operationId: "op-1" });
		expect(deployService.startDestructiveDeploy).toHaveBeenCalledWith({
			target: { username: "user@example.com" },
			mode: "validate",
			components: [{ metadataType: "ApexClass", fullName: "MyClass" }],
		});
	});

	it("rejects destructive deploy with invalid metadata fullName", async () => {
		const deployService = createDeployServiceMock();
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService,
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/deploy/start",
			payload: {
				target: { username: "user@example.com" },
				mode: "validate",
				components: [{ metadataType: "ApexClass", fullName: "Bad<Name" }],
			},
		}));

		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({
			code: "INVALID_REQUEST",
			message: "Component at index 0 has invalid fullName.",
		});
		expect(deployService.startDestructiveDeploy).not.toHaveBeenCalled();
	});

	it("starts cross-org deploy with validated payload", async () => {
		const deployService = createDeployServiceMock();
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService,
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/deploy/cross-org/start",
			payload: {
				source: { username: "source@example.com" },
				target: { username: "target@example.com" },
				mode: "validate",
				components: [{ metadataType: "ApexClass", fullName: "MyClass" }],
			},
		}));

		expect(response.statusCode).toBe(200);
		expect(deployService.startCrossOrgDeploy).toHaveBeenCalledWith({
			source: { username: "source@example.com" },
			target: { username: "target@example.com" },
			mode: "validate",
			components: [{ metadataType: "ApexClass", fullName: "MyClass" }],
		});
	});

	it("fetches cross-org deploy status", async () => {
		const deployService = createDeployServiceMock();
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService,
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/deploy/cross-org/status",
			payload: { operationId: "xop-1" },
		}));

		expect(response.statusCode).toBe(200);
		expect(deployService.getCrossOrgDeployStatus).toHaveBeenCalledWith("xop-1");
	});

	it("cancels cross-org deploy operation", async () => {
		const deployService = createDeployServiceMock();
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService,
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/deploy/cross-org/cancel",
			payload: { operationId: "xop-1" },
		}));

		expect(response.statusCode).toBe(200);
		expect(deployService.cancelCrossOrgDeploy).toHaveBeenCalledWith("xop-1");
	});

	it("calls rest execute endpoint with parsed request", async () => {
		const restService = createRestServiceMock();
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
			restService,
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/rest/execute",
			payload: {
				username: "user@example.com",
				method: "GET",
				path: "/services/data/v62.0/limits",
			},
		}));

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({ status: 200, isJson: true });
		expect(restService.executeRequest).toHaveBeenCalledWith({
			username: "user@example.com",
			method: "GET",
			path: "/services/data/v62.0/limits",
			headers: undefined,
			body: undefined,
		});
	});

	it("calls soql describe-global endpoint", async () => {
		const soqlService = createSoqlServiceMock();
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
			soqlService,
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/soql/describe-global",
			payload: { username: "user@example.com", api: "rest" },
		}));

		expect(response.statusCode).toBe(200);
		expect(soqlService.describeGlobal).toHaveBeenCalledWith({
			username: "user@example.com",
			api: "rest",
		});
	});

	it("rejects soql describe-global with invalid api", async () => {
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
			soqlService: createSoqlServiceMock(),
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/soql/describe-global",
			payload: { username: "user@example.com", api: "metadata" },
		}));

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({ code: "INVALID_REQUEST" });
	});

	it("rejects soql run with invalid nextRecordsUrl", async () => {
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
			soqlService: createSoqlServiceMock(),
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/soql/run",
			payload: {
				username: "user@example.com",
				api: "rest",
				soql: "SELECT Id FROM Account",
				nextRecordsUrl: "services/data/v62.0/query/01g...",
			},
		}));

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({ code: "INVALID_REQUEST" });
	});

	it("rejects rest execute with invalid method", async () => {
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
			restService: createRestServiceMock(),
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/rest/execute",
			payload: {
				username: "user@example.com",
				method: "PUT",
				path: "/services/data/v62.0/limits",
			},
		}));

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({ code: "INVALID_REQUEST" });
	});

	it("rejects rest execute with missing username", async () => {
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
			restService: createRestServiceMock(),
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/rest/execute",
			payload: {
				method: "GET",
				path: "/services/data/v62.0/limits",
			},
		}));

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({ code: "INVALID_REQUEST" });
	});

	it("calls lwc list bundles endpoint", async () => {
		const lwcService = createLwcServiceMock();
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
			lwcService,
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/lwc/bundles/list",
			payload: { orgUsername: "user@example.com" },
		}));

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ bundles: [] });
		expect(lwcService.listBundles).toHaveBeenCalledWith({ orgUsername: "user@example.com" });
	});

	it("rejects lwc list bundles with missing orgUsername", async () => {
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
			lwcService: createLwcServiceMock(),
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/lwc/bundles/list",
			payload: {},
		}));

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({ code: "INVALID_REQUEST" });
	});

	it("calls lwc get bundle endpoint", async () => {
		const lwcService = createLwcServiceMock();
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
			lwcService,
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/lwc/bundles/get",
			payload: { orgUsername: "user@example.com", bundleId: "001000000000001AAA" },
		}));

		expect(response.statusCode).toBe(200);
		expect(lwcService.getBundle).toHaveBeenCalledWith({
			orgUsername: "user@example.com",
			bundleId: "001000000000001AAA",
		});
	});

	it("calls lwc deploy bundle endpoint and passes force flag", async () => {
		const lwcService = createLwcServiceMock();
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
			lwcService,
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/lwc/bundles/deploy",
			payload: {
				orgUsername: "user@example.com",
				bundleId: "001000000000001AAA",
				files: [{ path: "lwc/foo/foo.js", source: "updated" }],
				expectedLastModifiedDate: "2024-01-01T00:00:00.000Z",
				force: true,
			},
		}));

		expect(response.statusCode).toBe(200);
		expect(lwcService.deployBundle).toHaveBeenCalledWith(
			expect.objectContaining({ force: true }),
		);
	});

	it("rejects lwc deploy with missing files array", async () => {
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
			lwcService: createLwcServiceMock(),
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/lwc/bundles/deploy",
			payload: {
				orgUsername: "user@example.com",
				bundleId: "001000000000001AAA",
				expectedLastModifiedDate: "2024-01-01T00:00:00.000Z",
			},
		}));

		expect(response.statusCode).toBe(400);
		expect(response.json()).toMatchObject({ code: "INVALID_REQUEST" });
	});

	it("rejects api calls without matching session token", async () => {
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
			sessionToken: "expected-session-token",
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "GET",
			url: "/api/orgs",
			headers: {
				"x-mavmeta-session": "wrong-session-token",
			},
		}));

		expect(response.statusCode).toBe(401);
		expect(response.json()).toEqual({
			code: "INVALID_SESSION",
			message: "Invalid or missing session token.",
		});
	});

	it("rejects requests with an invalid host header after listen", async () => {
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
			hostAllowlist: ["127.0.0.1:8787", "localhost:8787"],
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "GET",
			url: "/api/health",
			headers: {
				host: "evil.example.com",
			},
		}));

		expect(response.statusCode).toBe(403);
		expect(response.json()).toEqual({
			code: "INVALID_HOST",
			message: "Host header is not allowed.",
		});
	});

	it("sets security headers on responses", async () => {
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "GET",
			url: "/api/health",
		}));

		expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
		expect(response.headers["x-frame-options"]).toBe("DENY");
		expect(response.headers["x-content-type-options"]).toBe("nosniff");
	});

	it("redacts secrets in structured error messages", async () => {
		const orgService = createOrgServiceMock();
		orgService.openOrg = vi
			.fn()
			.mockRejectedValue(
				new Error("Authorization: Bearer super-secret-token-value"),
			);
		const app = createTestApp({
			orgService,
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/orgs/open",
			payload: { username: "user@example.com" },
		}));

		expect(response.statusCode).toBe(500);
		expect(response.json()).toMatchObject({
			code: "INTERNAL_ERROR",
		});
		expect(response.json().message).toContain("[REDACTED]");
		expect(response.body).not.toContain("super-secret-token-value");
	});

	it("returns 405 for unsupported API methods", async () => {
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "PUT",
			url: "/api/orgs",
		}));

		expect(response.statusCode).toBe(405);
		expect(response.json()).toEqual({
			code: "METHOD_NOT_ALLOWED",
			message: "HTTP method is not allowed for API routes.",
		});
	});

	it("rejects disallowed origin headers", async () => {
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
		});
		apps.push(app);

		const response = await app.inject(withApiHeaders({
			method: "POST",
			url: "/api/orgs/open",
			headers: {
				origin: "https://evil.example.com",
			},
			payload: {
				username: "user@example.com",
			},
		}));

		expect(response.statusCode).toBe(403);
		expect(response.json()).toEqual({
			code: "INVALID_ORIGIN",
			message: "Origin is not allowed.",
		});
	});

	it("accepts configured dev origin even when server address is available", async () => {
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
			allowDevSessionBootstrap: true,
			originAllowlist: ["http://localhost:5173"],
		});
		apps.push(app);
		vi.spyOn(app.server, "address").mockReturnValue({
			address: "127.0.0.1",
			port: 8787,
			family: "IPv4",
		} as unknown as ReturnType<typeof app.server.address>);

		const response = await app.inject({
			method: "GET",
			url: "/api/session",
			headers: {
				host: TEST_HOST,
				origin: "http://localhost:5173",
				"x-mavmeta-bootstrap": "1",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ token: TEST_SESSION_TOKEN });
	});

	it("accepts configured dev host even when server address is available", async () => {
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
			allowDevSessionBootstrap: true,
			hostAllowlist: ["localhost:5173"],
		});
		apps.push(app);
		vi.spyOn(app.server, "address").mockReturnValue({
			address: "127.0.0.1",
			port: 8787,
			family: "IPv4",
		} as unknown as ReturnType<typeof app.server.address>);

		const response = await app.inject({
			method: "GET",
			url: "/api/session",
			headers: {
				host: "localhost:5173",
				origin: TEST_ORIGIN,
				"x-mavmeta-bootstrap": "1",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ token: TEST_SESSION_TOKEN });
	});

	it("requires session token on health endpoint", async () => {
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
		});
		apps.push(app);

		const response = await app.inject({
			method: "GET",
			url: "/api/health",
			headers: {
				host: TEST_HOST,
			},
		});

		expect(response.statusCode).toBe(401);
		expect(response.json()).toEqual({
			code: "INVALID_SESSION",
			message: "Invalid or missing session token.",
		});
	});

	it("exposes /api/session in dev bootstrap mode", async () => {
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
			allowDevSessionBootstrap: true,
		});
		apps.push(app);

		const response = await app.inject({
			method: "GET",
			url: "/api/session",
			headers: {
				host: TEST_HOST,
				origin: TEST_ORIGIN,
				"x-mavmeta-bootstrap": "1",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ token: TEST_SESSION_TOKEN });
	});

	it("requires bootstrap header for /api/session", async () => {
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
			allowDevSessionBootstrap: true,
		});
		apps.push(app);

		const response = await app.inject({
			method: "GET",
			url: "/api/session",
			headers: {
				host: TEST_HOST,
				origin: TEST_ORIGIN,
			},
		});

		expect(response.statusCode).toBe(400);
		expect(response.json()).toEqual({
			code: "INVALID_BOOTSTRAP",
			message: "Missing required bootstrap header.",
		});
	});

	it("allows /api/session when origin header is missing", async () => {
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
			allowDevSessionBootstrap: true,
		});
		apps.push(app);

		const response = await app.inject({
			method: "GET",
			url: "/api/session",
			headers: {
				host: TEST_HOST,
				"x-mavmeta-bootstrap": "1",
			},
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ token: TEST_SESSION_TOKEN });
	});

	it("rejects /api/session when origin is not allowlisted", async () => {
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
			allowDevSessionBootstrap: true,
		});
		apps.push(app);

		const response = await app.inject({
			method: "GET",
			url: "/api/session",
			headers: {
				host: TEST_HOST,
				origin: "https://evil.example.com",
				"x-mavmeta-bootstrap": "1",
			},
		});

		expect(response.statusCode).toBe(403);
		expect(response.json()).toEqual({
			code: "INVALID_ORIGIN",
			message: "Origin is not allowed.",
		});
	});

	it("returns 404 for /api/session when dev bootstrap is disabled", async () => {
		const app = createTestApp({
			orgService: createOrgServiceMock(),
			metadataService: createMetadataServiceMock(),
			deployService: createDeployServiceMock(),
			allowDevSessionBootstrap: false,
		});
		apps.push(app);

		const response = await app.inject({
			method: "GET",
			url: "/api/session",
			headers: {
				host: TEST_HOST,
				origin: TEST_ORIGIN,
				"x-mavmeta-session": TEST_SESSION_TOKEN,
			},
		});

		expect(response.statusCode).toBe(404);
	});

	it("serves static index with injected session meta tag", async () => {
		const staticRoot = mkdtempSync(join(tmpdir(), "mavmeta-static-"));
		writeFileSync(
			join(staticRoot, "index.html"),
			"<!doctype html><html><head><title>RF</title></head><body><div id=\"app\"></div></body></html>",
			"utf8",
		);

		try {
			const app = createTestApp({
				orgService: createOrgServiceMock(),
				metadataService: createMetadataServiceMock(),
				deployService: createDeployServiceMock(),
				serveStatic: true,
				staticRootDir: staticRoot,
			});
			apps.push(app);

			const response = await app.inject(withApiHeaders({
				method: "GET",
				url: "/",
			}));

			expect(response.statusCode).toBe(200);
			expect(response.headers["content-type"]).toContain("text/html");
			expect(response.body).toContain(
				`<meta name="MavMeta-session" content="${TEST_SESSION_TOKEN}">`,
			);
		} finally {
			rmSync(staticRoot, { recursive: true, force: true });
		}
	});
});
