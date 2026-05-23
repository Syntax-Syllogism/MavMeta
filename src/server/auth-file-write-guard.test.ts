import { describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";

import { assertWriteAllowed } from "./auth-file-write-guard";

describe("assertWriteAllowed", () => {
	it("throws in block mode for protected Salesforce auth paths", () => {
		const authPath = path.join(os.homedir(), ".sfdx", "some-user@example.com.json");
		expect(() => assertWriteAllowed(authPath, "w", "block")).toThrow(
			"Write access to Salesforce auth path is forbidden",
		);
	});

	it("warns and does not throw in warn mode for protected Salesforce auth paths", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const authPath = path.join(os.homedir(), ".sfdx", "some-user@example.com.json");
		expect(() => assertWriteAllowed(authPath, "w", "warn")).not.toThrow();
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});
