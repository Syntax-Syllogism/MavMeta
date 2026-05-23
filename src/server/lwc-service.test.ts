import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api-error";
import { LwcService } from "./lwc-service";

type MockSobject = {
	update: ReturnType<typeof vi.fn>;
};

type MockTooling = {
	query: any;
	sobject: any;
	_sobjects: Map<string, MockSobject>;
};

function makeSobject(): MockSobject {
	return {
		update: vi.fn().mockResolvedValue(undefined),
	};
}

function makeTooling(): MockTooling {
	const sobjects = new Map<string, MockSobject>();
	const tooling: MockTooling = {
		query: vi.fn(),
		sobject: vi.fn((type: string) => {
			if (!sobjects.has(type)) {
				sobjects.set(type, makeSobject());
			}
			return sobjects.get(type)!;
		}),
		_sobjects: sobjects,
	};
	return tooling;
}

function makeConnectionFactory(tooling: MockTooling) {
	return vi.fn().mockResolvedValue({ tooling });
}

const BUNDLE_ID = "001000000000001AAA";
const RESOURCE_ID = "002000000000001AAA";

const bundleRecord = {
	Id: BUNDLE_ID,
	DeveloperName: "helloWorld",
	MasterLabel: "Hello World",
	NamespacePrefix: null,
	ApiVersion: 62,
	LastModifiedDate: "2024-01-01T00:00:00.000Z",
	LastModifiedBy: { Name: "Admin User" },
};

const resourceRecord = {
	Id: RESOURCE_ID,
	FilePath: "lwc/helloWorld/helloWorld.js",
	Format: "js",
	Source: "import { LightningElement } from 'lwc';",
	LastModifiedDate: "2024-01-01T00:00:00.000Z",
};

describe("LwcService.listBundles", () => {
	let tooling: MockTooling;
	let service: LwcService;

	beforeEach(() => {
		tooling = makeTooling();
		service = new LwcService({ connectionFactory: makeConnectionFactory(tooling) });
	});

	it("issues the correct SOQL and maps results", async () => {
		tooling.query.mockResolvedValue({ records: [bundleRecord] });

		const result = await service.listBundles({ orgUsername: "user@example.com" });

		expect(tooling.query).toHaveBeenCalledWith(
			expect.stringContaining("FROM LightningComponentBundle"),
		);
		expect(result.bundles).toHaveLength(1);
		expect(result.bundles[0].developerName).toBe("helloWorld");
		expect(result.bundles[0].masterLabel).toBe("Hello World");
		expect(result.bundles[0].namespacePrefix).toBeNull();
	});

	it("returns empty array when no bundles exist", async () => {
		tooling.query.mockResolvedValue({ records: [] });

		const result = await service.listBundles({ orgUsername: "user@example.com" });
		expect(result.bundles).toEqual([]);
	});

	it("passes namespace prefix through", async () => {
		tooling.query.mockResolvedValue({
			records: [{ ...bundleRecord, NamespacePrefix: "myns" }],
		});

		const result = await service.listBundles({ orgUsername: "user@example.com" });
		expect(result.bundles[0].namespacePrefix).toBe("myns");
	});
});

describe("LwcService.getBundle", () => {
	let tooling: MockTooling;
	let service: LwcService;

	beforeEach(() => {
		tooling = makeTooling();
		service = new LwcService({ connectionFactory: makeConnectionFactory(tooling) });
	});

	it("rejects invalid bundle IDs", async () => {
		await expect(
			service.getBundle({ orgUsername: "user@example.com", bundleId: "bad-id!" }),
		).rejects.toBeInstanceOf(ApiError);
	});

	it("maps resources to LwcFile[]", async () => {
		tooling.query
			.mockResolvedValueOnce({ records: [bundleRecord] })
			.mockResolvedValueOnce({ records: [resourceRecord] });

		const result = await service.getBundle({
			orgUsername: "user@example.com",
			bundleId: BUNDLE_ID,
		});

		expect(result.bundle.developerName).toBe("helloWorld");
		expect(result.files).toHaveLength(1);
		expect(result.files[0].filePath).toBe("lwc/helloWorld/helloWorld.js");
		expect(result.files[0].source).toBe("import { LightningElement } from 'lwc';");
	});

	it("throws 404 when bundle not found", async () => {
		tooling.query.mockResolvedValueOnce({ records: [] }).mockResolvedValueOnce({ records: [] });

		await expect(
			service.getBundle({ orgUsername: "user@example.com", bundleId: BUNDLE_ID }),
		).rejects.toBeInstanceOf(ApiError);
	});
});

