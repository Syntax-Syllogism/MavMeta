import { describe, expect, it, vi, beforeEach } from "vitest";
import { Org } from "@salesforce/core";
import { MetadataService } from "./metadata-service";

vi.mock("@salesforce/core", () => ({
	Org: {
		create: vi.fn(),
	},
}));

vi.mock("jszip", () => ({
	default: {
		loadAsync: vi.fn(),
	},
}));

describe("MetadataService", () => {
	let service: MetadataService;

	const mockRetrieveLocator = {
		complete: vi.fn(),
	};

	const mockConnection = {
		getApiVersion: vi.fn().mockReturnValue("58.0"),
		metadata: {
			describe: vi.fn(),
			list: vi.fn(),
			read: vi.fn(),
			retrieve: vi.fn().mockReturnValue(mockRetrieveLocator),
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
		service = new MetadataService();
		vi.mocked(Org.create).mockResolvedValue({
			getConnection: () => mockConnection,
		} as any);

		// Default: retrieve returns an empty zip (no zipFile)
		mockRetrieveLocator.complete.mockResolvedValue({ zipFile: undefined });
	});

	describe("getComponentSource", () => {
		it("extracts source from in-memory retrieve zip without disk writes", async () => {
			const xmlPayload = '<?xml version="1.0" encoding="UTF-8"?>\n<ApexClass>body</ApexClass>';
			const { default: JSZip } = await import("jszip");
			const mockZip = {
				files: {
					"unpackaged/classes/MyClass.cls-meta.xml": {
						dir: false,
						async: vi.fn().mockResolvedValue(xmlPayload),
					},
				},
			};
			vi.mocked(JSZip.loadAsync).mockResolvedValue(mockZip as any);

			const fakeZipBase64 = Buffer.from("fake-zip").toString("base64");
			mockRetrieveLocator.complete.mockResolvedValue({ zipFile: fakeZipBase64 });

			const result = await service.getComponentSource({
				target: { username: "user@example.com" },
				metadataType: "ApexClass",
				fullName: "MyClass",
			});

			expect(result.source).toBe(xmlPayload);
			expect(result.error).toBeUndefined();
			// metadata.retrieve() was called — not ComponentSet, not fs writes
			expect(mockConnection.metadata.retrieve).toHaveBeenCalledWith(
				expect.objectContaining({
					unpackaged: expect.objectContaining({
						types: [{ name: "ApexClass", members: ["MyClass"] }],
					}),
				}),
			);
		});

		it("does not call metadata.read for retrieve-first path when zip extraction succeeds", async () => {
			const xmlPayload = '<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata"/>';
			const { default: JSZip } = await import("jszip");
			const mockZip = {
				files: {
					"unpackaged/objects/MyObject.object-meta.xml": {
						dir: false,
						async: vi.fn().mockResolvedValue(xmlPayload),
					},
				},
			};
			vi.mocked(JSZip.loadAsync).mockResolvedValue(mockZip as any);
			mockRetrieveLocator.complete.mockResolvedValue({
				zipFile: Buffer.from("zip").toString("base64"),
			});

			await service.getComponentSource({
				target: { username: "user@example.com" },
				metadataType: "CustomObject",
				fullName: "MyObject",
			});

			expect(mockConnection.metadata.read).not.toHaveBeenCalled();
		});

		it("falls back to metadata.read and serializes XML when retrieve zip has no matching file", async () => {
			const { default: JSZip } = await import("jszip");
			// Zip has no matching file for "MyObject"
			vi.mocked(JSZip.loadAsync).mockResolvedValue({ files: {} } as any);
			mockRetrieveLocator.complete.mockResolvedValue({
				zipFile: Buffer.from("zip").toString("base64"),
			});

			mockConnection.metadata.read.mockResolvedValue({
				fullName: "MyObject",
				description: "A custom object",
			});

			const result = await service.getComponentSource({
				target: { username: "user@example.com" },
				metadataType: "CustomObject",
				fullName: "MyObject",
			});

			expect(result.source).toContain("<?xml");
			expect(result.source).toContain("<CustomObject");
			expect(result.source).toContain("<fullName>MyObject</fullName>");
			expect(result.source).toContain("<description>A custom object</description>");
		});

		it("ignores unsafe zip entry paths and falls back to metadata.read", async () => {
			const { default: JSZip } = await import("jszip");
			const mockZip = {
				files: {
					"../MyObject.object-meta.xml": {
						dir: false,
						async: vi.fn().mockResolvedValue("unsafe"),
					},
				},
			};
			vi.mocked(JSZip.loadAsync).mockResolvedValue(mockZip as any);
			mockRetrieveLocator.complete.mockResolvedValue({
				zipFile: Buffer.from("zip").toString("base64"),
			});
			mockConnection.metadata.read.mockResolvedValue({
				fullName: "MyObject",
				description: "safe fallback",
			});

			const result = await service.getComponentSource({
				target: { username: "user@example.com" },
				metadataType: "CustomObject",
				fullName: "MyObject",
			});

			expect(result.source).toContain("<description>safe fallback</description>");
			expect(mockConnection.metadata.read).toHaveBeenCalled();
		});

		it("falls back to serialized XML shell when retrieve fails and read returns empty", async () => {
			mockRetrieveLocator.complete.mockRejectedValue(new Error("Retrieve failed"));
			mockConnection.metadata.read.mockResolvedValue([]);

			const result = await service.getComponentSource({
				target: { username: "user@example.com" },
				metadataType: "CustomObject",
				fullName: "NonExistent",
			});

			expect(result.source).toContain("<CustomObject");
			expect(result.error).toBeUndefined();
		});

		it("returns cached source and truncated flag on second call without re-fetching", async () => {
			const { default: JSZip } = await import("jszip");
			const xmlPayload = "line\n".repeat(5);
			const mockZip = {
				files: {
					"MyClass.cls-meta.xml": {
						dir: false,
						async: vi.fn().mockResolvedValue(xmlPayload),
					},
				},
			};
			vi.mocked(JSZip.loadAsync).mockResolvedValue(mockZip as any);
			mockRetrieveLocator.complete.mockResolvedValue({
				zipFile: Buffer.from("zip").toString("base64"),
			});

			const request = {
				target: { username: "user@example.com" },
				metadataType: "ApexClass",
				fullName: "MyClass",
			};

			const first = await service.getComponentSource(request);
			vi.clearAllMocks();
			vi.mocked(Org.create).mockResolvedValue({ getConnection: () => mockConnection } as any);

			const second = await service.getComponentSource(request);

			expect(second.source).toBe(first.source);
			expect(second.truncated).toBe(first.truncated);
			expect(Org.create).not.toHaveBeenCalled();
		});

		it("correctly reports truncated=true for cached entries that were truncated", async () => {
			const { default: JSZip } = await import("jszip");
			// Generate content > 1000 lines
			const longContent = Array.from({ length: 1100 }, (_, i) => `line ${i}`).join("\n");
			const mockZip = {
				files: {
					"MyClass.cls-meta.xml": {
						dir: false,
						async: vi.fn().mockResolvedValue(longContent),
					},
				},
			};
			vi.mocked(JSZip.loadAsync).mockResolvedValue(mockZip as any);
			mockRetrieveLocator.complete.mockResolvedValue({
				zipFile: Buffer.from("zip").toString("base64"),
			});

			const request = {
				target: { username: "user@example.com" },
				metadataType: "ApexClass",
				fullName: "MyClass",
			};

			const first = await service.getComponentSource(request);
			expect(first.truncated).toBe(true);

			vi.clearAllMocks();
			vi.mocked(Org.create).mockResolvedValue({ getConnection: () => mockConnection } as any);

			const second = await service.getComponentSource(request);
			expect(second.truncated).toBe(true);
			expect(Org.create).not.toHaveBeenCalled();
		});

		it("evicts the oldest entry when cache reaches max size", async () => {
			const { default: JSZip } = await import("jszip");
			vi.mocked(JSZip.loadAsync).mockResolvedValue({ files: {} } as any);
			mockRetrieveLocator.complete.mockResolvedValue({ zipFile: undefined });
			mockConnection.metadata.read.mockResolvedValue({});

			// Fill the cache to MAX_CACHE_ENTRIES (50) using distinct fullNames
			for (let i = 0; i < 50; i++) {
				await service.getComponentSource({
					target: { username: "user@example.com" },
					metadataType: "ApexClass",
					fullName: `Class${i}`,
				});
			}

			// The first entry (Class0) should still be present
			vi.mocked(Org.create).mockClear();
			await service.getComponentSource({
				target: { username: "user@example.com" },
				metadataType: "ApexClass",
				fullName: "Class0",
			});
			const callsAfterFirst50 = vi.mocked(Org.create).mock.calls.length;
			expect(callsAfterFirst50).toBe(0); // Class0 is cached

			// Adding a 51st entry should evict Class0
			await service.getComponentSource({
				target: { username: "user@example.com" },
				metadataType: "ApexClass",
				fullName: "Class50",
			});

			// Class0 should now be evicted — fetching it again should call Org.create
			vi.mocked(Org.create).mockClear();
			await service.getComponentSource({
				target: { username: "user@example.com" },
				metadataType: "ApexClass",
				fullName: "Class0",
			});
			expect(vi.mocked(Org.create).mock.calls.length).toBe(1);
		});

		it("handles errors gracefully and returns error field", async () => {
			vi.mocked(Org.create).mockRejectedValueOnce(new Error("Connection Failed"));

			const result = await service.getComponentSource({
				target: { username: "user@example.com" },
				metadataType: "CustomObject",
				fullName: "MyObject",
			});

			expect(result.error?.message).toBe("Connection Failed");
		});
	});

	describe("getCrossOrgComponentDiff", () => {
		it("propagates fileName in cross-org diff results", async () => {
			const { default: JSZip } = await import("jszip");
			vi.mocked(JSZip.loadAsync)
				.mockResolvedValueOnce({
					files: {
						"myBundle.js-source.js-meta.xml": {
							dir: false,
							async: vi.fn().mockResolvedValue("const one = 1;"),
						},
					},
				} as any)
				.mockResolvedValueOnce({
					files: {
						"myBundle.js-target.js-meta.xml": {
							dir: false,
							async: vi.fn().mockResolvedValue("const one = 2;"),
						},
					},
				} as any);
			mockRetrieveLocator.complete.mockResolvedValue({
				zipFile: Buffer.from("zip").toString("base64"),
			});

			const result = await service.getCrossOrgComponentDiff({
				source: { username: "source@example.com" },
				target: { username: "target@example.com" },
				components: [
					{
						metadataType: "LightningComponentBundle",
						fullName: "c:myBundle",
						fileName: "myBundle.js",
					},
				],
			});

			expect(result.results[0]?.fileName).toBe("myBundle.js");
		});

		it("returns Same when normalized source and target XML match", async () => {
			const { default: JSZip } = await import("jszip");
			vi.mocked(JSZip.loadAsync)
				.mockResolvedValueOnce({
					files: {
						"MyClass-source.cls-meta.xml": {
							dir: false,
							async: vi.fn().mockResolvedValue("<ApexClass>\r\n<body>1</body>\r\n</ApexClass>\r\n"),
						},
					},
				} as any)
				.mockResolvedValueOnce({
					files: {
						"MyClass-target.cls-meta.xml": {
							dir: false,
							async: vi.fn().mockResolvedValue("<ApexClass>\n<body>1</body>\n</ApexClass>"),
						},
					},
				} as any);
			mockRetrieveLocator.complete.mockResolvedValue({
				zipFile: Buffer.from("zip").toString("base64"),
			});

			const result = await service.getCrossOrgComponentDiff({
				source: { username: "source@example.com" },
				target: { username: "target@example.com" },
				components: [{ metadataType: "ApexClass", fullName: "MyClass" }],
			});

			expect(result.results[0]?.state).toBe("Same");
		});

		it("returns Changed when source and target XML differ", async () => {
			const { default: JSZip } = await import("jszip");
			vi.mocked(JSZip.loadAsync)
				.mockResolvedValueOnce({
					files: {
						"MyClass-source.cls-meta.xml": {
							dir: false,
							async: vi.fn().mockResolvedValue("<ApexClass><body>1</body></ApexClass>"),
						},
					},
				} as any)
				.mockResolvedValueOnce({
					files: {
						"MyClass-target.cls-meta.xml": {
							dir: false,
							async: vi.fn().mockResolvedValue("<ApexClass><body>2</body></ApexClass>"),
						},
					},
				} as any);
			mockRetrieveLocator.complete.mockResolvedValue({
				zipFile: Buffer.from("zip").toString("base64"),
			});

			const result = await service.getCrossOrgComponentDiff({
				source: { username: "source@example.com" },
				target: { username: "target@example.com" },
				components: [{ metadataType: "ApexClass", fullName: "MyClass" }],
			});

			expect(result.results[0]?.state).toBe("Changed");
		});

		it("rejects same source and target org", async () => {
			await expect(
				service.getCrossOrgComponentDiff({
					source: { username: "same@example.com" },
					target: { username: "same@example.com" },
					components: [{ metadataType: "ApexClass", fullName: "MyClass" }],
				}),
			).rejects.toThrow("Source and target orgs must be different");
		});

		it("returns MissingInTarget when target retrieval reports not found", async () => {
			vi.mocked(Org.create)
				.mockResolvedValueOnce({ getConnection: () => mockConnection } as any)
				.mockResolvedValueOnce({ getConnection: () => mockConnection } as any)
				.mockResolvedValueOnce({ getConnection: () => mockConnection } as any)
				.mockRejectedValueOnce(new Error("Component not found"));

			const result = await service.getCrossOrgComponentDiff({
				source: { username: "source@example.com" },
				target: { username: "target@example.com" },
				components: [{ metadataType: "ApexClass", fullName: "MyClass" }],
			});

			expect(result.results[0]?.state).toBe("MissingInTarget");
		});

		it("returns Error when retrieval fails for non-missing reason", async () => {
			vi.mocked(Org.create)
				.mockResolvedValueOnce({ getConnection: () => mockConnection } as any)
				.mockResolvedValueOnce({ getConnection: () => mockConnection } as any)
				.mockRejectedValueOnce(new Error("Connection timeout"))
				.mockResolvedValueOnce({ getConnection: () => mockConnection } as any);

			const result = await service.getCrossOrgComponentDiff({
				source: { username: "source@example.com" },
				target: { username: "target@example.com" },
				components: [{ metadataType: "ApexClass", fullName: "MyClass" }],
			});

			expect(result.results[0]?.state).toBe("Error");
		});

		it("rejects when source org is no longer authenticated", async () => {
			vi.mocked(Org.create).mockRejectedValueOnce(new Error("Auth missing"));

			await expect(
				service.getCrossOrgComponentDiff({
					source: { username: "source@example.com" },
					target: { username: "target@example.com" },
					components: [{ metadataType: "ApexClass", fullName: "MyClass" }],
				}),
			).rejects.toThrow("Source org is no longer authenticated");
		});
	});
});
