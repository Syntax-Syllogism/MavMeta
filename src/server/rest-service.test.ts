import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api-error";
import { RestService } from "./rest-service";

function makeConnection(overrides: { instanceUrl?: string; accessToken?: string } = {}) {
	return {
		instanceUrl: "https://test.salesforce.com",
		accessToken: "test-token",
		...overrides,
	};
}

function makeFetchResponse(status: number, body: string, contentType = "application/json") {
	const headerMap = new Map([["content-type", contentType]]);
	return {
		status,
		text: async () => body,
		headers: {
			get: (key: string) => headerMap.get(key.toLowerCase()) ?? null,
			forEach: (cb: (value: string, key: string) => void) => headerMap.forEach(cb),
		},
	} as unknown as Response;
}

describe("RestService", () => {
	let connectionFactory: ReturnType<typeof vi.fn>;
	let fetcher: ReturnType<typeof vi.fn>;
	let service: RestService;

	beforeEach(() => {
		connectionFactory = vi.fn().mockResolvedValue(makeConnection());
		fetcher = vi.fn();
		service = new RestService({
			connectionFactory: connectionFactory as (
				username: string,
			) => Promise<{ instanceUrl: string; accessToken: string | undefined }>,
			fetcher: fetcher as typeof fetch,
		});
	});

	describe("path validation", () => {
		it("rejects paths not starting with /services/", async () => {
			await expect(
				service.executeRequest({
					username: "user@example.com",
					method: "GET",
					path: "/api/external/path",
				}),
			).rejects.toBeInstanceOf(ApiError);
		});

		it("rejects absolute URLs", async () => {
			await expect(
				service.executeRequest({
					username: "user@example.com",
					method: "GET",
					path: "https://evil.com/steal",
				}),
			).rejects.toBeInstanceOf(ApiError);
		});

		it("includes INVALID_PATH error code on rejection", async () => {
			await expect(
				service.executeRequest({
					username: "user@example.com",
					method: "GET",
					path: "/records/Account",
				}),
			).rejects.toMatchObject({ code: "INVALID_PATH" });
		});

		it("accepts /services/ paths", async () => {
			fetcher.mockResolvedValue(makeFetchResponse(200, "{}"));
			await expect(
				service.executeRequest({
					username: "user@example.com",
					method: "GET",
					path: "/services/data/v62.0/limits",
				}),
			).resolves.toBeDefined();
		});

		it("accepts /services/apexrest/ custom paths", async () => {
			fetcher.mockResolvedValue(makeFetchResponse(200, "{}"));
			await expect(
				service.executeRequest({
					username: "user@example.com",
					method: "GET",
					path: "/services/apexrest/MyService",
				}),
			).resolves.toBeDefined();
		});
	});

	describe("response mapping", () => {
		it("parses JSON response body and sets isJson true", async () => {
			fetcher.mockResolvedValue(makeFetchResponse(200, JSON.stringify({ total: 1 })));

			const result = await service.executeRequest({
				username: "user@example.com",
				method: "GET",
				path: "/services/data/v62.0/limits",
			});

			expect(result.status).toBe(200);
			expect(result.isJson).toBe(true);
			expect(result.body).toEqual({ total: 1 });
		});

		it("returns raw text for non-JSON content type and sets isJson false", async () => {
			fetcher.mockResolvedValue(makeFetchResponse(200, "plain body", "text/plain"));

			const result = await service.executeRequest({
				username: "user@example.com",
				method: "GET",
				path: "/services/data/v62.0/sobjects",
			});

			expect(result.isJson).toBe(false);
			expect(result.body).toBe("plain body");
		});

		it("returns non-2xx status as structured response without throwing", async () => {
			fetcher.mockResolvedValue(
				makeFetchResponse(404, JSON.stringify([{ errorCode: "NOT_FOUND", message: "nope" }])),
			);

			const result = await service.executeRequest({
				username: "user@example.com",
				method: "GET",
				path: "/services/data/v62.0/sobjects/Nope",
			});

			expect(result.status).toBe(404);
			expect(result.isJson).toBe(true);
		});

		it("includes durationMs in response", async () => {
			fetcher.mockResolvedValue(makeFetchResponse(200, "{}"));

			const result = await service.executeRequest({
				username: "user@example.com",
				method: "GET",
				path: "/services/data/v62.0/limits",
			});

			expect(typeof result.durationMs).toBe("number");
			expect(result.durationMs).toBeGreaterThanOrEqual(0);
		});
	});

	describe("request forwarding", () => {
		it("sends Authorization bearer token from connection", async () => {
			connectionFactory.mockResolvedValue(makeConnection({ accessToken: "my-secret" }));
			fetcher.mockResolvedValue(makeFetchResponse(200, "{}"));

			await service.executeRequest({
				username: "user@example.com",
				method: "GET",
				path: "/services/data/v62.0/limits",
			});

			expect(fetcher).toHaveBeenCalledWith(
				"https://test.salesforce.com/services/data/v62.0/limits",
				expect.objectContaining({
					headers: expect.objectContaining({ Authorization: "Bearer my-secret" }),
				}),
			);
		});

		it("merges custom headers with default auth headers", async () => {
			fetcher.mockResolvedValue(makeFetchResponse(200, "{}"));

			await service.executeRequest({
				username: "user@example.com",
				method: "GET",
				path: "/services/data/v62.0/limits",
				headers: { "X-PrettyPrint": "1" },
			});

			expect(fetcher).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: expect.stringContaining("Bearer"),
						"X-PrettyPrint": "1",
					}),
				}),
			);
		});

		it("forwards body on POST requests", async () => {
			fetcher.mockResolvedValue(makeFetchResponse(201, JSON.stringify({ id: "001xx" })));
			const requestBody = JSON.stringify({ Name: "Test Account" });

			await service.executeRequest({
				username: "user@example.com",
				method: "POST",
				path: "/services/data/v62.0/sobjects/Account",
				body: requestBody,
			});

			expect(fetcher).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ method: "POST", body: requestBody }),
			);
		});

		it("builds URL from instanceUrl and path", async () => {
			connectionFactory.mockResolvedValue(
				makeConnection({ instanceUrl: "https://custom.my.salesforce.com" }),
			);
			fetcher.mockResolvedValue(makeFetchResponse(200, "{}"));

			await service.executeRequest({
				username: "user@example.com",
				method: "GET",
				path: "/services/data/v62.0/limits",
			});

			expect(fetcher).toHaveBeenCalledWith(
				"https://custom.my.salesforce.com/services/data/v62.0/limits",
				expect.anything(),
			);
		});

		it("rejects connection instanceUrl outside salesforce domains", async () => {
			connectionFactory.mockResolvedValue(
				makeConnection({ instanceUrl: "https://evil.example.com" }),
			);

			await expect(
				service.executeRequest({
					username: "user@example.com",
					method: "GET",
					path: "/services/data/v62.0/limits",
				}),
			).rejects.toMatchObject({ code: "INVALID_SALESFORCE_HOST" });
			expect(fetcher).not.toHaveBeenCalled();
		});

		it("rejects non-https connection instanceUrl", async () => {
			connectionFactory.mockResolvedValue(
				makeConnection({ instanceUrl: "http://test.salesforce.com" }),
			);

			await expect(
				service.executeRequest({
					username: "user@example.com",
					method: "GET",
					path: "/services/data/v62.0/limits",
				}),
			).rejects.toMatchObject({ code: "INVALID_SALESFORCE_HOST" });
			expect(fetcher).not.toHaveBeenCalled();
		});
	});
});