describe("LwcService.deployBundle", () => {
	let tooling: MockTooling;
	let service: LwcService;

	const validBundleId = BUNDLE_ID;
	const expectedDate = "2024-01-01T00:00:00.000Z";
	const deployRequest = {
		orgUsername: "user@example.com",
		bundleId: validBundleId,
		files: [{ path: "lwc/helloWorld/helloWorld.js", source: "updated source" }],
		expectedLastModifiedDate: expectedDate,
	};

	beforeEach(() => {
		tooling = makeTooling();
		service = new LwcService({ connectionFactory: makeConnectionFactory(tooling) });

		// Default happy path: conflict check (not newer) → resources → post-deploy date
		tooling.query
			.mockResolvedValueOnce({ records: [{ LastModifiedDate: expectedDate }] })
			.mockResolvedValueOnce({
				records: [{ Id: RESOURCE_ID, FilePath: "lwc/helloWorld/helloWorld.js" }],
			})
			.mockResolvedValueOnce({ records: [{ LastModifiedDate: "2024-01-01T00:01:00.000Z" }] });
	});

	it("returns success and the new LastModifiedDate", async () => {
		const result = await service.deployBundle(deployRequest);

		expect(result.status).toBe("success");
		if (result.status === "success") {
			expect(result.durationMs).toBeGreaterThanOrEqual(0);
			expect(result.newLastModifiedDate).toBe("2024-01-01T00:01:00.000Z");
		}
	});

	it("calls update on LightningComponentResource with correct Id and Source", async () => {
		await service.deployBundle(deployRequest);

		expect(tooling.sobject("LightningComponentResource").update).toHaveBeenCalledWith({
			Id: RESOURCE_ID,
			Source: "updated source",
		});
	});

	it("returns error for files with no matching resource on the org", async () => {
		tooling.query
			.mockReset()
			.mockResolvedValueOnce({ records: [{ LastModifiedDate: expectedDate }] })
			// No matching resource for the requested file path
			.mockResolvedValueOnce({ records: [] });

		const result = await service.deployBundle(deployRequest);

		expect(result.status).toBe("error");
		if (result.status === "error") {
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0].filePath).toBe("lwc/helloWorld/helloWorld.js");
			expect(result.errors[0].message).toContain("Resource not found on org");
		}
		expect(tooling.sobject("LightningComponentResource").update).not.toHaveBeenCalled();
	});

	it("returns conflict when org is newer than expectedLastModifiedDate", async () => {
		const newerDate = "2024-06-01T00:00:00.000Z";
		tooling.query
			.mockReset()
			.mockResolvedValueOnce({ records: [{ LastModifiedDate: newerDate }] })
			.mockResolvedValueOnce({ records: [{ FilePath: "lwc/helloWorld/helloWorld.js" }] });

		const result = await service.deployBundle(deployRequest);

		expect(result.status).toBe("conflict");
		if (result.status === "conflict") {
			expect(result.currentLastModifiedDate).toBe(newerDate);
			expect(result.changedFiles).toContain("lwc/helloWorld/helloWorld.js");
		}
		expect(tooling.sobject("LightningComponentResource").update).not.toHaveBeenCalled();
	});

	it("bypasses conflict check when force=true", async () => {
		tooling.query
			.mockReset()
			// Existing resources (no conflict query)
			.mockResolvedValueOnce({
				records: [{ Id: RESOURCE_ID, FilePath: "lwc/helloWorld/helloWorld.js" }],
			})
			// Post-deploy date
			.mockResolvedValueOnce({ records: [{ LastModifiedDate: "2024-01-01T00:01:00.000Z" }] });

		const result = await service.deployBundle({ ...deployRequest, force: true });

		expect(result.status).toBe("success");
		// Only 2 queries: resources + post-deploy (no conflict check)
		expect(tooling.query).toHaveBeenCalledTimes(2);
	});

	it("returns parsed compile errors when the update throws an LWC error", async () => {
		tooling.query
			.mockReset()
			.mockResolvedValueOnce({ records: [{ LastModifiedDate: expectedDate }] })
			.mockResolvedValueOnce({
				records: [{ Id: RESOURCE_ID, FilePath: "lwc/helloWorld/helloWorld.js" }],
			});

		tooling
			.sobject("LightningComponentResource")
			.update.mockRejectedValue(
				new Error("LWC1099: 'badVar' is not defined.\n  lwc/helloWorld/helloWorld.js:5:3"),
			);

		const result = await service.deployBundle(deployRequest);

		expect(result.status).toBe("error");
		if (result.status === "error") {
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0].message).toBe("'badVar' is not defined.");
			expect(result.errors[0].filePath).toBe("lwc/helloWorld/helloWorld.js");
			expect(result.errors[0].line).toBe(5);
			expect(result.errors[0].column).toBe(3);
			expect(result.errors[0].severity).toBe("error");
		}
	});

	it("returns a generic error entry when the thrown message has no LWC pattern", async () => {
		tooling.query
			.mockReset()
			.mockResolvedValueOnce({ records: [{ LastModifiedDate: expectedDate }] })
			.mockResolvedValueOnce({
				records: [{ Id: RESOURCE_ID, FilePath: "lwc/helloWorld/helloWorld.js" }],
			});

		tooling
			.sobject("LightningComponentResource")
			.update.mockRejectedValue(new Error("UNKNOWN_EXCEPTION: Something went wrong"));

		const result = await service.deployBundle(deployRequest);

		expect(result.status).toBe("error");
		if (result.status === "error") {
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0].message).toBe("UNKNOWN_EXCEPTION: Something went wrong");
			expect(result.errors[0].filePath).toBe("");
		}
	});

	it("rejects invalid bundle IDs", async () => {
		await expect(
			service.deployBundle({ ...deployRequest, bundleId: "not-a-real-id!!!" }),
		).rejects.toBeInstanceOf(ApiError);
	});
});
