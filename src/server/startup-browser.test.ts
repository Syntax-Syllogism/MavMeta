import { describe, expect, it, vi } from "vitest";
import { maybeOpenStaticBrowser } from "./startup-browser";

describe("maybeOpenStaticBrowser", () => {
	it("does nothing when static mode is disabled", async () => {
		const info = vi.fn();
		const warn = vi.fn();
		const openBrowser = vi.fn();

		await maybeOpenStaticBrowser({
			shouldServeStatic: false,
			url: "http://127.0.0.1:1111",
			log: { info, warn },
			openBrowser,
		});

		expect(info).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
		expect(openBrowser).not.toHaveBeenCalled();
	});

	it("opens browser and logs when static mode is enabled", async () => {
		const info = vi.fn();
		const warn = vi.fn();
		const openBrowser = vi.fn().mockResolvedValue(undefined);
		const url = "http://127.0.0.1:2222";

		await maybeOpenStaticBrowser({
			shouldServeStatic: true,
			url,
			log: { info, warn },
			openBrowser,
		});

		expect(info).toHaveBeenCalledWith(`Opening MavMeta at ${url}`);
		expect(openBrowser).toHaveBeenCalledWith(url);
		expect(warn).not.toHaveBeenCalled();
	});

	it("warns but does not throw when opening browser fails", async () => {
		const info = vi.fn();
		const warn = vi.fn();
		const openBrowser = vi.fn().mockRejectedValue(new Error("boom"));
		const url = "http://127.0.0.1:3333";

		await maybeOpenStaticBrowser({
			shouldServeStatic: true,
			url,
			log: { info, warn },
			openBrowser,
		});

		expect(info).toHaveBeenCalledWith(`Opening MavMeta at ${url}`);
		expect(warn).toHaveBeenCalledWith(
			`Could not open browser automatically. Visit ${url} manually.`,
		);
	});
});
