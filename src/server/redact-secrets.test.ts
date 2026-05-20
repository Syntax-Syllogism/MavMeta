import { describe, expect, it } from "vitest";

import { redactSecrets } from "./redact-secrets";

describe("redactSecrets", () => {
	it("redacts bearer tokens and token fields", () => {
		const input =
			'Authorization: Bearer abcdefghijklmnopqrstuvwx123456 access_token=xyz123 refresh_token: "zzz999"';
		const output = redactSecrets(input);
		expect(output).toContain("[REDACTED]");
		expect(output).not.toContain("abcdefghijklmnopqrstuvwx123456");
		expect(output).not.toContain("xyz123");
		expect(output).not.toContain("zzz999");
	});

	it("returns non-secret text unchanged", () => {
		expect(redactSecrets("simple error message")).toBe("simple error message");
	});
});
