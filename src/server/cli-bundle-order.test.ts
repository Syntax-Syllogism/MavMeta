import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("cli bundle order", () => {
	it("sets MAVMETA_SERVE_STATIC before shouldServeStatic is evaluated", () => {
		execFileSync("node", ["scripts/build-server.mjs"], { stdio: "ignore" });
		const bundle = readFileSync("dist-server/index.cjs", "utf8");
		const envIndex = bundle.indexOf('process.env.MAVMETA_SERVE_STATIC = "1"');
		const flagIndex = bundle.indexOf('process.env.MAVMETA_SERVE_STATIC === "1"');

		expect(envIndex).toBeGreaterThanOrEqual(0);
		expect(flagIndex).toBeGreaterThanOrEqual(0);
		expect(envIndex).toBeLessThan(flagIndex);
	});
});
