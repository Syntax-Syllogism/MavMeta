import { beforeEach, describe, expect, it, vi } from "vitest";

describe("backendClient session token bootstrap", () => {
	beforeEach(() => {
		vi.resetModules();
		document.head.innerHTML = "";
		document.body.innerHTML = "";
		vi.unstubAllGlobals();
	});

	it("does not throw on module import when session meta tag is missing", async () => {
		await expect(import("./backend-client")).resolves.toBeDefined();
	});

	it("throws a clear error when an API call is made without session meta tag", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 404,
			json: async () => ({}),
		});
		vi.stubGlobal("fetch", fetchMock);
		const { backendClient } = await import("./backend-client");

		await expect(backendClient.listOrgs()).rejects.toThrow(
			'Missing required session token meta tag "MavMeta-session".',
		);
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/session",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("bootstraps session token from backend and uses it for API calls", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({ token: "bootstrapped-session-token" }),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({ orgs: [] }),
			});
		vi.stubGlobal("fetch", fetchMock);
		const { backendClient } = await import("./backend-client");

		await expect(backendClient.listOrgs()).resolves.toEqual({ orgs: [] });
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"/api/orgs",
			expect.objectContaining({
				method: "GET",
				headers: expect.objectContaining({
					"x-mavmeta-session": "bootstrapped-session-token",
				}),
			}),
		);
	});
});
