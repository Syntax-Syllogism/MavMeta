import { describe, expect, it, vi } from "vitest";

import { ObjectExplorerService } from "./object-explorer-service";

function createConnection() {
	return {
		instanceUrl: "https://example.my.salesforce.com",
		accessToken: "token",
		getApiVersion: () => "66.0",
		query: vi.fn().mockResolvedValue({
			records: [{ NamespacePrefix: null }],
			totalSize: 1,
			done: true,
		}),
		metadata: {
			list: vi.fn(),
		},
	};
}

function jsonResponse(records: Array<Record<string, unknown>>, done = true): Response {
	return new Response(JSON.stringify({ records, totalSize: records.length, done }), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

function readSoql(fetcher: ReturnType<typeof vi.fn>, callIndex: number): string {
	const url = String(fetcher.mock.calls[callIndex]?.[0] ?? "");
	return new URL(url).searchParams.get("q") ?? "";
}

describe("ObjectExplorerService", () => {
	it("times out the legacy metadata list path", async () => {
		const connection = createConnection();
		connection.metadata.list.mockReturnValue(new Promise(() => {}));
		const service = new ObjectExplorerService({
			connectionFactory: async () => connection,
			metadataListTimeoutMs: 1,
		});

		await expect(
			service.listObjects({ target: { username: "dev@example.com" } }),
		).rejects.toMatchObject({
			statusCode: 504,
			code: "OBJECT_LIST_TIMEOUT",
			message: "Listing CustomObject metadata took too long.",
		});
	});

	it("returns a first page with nextCursor and joins manageableState", async () => {
		const connection = createConnection();
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse([
					{
						QualifiedApiName: "Account",
						MasterLabel: "Account",
						NamespacePrefix: null,
						IsCustomSetting: false,
					},
					{
						QualifiedApiName: "Invoice__c",
						MasterLabel: "Invoice",
						NamespacePrefix: null,
						IsCustomSetting: false,
					},
				]),
			)
			.mockResolvedValueOnce(
				jsonResponse([
					{
						DeveloperName: "Invoice",
						NamespacePrefix: null,
						ManageableState: "unmanaged",
					},
				]),
			);
		const service = new ObjectExplorerService({
			connectionFactory: async () => connection,
			fetcher,
		});

		const response = await service.listObjectsPage({
			target: { username: "dev@example.com" },
			limit: 2,
		});

		expect(response.objects).toEqual([
			{
				apiName: "Account",
				label: "Account",
				objectType: "standard",
				namespacePrefix: undefined,
				manageableState: undefined,
			},
			{
				apiName: "Invoice__c",
				label: "Invoice",
				objectType: "custom",
				namespacePrefix: undefined,
				manageableState: "unmanaged",
			},
		]);
		expect(response.nextCursor).toBe("Invoice__c");
		expect(connection.query).toHaveBeenCalledWith(
			"SELECT NamespacePrefix FROM Organization LIMIT 1",
		);
		expect(readSoql(fetcher, 0)).toContain("LIMIT 2");
		expect(readSoql(fetcher, 1)).toContain("DeveloperName IN ('Invoice')");
	});

	it("omits nextCursor and skips CustomObject query for standards-only pages", async () => {
		const connection = createConnection();
		const fetcher = vi.fn().mockResolvedValueOnce(
			jsonResponse([
				{
					QualifiedApiName: "Account",
					MasterLabel: "Account",
					NamespacePrefix: null,
					IsCustomSetting: false,
				},
			]),
		);
		const service = new ObjectExplorerService({
			connectionFactory: async () => connection,
			fetcher,
		});

		const response = await service.listObjectsPage({
			target: { username: "dev@example.com" },
			limit: 2,
		});

		expect(response.nextCursor).toBeUndefined();
		expect(response.objects).toHaveLength(1);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it("adds cursor and escaped search clauses to the EntityDefinition query", async () => {
		const connection = createConnection();
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse([]))
			.mockResolvedValueOnce(jsonResponse([]));
		const service = new ObjectExplorerService({
			connectionFactory: async () => connection,
			fetcher,
		});

		await service.listObjectsPage({
			target: { username: "dev@example.com" },
			cursor: "Account",
			search: "A_%'",
			limit: 25,
		});

		const soql = readSoql(fetcher, 0);
		const secondSoql = readSoql(fetcher, 1);
		expect(soql).toContain("QualifiedApiName > 'Account'");
		expect(soql).toContain("QualifiedApiName LIKE '%A\\_\\%\\'%'");
		expect(secondSoql).toContain("MasterLabel LIKE '%A\\_\\%\\'%'");
		expect(soql).not.toContain(" OR ");
		expect(secondSoql).not.toContain(" OR ");
	});

	it("caches the org namespace per username", async () => {
		const connection = createConnection();
		const fetcher = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse([])));
		const service = new ObjectExplorerService({
			connectionFactory: async () => connection,
			fetcher,
		});

		await service.listObjectsPage({ target: { username: "dev@example.com" } });
		await service.listObjectsPage({ target: { username: "dev@example.com" } });

		expect(connection.query).toHaveBeenCalledTimes(1);
	});

	it("uses the null namespace filter and defensively excludes managed package rows", async () => {
		const connection = createConnection();
		const fetcher = vi.fn().mockResolvedValueOnce(
			jsonResponse([
				{
					QualifiedApiName: "Account",
					MasterLabel: "Account",
					NamespacePrefix: null,
				},
				{
					QualifiedApiName: "slackv2__Setup_Settings__c",
					MasterLabel: "Setup Settings",
					NamespacePrefix: "slackv2",
				},
			]),
		);
		const service = new ObjectExplorerService({
			connectionFactory: async () => connection,
			fetcher,
		});

		const response = await service.listObjectsPage({ target: { username: "dev@example.com" } });

		expect(readSoql(fetcher, 0)).not.toContain("WHERE IsCustomizable = true AND NamespacePrefix");
		expect(response.objects.map((obj) => obj.apiName)).toEqual(["Account"]);
	});

	it("continues keyset paging when namespace filtering excludes an entire raw page", async () => {
		const connection = createConnection();
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse([
					{
						QualifiedApiName: "aaa__Managed_One__c",
						MasterLabel: "Managed One",
						NamespacePrefix: "aaa",
					},
					{
						QualifiedApiName: "aaa__Managed_Two__c",
						MasterLabel: "Managed Two",
						NamespacePrefix: "aaa",
					},
				]),
			)
			.mockResolvedValueOnce(
				jsonResponse([
					{
						QualifiedApiName: "Invoice__c",
						MasterLabel: "Invoice",
						NamespacePrefix: null,
					},
				]),
			)
			.mockResolvedValueOnce(
				jsonResponse([
					{ DeveloperName: "Invoice", NamespacePrefix: null, ManageableState: "unmanaged" },
				]),
			);
		const service = new ObjectExplorerService({
			connectionFactory: async () => connection,
			fetcher,
		});

		const response = await service.listObjectsPage({
			target: { username: "dev@example.com" },
			limit: 2,
		});

		expect(readSoql(fetcher, 1)).toContain("QualifiedApiName > 'aaa__Managed_Two__c'");
		expect(response.objects.map((obj) => obj.apiName)).toEqual(["Invoice__c"]);
		expect(response.nextCursor).toBeUndefined();
	});

	it("returns a cursor when the namespace retry cap is hit without accepted rows", async () => {
		const connection = createConnection();
		const fetcher = vi.fn();
		for (let index = 0; index < 25; index++) {
			fetcher.mockResolvedValueOnce(
				jsonResponse(
					[
						{
							QualifiedApiName: `pkg__Managed_${String(index).padStart(2, "0")}__c`,
							MasterLabel: `Managed ${index}`,
							NamespacePrefix: "pkg",
						},
					],
					false,
				),
			);
		}
		const service = new ObjectExplorerService({
			connectionFactory: async () => connection,
			fetcher,
		});

		const response = await service.listObjectsPage({
			target: { username: "dev@example.com" },
			limit: 1,
		});

		expect(response.objects).toEqual([]);
		expect(response.nextCursor).toBe("pkg__Managed_24__c");
		expect(fetcher).toHaveBeenCalledTimes(25);
	});

	it("keeps keyset paging when Tooling returns a partial batch with done=false", async () => {
		const connection = createConnection();
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse(
					[
						{
							QualifiedApiName: "Account",
							MasterLabel: "Account",
							NamespacePrefix: null,
						},
					],
					false,
				),
			)
			.mockResolvedValueOnce(
				jsonResponse([
					{
						QualifiedApiName: "Contact",
						MasterLabel: "Contact",
						NamespacePrefix: null,
					},
				]),
			);
		const service = new ObjectExplorerService({
			connectionFactory: async () => connection,
			fetcher,
		});

		const response = await service.listObjectsPage({
			target: { username: "dev@example.com" },
			limit: 2,
		});

		expect(readSoql(fetcher, 1)).toContain("QualifiedApiName > 'Account'");
		expect(response.objects.map((obj) => obj.apiName)).toEqual(["Account", "Contact"]);
		expect(response.nextCursor).toBeUndefined();
	});

	it("preserves an org-owned namespace without SOQL namespace predicates", async () => {
		const connection = createConnection();
		connection.query.mockResolvedValueOnce({
			records: [{ NamespacePrefix: "mavmeta" }],
			totalSize: 1,
			done: true,
		});
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse([
					{
						QualifiedApiName: "Foo__c",
						MasterLabel: "Foo",
						NamespacePrefix: null,
					},
					{
						QualifiedApiName: "mavmeta__Foo__c",
						MasterLabel: "Foo",
						NamespacePrefix: "mavmeta",
					},
					{
						QualifiedApiName: "slackv2__Foo__c",
						MasterLabel: "Foo",
						NamespacePrefix: "slackv2",
					},
				]),
			)
			.mockResolvedValueOnce(
				jsonResponse([
					{ DeveloperName: "Foo", NamespacePrefix: null, ManageableState: "unmanaged" },
					{ DeveloperName: "Foo", NamespacePrefix: "mavmeta", ManageableState: "beta" },
				]),
			);
		const service = new ObjectExplorerService({
			connectionFactory: async () => connection,
			fetcher,
		});

		const response = await service.listObjectsPage({ target: { username: "dev@example.com" } });

		expect(readSoql(fetcher, 0)).not.toContain(" OR ");
		expect(readSoql(fetcher, 0)).not.toContain("WHERE IsCustomizable = true AND NamespacePrefix");
		expect(response.objects.map((obj) => [obj.apiName, obj.manageableState])).toEqual([
			["Foo__c", "unmanaged"],
			["mavmeta__Foo__c", "beta"],
		]);
	});

	it("labels Big Objects and External Objects from EntityDefinition rows and joins manageableState", async () => {
		const connection = createConnection();
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse([
					{ QualifiedApiName: "Rider_History__b", MasterLabel: "Rider History" },
					{ QualifiedApiName: "phone_plans__x", MasterLabel: "Phone Plans" },
				]),
			)
			.mockResolvedValueOnce(
				jsonResponse([
					{
						DeveloperName: "Rider_History",
						NamespacePrefix: null,
						ManageableState: "unmanaged",
					},
					{
						DeveloperName: "phone_plans",
						NamespacePrefix: null,
						ManageableState: "released",
					},
				]),
			);
		const service = new ObjectExplorerService({
			connectionFactory: async () => connection,
			fetcher,
		});

		const response = await service.listObjectsPage({ target: { username: "dev@example.com" } });

		expect(new Map(response.objects.map((obj) => [obj.apiName, obj.objectType]))).toEqual(
			new Map([
				["Rider_History__b", "bigObject"],
				["phone_plans__x", "externalObject"],
			]),
		);
		expect(new Map(response.objects.map((obj) => [obj.apiName, obj.manageableState]))).toEqual(
			new Map([
				["Rider_History__b", "unmanaged"],
				["phone_plans__x", "released"],
			]),
		);
		expect(readSoql(fetcher, 1)).toContain("'Rider_History'");
		expect(readSoql(fetcher, 1)).toContain("'phone_plans'");
	});

	it("surfaces Tooling query timeouts as clear API errors", async () => {
		const connection = createConnection();
		const fetcher = vi
			.fn()
			.mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => {
						reject(new DOMException("Timed out", "TimeoutError"));
					});
				});
			});
		const service = new ObjectExplorerService({
			connectionFactory: async () => connection,
			fetcher,
			toolingQueryTimeoutMs: 1,
		});

		await expect(
			service.listObjectsPage({ target: { username: "dev@example.com" } }),
		).rejects.toMatchObject({
			statusCode: 504,
			code: "TOOLING_QUERY_TIMEOUT",
			message: "Tooling query took too long.",
		});
	});
});
