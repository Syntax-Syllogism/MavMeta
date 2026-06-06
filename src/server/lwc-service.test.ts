import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api-error";
import { LwcService } from "./lwc-service";

// ---------------------------------------------------------------------------
// Mock types
// ---------------------------------------------------------------------------

type MockSobject = {
	update: ReturnType<typeof vi.fn>;
};

type MockTooling = {
	query: any;
	sobject: any;
	_sobjects: Map<string, MockSobject>;
};

type MockMetadata = {
	deploy: ReturnType<typeof vi.fn>;
	checkDeployStatus: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

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

function makeMetadata(): MockMetadata {
	return {
		deploy: vi.fn().mockResolvedValue({ id: "0Af000000000001AAA" }),
		checkDeployStatus: vi.fn().mockResolvedValue({ status: "Succeeded" }),
	};
}

function makeConnectionFactory(tooling: MockTooling, metadata?: MockMetadata) {
	return vi.fn().mockResolvedValue({ tooling, metadata: metadata ?? makeMetadata() });
}

/** Creates an LwcService with 0ms sleep so metadata-deploy tests are instant. */
function makeServiceWithMocks(tooling: MockTooling, metadata?: MockMetadata) {
	const meta = metadata ?? makeMetadata();
	return {
		service: new LwcService({
			connectionFactory: makeConnectionFactory(tooling, meta),
			sleep: () => Promise.resolve(),
			metadataDeployPollIntervalMs: 0,
			metadataDeployTimeoutMs: 5000,
		}),
		meta,
	};
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// LwcService.listBundles
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// LwcService.getBundle
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// LwcService.deployBundle — Tooling API happy path
// ---------------------------------------------------------------------------

describe("LwcService.deployBundle (Tooling happy path)", () => {
	let tooling: MockTooling;
	let service: LwcService;

	const expectedDate = "2024-01-01T00:00:00.000Z";
	const deployRequest = {
		orgUsername: "user@example.com",
		bundleId: BUNDLE_ID,
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

// ---------------------------------------------------------------------------
// LwcService.deployBundle — Metadata API fallback
// ---------------------------------------------------------------------------

describe("LwcService.deployBundle (Metadata API fallback)", () => {
	const expectedDate = "2024-01-01T00:00:00.000Z";
	const newDate = "2024-01-01T00:05:00.000Z";

	/** Builds a tooling mock pre-wired for the schema-ref-bug trigger path. */
	function makeToolingForFallback() {
		const t = makeTooling();
		// conflict check → not newer
		// resources (IdByPath)
		// bundle info (DeveloperName etc.)
		// all resources (for zip)
		// post-deploy bundle LastModifiedDate
		t.query
			.mockResolvedValueOnce({ records: [{ LastModifiedDate: expectedDate }] }) // conflict
			.mockResolvedValueOnce({
				// IdByPath
				records: [{ Id: RESOURCE_ID, FilePath: "lwc/helloWorld/helloWorld.js" }],
			})
			.mockResolvedValueOnce({
				// bundle info — ApiVersion is a number as the Tooling API returns it
				records: [
					{
						DeveloperName: "helloWorld",
						ApiVersion: 62,
					},
				],
			})
			.mockResolvedValueOnce({
				// all resources for zip
				records: [
					{
						FilePath: "lwc/helloWorld/helloWorld.js",
						Source: "original source",
						Format: "js",
					},
					{
						FilePath: "lwc/helloWorld/helloWorld.html",
						Source: "<template></template>",
						Format: "html",
					},
				],
			})
			.mockResolvedValueOnce({ records: [{ LastModifiedDate: newDate }] }); // post-deploy

		// The Tooling update throws the schema-ref bug error.
		t.sobject("LightningComponentResource").update.mockRejectedValue(
			new Error(
				"Invalid reference CustomObject__c.CustomField__c of type sobjectField in file helloWorld.js: Source",
			),
		);
		return t;
	}

	// -------------------------------------------------------------------------
	// 1. Does NOT fall back on genuine compile errors
	// -------------------------------------------------------------------------
	it("does not fall back to Metadata API on genuine LWC compile errors", async () => {
		const tooling = makeTooling();
		const { service, meta } = makeServiceWithMocks(tooling);

		tooling.query
			.mockResolvedValueOnce({ records: [{ LastModifiedDate: expectedDate }] })
			.mockResolvedValueOnce({
				records: [{ Id: RESOURCE_ID, FilePath: "lwc/helloWorld/helloWorld.js" }],
			});

		tooling
			.sobject("LightningComponentResource")
			.update.mockRejectedValue(
				new Error("LWC1099: 'badVar' is not defined.\n  lwc/helloWorld/helloWorld.js:5:3"),
			);

		const result = await service.deployBundle({
			orgUsername: "user@example.com",
			bundleId: BUNDLE_ID,
			files: [{ path: "lwc/helloWorld/helloWorld.js", source: "bad source" }],
			expectedLastModifiedDate: expectedDate,
		});

		expect(result.status).toBe("error");
		// Metadata deploy must never be invoked
		expect(meta.deploy).not.toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// 2. Triggers fallback on the schema-ref bug signature (message form)
	// -------------------------------------------------------------------------
	it("triggers Metadata API fallback when Tooling fails with schema-ref bug message", async () => {
		const tooling = makeToolingForFallback();
		const { service, meta } = makeServiceWithMocks(tooling);

		meta.checkDeployStatus.mockResolvedValue({ status: "Succeeded" });

		const result = await service.deployBundle({
			orgUsername: "user@example.com",
			bundleId: BUNDLE_ID,
			files: [{ path: "lwc/helloWorld/helloWorld.js", source: "new source" }],
			expectedLastModifiedDate: expectedDate,
		});

		expect(result.status).toBe("success");
		expect(meta.deploy).toHaveBeenCalledOnce();
	});

	// -------------------------------------------------------------------------
	// 3. Triggers fallback when error has FIELD_INTEGRITY_EXCEPTION errorCode
	// -------------------------------------------------------------------------
	it("triggers fallback when error object has FIELD_INTEGRITY_EXCEPTION errorCode", async () => {
		const tooling = makeToolingForFallback();
		const { service, meta } = makeServiceWithMocks(tooling);

		meta.checkDeployStatus.mockResolvedValue({ status: "Succeeded" });

		const fieError = Object.assign(new Error("Field integrity error"), {
			errorCode: "FIELD_INTEGRITY_EXCEPTION",
		});
		tooling.sobject("LightningComponentResource").update.mockRejectedValue(fieError);

		const result = await service.deployBundle({
			orgUsername: "user@example.com",
			bundleId: BUNDLE_ID,
			files: [{ path: "lwc/helloWorld/helloWorld.js", source: "new source" }],
			expectedLastModifiedDate: expectedDate,
		});

		expect(result.status).toBe("success");
		expect(meta.deploy).toHaveBeenCalledOnce();
	});

	// -------------------------------------------------------------------------
	// 4. Fallback success — newLastModifiedDate from post-deploy query
	// -------------------------------------------------------------------------
	it("returns success with post-deploy newLastModifiedDate on Metadata fallback success", async () => {
		const tooling = makeToolingForFallback();
		const { service, meta } = makeServiceWithMocks(tooling);

		meta.deploy.mockResolvedValue({ id: "0Af000000000099AAA" });
		meta.checkDeployStatus.mockResolvedValue({ status: "Succeeded" });

		const result = await service.deployBundle({
			orgUsername: "user@example.com",
			bundleId: BUNDLE_ID,
			files: [{ path: "lwc/helloWorld/helloWorld.js", source: "new source" }],
			expectedLastModifiedDate: expectedDate,
		});

		expect(result.status).toBe("success");
		if (result.status === "success") {
			expect(result.newLastModifiedDate).toBe(newDate);
		}
	});

	// -------------------------------------------------------------------------
	// 5. Fallback failure — user sees the Metadata error, not the Tooling error
	// -------------------------------------------------------------------------
	it("surfaces Metadata API error (not Tooling error) when both APIs fail", async () => {
		const tooling = makeToolingForFallback();
		const { service, meta } = makeServiceWithMocks(tooling);

		meta.deploy.mockResolvedValue({ id: "0Af000000000099AAA" });
		meta.checkDeployStatus.mockResolvedValue({
			status: "Failed",
			details: {
				componentFailures: [
					{
						componentType: "LightningComponentBundle",
						fullName: "helloWorld",
						problem: "Compile error: unexpected token",
						fileName: "lwc/helloWorld/helloWorld.js",
					},
				],
			},
		});

		const result = await service.deployBundle({
			orgUsername: "user@example.com",
			bundleId: BUNDLE_ID,
			files: [{ path: "lwc/helloWorld/helloWorld.js", source: "bad source" }],
			expectedLastModifiedDate: expectedDate,
		});

		expect(result.status).toBe("error");
		if (result.status === "error") {
			// Must be the Metadata error, not the Tooling schema-ref message
			expect(result.errors[0].message).toBe("Compile error: unexpected token");
			expect(result.errors[0].message).not.toContain("sobjectField");
		}
	});

	// -------------------------------------------------------------------------
	// 6. Zip construction — correct files overlaid + package.xml
	// -------------------------------------------------------------------------
	it("builds deploy zip with edited source overlaid and package.xml", async () => {
		const tooling = makeToolingForFallback();
		const { service, meta } = makeServiceWithMocks(tooling);

		meta.checkDeployStatus.mockResolvedValue({ status: "Succeeded" });

		let capturedZip: Buffer | undefined;
		meta.deploy.mockImplementation(async (zip: Buffer) => {
			capturedZip = zip;
			return { id: "0Af000000000099AAA" };
		});

		await service.deployBundle({
			orgUsername: "user@example.com",
			bundleId: BUNDLE_ID,
			files: [{ path: "lwc/helloWorld/helloWorld.js", source: "/* edited */" }],
			expectedLastModifiedDate: expectedDate,
		});

		expect(capturedZip).toBeDefined();
		const loaded = await JSZip.loadAsync(capturedZip!);

		// Edited file — should have the new source
		const jsFile = loaded.file("lwc/helloWorld/helloWorld.js");
		expect(jsFile).not.toBeNull();
		const jsSource = await jsFile!.async("text");
		expect(jsSource).toBe("/* edited */");

		// Untouched file — should retain original source
		const htmlFile = loaded.file("lwc/helloWorld/helloWorld.html");
		expect(htmlFile).not.toBeNull();
		const htmlSource = await htmlFile!.async("text");
		expect(htmlSource).toBe("<template></template>");

		// package.xml must name the bundle and api version
		const pkgFile = loaded.file("package.xml");
		expect(pkgFile).not.toBeNull();
		const pkgXml = await pkgFile!.async("text");
		expect(pkgXml).toContain("LightningComponentBundle");
		expect(pkgXml).toContain("helloWorld");
		expect(pkgXml).toContain("62.0");
	});

	// -------------------------------------------------------------------------
	// 7. Timeout — polling never completes within ceiling
	// -------------------------------------------------------------------------
	it("returns a timeout error when the Metadata deploy job never reaches a terminal state", async () => {
		const tooling = makeToolingForFallback();
		const meta = makeMetadata();
		const service = new LwcService({
			connectionFactory: makeConnectionFactory(tooling, meta),
			sleep: () => Promise.resolve(),
			metadataDeployPollIntervalMs: 0,
			metadataDeployTimeoutMs: 0, // expires immediately
		});

		meta.deploy.mockResolvedValue({ id: "0Af000000000099AAA" });
		// Always InProgress — never terminal
		meta.checkDeployStatus.mockResolvedValue({ status: "InProgress" });

		const result = await service.deployBundle({
			orgUsername: "user@example.com",
			bundleId: BUNDLE_ID,
			files: [{ path: "lwc/helloWorld/helloWorld.js", source: "new source" }],
			expectedLastModifiedDate: expectedDate,
		});

		expect(result.status).toBe("error");
		if (result.status === "error") {
			expect(result.errors[0].message).toContain("timed out");
		}
	});

	// -------------------------------------------------------------------------
	// 8. Path safety — malicious FilePath rejected before zipping
	// -------------------------------------------------------------------------
	it("rejects unsafe FilePath values before building the zip (no lwc/ prefix)", async () => {
		const tooling = makeTooling();
		const { service } = makeServiceWithMocks(tooling);

		tooling.query
			.mockResolvedValueOnce({ records: [{ LastModifiedDate: expectedDate }] }) // conflict
			.mockResolvedValueOnce({
				records: [{ Id: RESOURCE_ID, FilePath: "lwc/helloWorld/helloWorld.js" }],
			}) // idByPath
			.mockResolvedValueOnce({
				records: [{ DeveloperName: "helloWorld", ApiVersion: 62 }],
			}) // bundle info
			.mockResolvedValueOnce({
				// resources with a dangerous path
				records: [{ FilePath: "../../etc/passwd", Source: "evil", Format: "js" }],
			});

		tooling
			.sobject("LightningComponentResource")
			.update.mockRejectedValue(
				new Error(
					"Invalid reference CustomObject__c.CustomField__c of type sobjectField in file helloWorld.js: Source",
				),
			);

		const result = await service.deployBundle({
			orgUsername: "user@example.com",
			bundleId: BUNDLE_ID,
			files: [{ path: "lwc/helloWorld/helloWorld.js", source: "new source" }],
			expectedLastModifiedDate: expectedDate,
		});

		expect(result.status).toBe("error");
		if (result.status === "error") {
			expect(result.errors[0].message).toContain("Unsafe");
		}
	});

	// -------------------------------------------------------------------------
	// 9. Mid-poll checkDeployStatus rejection → graceful error (not HTTP 500)
	// -------------------------------------------------------------------------
	it("returns a graceful error when checkDeployStatus rejects mid-poll", async () => {
		const tooling = makeToolingForFallback();
		const { service, meta } = makeServiceWithMocks(tooling);

		meta.deploy.mockResolvedValue({ id: "0Af000000000099AAA" });
		meta.checkDeployStatus.mockRejectedValue(new Error("NETWORK_ERROR: connection reset"));

		const result = await service.deployBundle({
			orgUsername: "user@example.com",
			bundleId: BUNDLE_ID,
			files: [{ path: "lwc/helloWorld/helloWorld.js", source: "new source" }],
			expectedLastModifiedDate: expectedDate,
		});

		// Must be a graceful error response, not an unhandled rejection / HTTP 500
		expect(result.status).toBe("error");
		if (result.status === "error") {
			expect(result.errors[0].message).toContain("NETWORK_ERROR");
		}
	});

	// -------------------------------------------------------------------------
	// 10. jsforce deploy-locator (.check()) shape — job ID extracted correctly
	// -------------------------------------------------------------------------
	it("extracts job ID from a jsforce deploy-locator .check() response", async () => {
		const tooling = makeToolingForFallback();
		const { service, meta } = makeServiceWithMocks(tooling);

		// Simulate a jsforce DeployResultLocator: deploy() returns an object with a
		// .check() method instead of a plain { id }
		meta.deploy.mockResolvedValue({
			check: vi.fn().mockResolvedValue({ id: "0Af000000000077AAA" }),
		});
		meta.checkDeployStatus.mockResolvedValue({ status: "Succeeded" });

		const result = await service.deployBundle({
			orgUsername: "user@example.com",
			bundleId: BUNDLE_ID,
			files: [{ path: "lwc/helloWorld/helloWorld.js", source: "new source" }],
			expectedLastModifiedDate: expectedDate,
		});

		expect(result.status).toBe("success");
		// checkDeployStatus must have been called with the ID from .check()
		expect(meta.checkDeployStatus).toHaveBeenCalledWith("0Af000000000077AAA", true);
	});

	// -------------------------------------------------------------------------
	// 11. apiVersion is numeric from Tooling API → package.xml uses "XX.0" form
	// -------------------------------------------------------------------------
	it("formats numeric ApiVersion as XX.0 in package.xml", async () => {
		const tooling = makeToolingForFallback(); // fixture uses ApiVersion: 62 (number)
		const { service, meta } = makeServiceWithMocks(tooling);

		meta.checkDeployStatus.mockResolvedValue({ status: "Succeeded" });

		let capturedZip: Buffer | undefined;
		meta.deploy.mockImplementation(async (zip: Buffer) => {
			capturedZip = zip;
			return { id: "0Af000000000099AAA" };
		});

		await service.deployBundle({
			orgUsername: "user@example.com",
			bundleId: BUNDLE_ID,
			files: [{ path: "lwc/helloWorld/helloWorld.js", source: "new source" }],
			expectedLastModifiedDate: expectedDate,
		});

		expect(capturedZip).toBeDefined();
		const loaded = await JSZip.loadAsync(capturedZip!);
		const pkgXml = await loaded.file("package.xml")!.async("text");

		// Must be "62.0", not "62"
		expect(pkgXml).toContain("62.0");
		expect(pkgXml).not.toMatch(/<version>62<\/version>/);
	});

	// -------------------------------------------------------------------------
	// 12. Metadata componentFailures with lineNumber/columnNumber → error.line/column
	// -------------------------------------------------------------------------
	it("maps lineNumber/columnNumber from Metadata componentFailures to line/column", async () => {
		const tooling = makeToolingForFallback();
		const { service, meta } = makeServiceWithMocks(tooling);

		meta.deploy.mockResolvedValue({ id: "0Af000000000099AAA" });
		meta.checkDeployStatus.mockResolvedValue({
			status: "Failed",
			details: {
				componentFailures: [
					{
						componentType: "LightningComponentBundle",
						fullName: "helloWorld",
						problem: "Unexpected token '{'",
						fileName: "lwc/helloWorld/helloWorld.js",
						lineNumber: 12,
						columnNumber: 5,
					},
				],
			},
		});

		const result = await service.deployBundle({
			orgUsername: "user@example.com",
			bundleId: BUNDLE_ID,
			files: [{ path: "lwc/helloWorld/helloWorld.js", source: "bad source" }],
			expectedLastModifiedDate: expectedDate,
		});

		expect(result.status).toBe("error");
		if (result.status === "error") {
			expect(result.errors[0].line).toBe(12);
			expect(result.errors[0].column).toBe(5);
			expect(result.errors[0].message).toBe("Unexpected token '{'");
		}
	});
});
