import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openInSystemBrowser } from "./system-browser";

describe("openInSystemBrowser", () => {
	const spawnMock = vi.fn();

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("resolves when spawn succeeds", async () => {
		const child = new EventEmitter() as EventEmitter & { unref: () => void };
		child.unref = vi.fn();
		spawnMock.mockReturnValue(child);
		queueMicrotask(() => child.emit("spawn"));

		await expect(openInSystemBrowser("http://127.0.0.1:8787", spawnMock as any)).resolves.toBeUndefined();
		expect(child.unref).toHaveBeenCalledTimes(1);
	});

	it("opens Windows URLs without cmd shell splitting query parameters", async () => {
		const child = new EventEmitter() as EventEmitter & { unref: () => void };
		child.unref = vi.fn();
		spawnMock.mockReturnValue(child);
		queueMicrotask(() => child.emit("spawn"));
		const url = "https://login.salesforce.com/services/oauth2/authorize?state=abc&response_type=code&client_id=PlatformCLI";

		await expect(openInSystemBrowser(url, spawnMock as any, "win32")).resolves.toBeUndefined();

		expect(spawnMock).toHaveBeenCalledWith(
			"rundll32",
			["url.dll,FileProtocolHandler", url],
			expect.objectContaining({ detached: true }),
		);
	});

	it("rejects when spawn errors before spawn event", async () => {
		const child = new EventEmitter() as EventEmitter & { unref: () => void };
		child.unref = vi.fn();
		spawnMock.mockReturnValue(child);
		queueMicrotask(() => child.emit("error", new Error("missing opener")));

		await expect(openInSystemBrowser("http://127.0.0.1:8787", spawnMock as any)).rejects.toThrow(
			"missing opener",
		);
	});
});
