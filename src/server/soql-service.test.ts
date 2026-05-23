import { describe, expect, it, vi } from "vitest";

import { SoqlService } from "./soql-service";

describe("SoqlService", () => {
	it("describeGlobal filters to queryable and sorts by label", async () => {
		const service = new SoqlService({
			connectionFactory: async () =>
				({
					instanceUrl: "https://example.my.salesforce.com",
					getApiVersion: () => "62.0",
					describeGlobal: async () => ({
						sobjects: [
							{ name: "Contact", label: "Contact", queryable: true, custom: false },
							{ name: "ApexLog", label: "Apex Log", queryable: false, custom: false },
							{
								name: "ApprovalSubmissionFeed",
								label: "__MISSING LABEL__ PropertyFile - val ApprovalSubmission not found",
								queryable: true,
								custom: false,
							},
							{
								name: "__MISSING LABEL__ FakeApiName",
								label: "Missing label leaked into API name",
								queryable: true,
								custom: false,
							},
							{ name: "Account", label: "Account", queryable: true, custom: false },
						],
					}),
					describe: vi.fn(),
					query: vi.fn(),
					queryMore: vi.fn(),
					tooling: { describeGlobal: vi.fn(), describe: vi.fn(), query: vi.fn() },
				}) as never,
		});

		const response = await service.describeGlobal({ username: "u", api: "rest" });
		expect(response.sobjects.map((s) => s.apiName)).toEqual(["Account", "Contact"]);
	});

	it("validateQuery tooling uses LIMIT 1 fallback", async () => {
		const fetcher = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ records: [], totalSize: 0, done: true }),
		});
		const service = new SoqlService({
			fetcher: fetcher as never,
			connectionFactory: async () =>
				({
					instanceUrl: "https://example.my.salesforce.com",
					getApiVersion: () => "62.0",
					accessToken: "token",
					describeGlobal: vi.fn(),
					describe: vi.fn(),
					query: vi.fn(),
					queryMore: vi.fn(),
					tooling: { describeGlobal: vi.fn(), describe: vi.fn(), query: vi.fn() },
				}) as never,
		});

		const result = await service.validateQuery({
			username: "u",
			api: "tooling",
			soql: "SELECT Id FROM ApexClass",
		});
		expect(result).toEqual({ valid: true });
		expect(fetcher).toHaveBeenCalledWith(
			"https://example.my.salesforce.com/services/data/v62.0/tooling/query/?q=SELECT%20Id%20FROM%20ApexClass%20LIMIT%201",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("runQuery strips attributes and paginates", async () => {
		const service = new SoqlService({
			connectionFactory: async () =>
				({
					instanceUrl: "https://example.my.salesforce.com",
					getApiVersion: () => "62.0",
					describeGlobal: vi.fn(),
					describe: vi.fn(),
					query: async () => ({
						records: [{ Id: "001", Name: "A", attributes: { type: "Account" } }],
						totalSize: 2,
						done: false,
						nextRecordsUrl: "/next",
					}),
					queryMore: async () => ({
						records: [{ Id: "002", Name: "B", attributes: { type: "Account" } }],
						totalSize: 2,
						done: true,
					}),
					tooling: { describeGlobal: vi.fn(), describe: vi.fn(), query: vi.fn() },
				}) as never,
		});

		const result = await service.runQuery({
			username: "u",
			api: "rest",
			soql: "SELECT Id, Name FROM Account",
			includeAllPages: true,
		});
		expect(result.records).toEqual([
			{ Id: "001", Name: "A" },
			{ Id: "002", Name: "B" },
		]);
	});

	it("runQuery returns first page only when includeAllPages is not true", async () => {
		const service = new SoqlService({
			connectionFactory: async () =>
				({
					instanceUrl: "https://example.my.salesforce.com",
					getApiVersion: () => "62.0",
					accessToken: "token",
					describeGlobal: vi.fn(),
					describe: vi.fn(),
					query: async () => ({
						records: [{ Id: "001", attributes: { type: "Account" } }],
						totalSize: 20000,
						done: false,
						nextRecordsUrl: "/next",
					}),
					queryMore: vi.fn(),
					tooling: { describeGlobal: vi.fn(), describe: vi.fn(), query: vi.fn() },
				}) as never,
		});

		const result = await service.runQuery({
			username: "u",
			api: "rest",
			soql: "SELECT Id FROM Account",
			includeAllPages: false,
		});
		expect(result.records).toEqual([{ Id: "001" }]);
		expect(result.nextRecordsUrl).toBe("/next");
	});

	it("runQuery can resume from nextRecordsUrl without rerunning page one", async () => {
		const query = vi.fn();
		const queryMore = vi
			.fn()
			.mockResolvedValueOnce({
				records: [{ Id: "002", attributes: { type: "Account" } }],
				totalSize: 2,
				done: false,
				nextRecordsUrl: "/next-2",
			})
			.mockResolvedValueOnce({
				records: [{ Id: "003", attributes: { type: "Account" } }],
				totalSize: 2,
				done: true,
			});

		const service = new SoqlService({
			connectionFactory: async () =>
				({
					instanceUrl: "https://example.my.salesforce.com",
					getApiVersion: () => "62.0",
					accessToken: "token",
					describeGlobal: vi.fn(),
					describe: vi.fn(),
					query,
					queryMore,
					tooling: { describeGlobal: vi.fn(), describe: vi.fn(), query: vi.fn() },
				}) as never,
		});

		const result = await service.runQuery({
			username: "u",
			api: "rest",
			soql: "SELECT Id FROM Account",
			includeAllPages: true,
			nextRecordsUrl: "/next-1",
		});
		expect(query).not.toHaveBeenCalled();
		expect(queryMore).toHaveBeenCalledTimes(2);
		expect(result.records).toEqual([{ Id: "002" }, { Id: "003" }]);
	});

	it("preview query applies LIMIT cap", async () => {
		const query = vi.fn().mockResolvedValue({
			records: [{ Id: "001" }],
			totalSize: 12,
			done: true,
		});
		const service = new SoqlService({
			connectionFactory: async () =>
				({
					instanceUrl: "https://example.my.salesforce.com",
					getApiVersion: () => "62.0",
					describeGlobal: vi.fn(),
					describe: vi.fn(),
					query,
					queryMore: vi.fn(),
					tooling: { describeGlobal: vi.fn(), describe: vi.fn(), query: vi.fn() },
				}) as never,
		});

		await service.runQuery({
			username: "u",
			api: "rest",
			soql: "SELECT Id FROM Account LIMIT 50",
			previewLimit: 5,
		});
		expect(query).toHaveBeenCalledWith("SELECT Id FROM Account LIMIT 5");
	});

	it("validateQuery tooling keeps FOR UPDATE valid with limit rewrite", async () => {
		const fetcher = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ records: [], totalSize: 0, done: true }),
		});
		const service = new SoqlService({
			fetcher: fetcher as never,
			connectionFactory: async () =>
				({
					instanceUrl: "https://example.my.salesforce.com",
					getApiVersion: () => "62.0",
					accessToken: "token",
					describeGlobal: vi.fn(),
					describe: vi.fn(),
					query: vi.fn(),
					queryMore: vi.fn(),
					tooling: { describeGlobal: vi.fn(), describe: vi.fn(), query: vi.fn() },
				}) as never,
		});

		await service.validateQuery({
			username: "u",
			api: "tooling",
			soql: "SELECT Id FROM Account FOR UPDATE",
		});
		expect(fetcher).toHaveBeenCalledWith(
			"https://example.my.salesforce.com/services/data/v62.0/tooling/query/?q=SELECT%20Id%20FROM%20Account%20LIMIT%201%20FOR%20UPDATE",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("runQuery tooling returns first batch when includeAllPages is true", async () => {
		const fetcher = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				records: [{ Id: "001", attributes: { type: "DataType" } }],
				totalSize: 5000,
				done: false,
				nextRecordsUrl: "/services/data/v62.0/tooling/query/next",
			}),
		});
		const queryMore = vi.fn();
		const service = new SoqlService({
			fetcher: fetcher as never,
			connectionFactory: async () =>
				({
					instanceUrl: "https://example.my.salesforce.com",
					getApiVersion: () => "62.0",
					accessToken: "token",
					describeGlobal: vi.fn(),
					describe: vi.fn(),
					query: vi.fn(),
					queryMore,
					tooling: { describeGlobal: vi.fn(), describe: vi.fn(), query: vi.fn() },
				}) as never,
		});

		const result = await service.runQuery({
			username: "u",
			api: "tooling",
			soql: "SELECT Id FROM DataType",
			includeAllPages: true,
		});
		expect(result.records).toEqual([{ Id: "001" }]);
		expect(result.done).toBe(false);
		expect(queryMore).not.toHaveBeenCalled();
	});
});
