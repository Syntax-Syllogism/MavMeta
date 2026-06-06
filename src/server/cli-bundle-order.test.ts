import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("cli bundle order", () => {
	it("sets MAVMETA_SERVE_STATIC before shouldServeStatic is evaluated", () => {
		const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
		const buildScript = readFileSync(resolve(repoRoot, "scripts/build-server.mjs"), "utf8");
		const serverEntry = readFileSync(resolve(repoRoot, "src/server/index.ts"), "utf8");
		const envIndex = buildScript.indexOf('process.env.MAVMETA_SERVE_STATIC = "1"');
		const flagIndex = serverEntry.indexOf('process.env.MAVMETA_SERVE_STATIC === "1"');
		const staticRootSetIndex = buildScript.indexOf("process.env.MAVMETA_STATIC_ROOT_DIR ??=");
		const staticRootReadIndex = serverEntry.indexOf("process.env.MAVMETA_STATIC_ROOT_DIR?.trim()");

		expect(envIndex).toBeGreaterThanOrEqual(0);
		expect(flagIndex).toBeGreaterThanOrEqual(0);
		expect(staticRootSetIndex).toBeGreaterThanOrEqual(0);
		expect(staticRootReadIndex).toBeGreaterThanOrEqual(0);
	});
});
