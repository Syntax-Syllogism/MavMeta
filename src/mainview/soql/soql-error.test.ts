import { describe, expect, it } from "vitest";

import { parseSoqlError } from "./soql-error";

describe("parseSoqlError", () => {
	it("extracts line/column from explicit location text", () => {
		const parsed = parseSoqlError("MALFORMED_QUERY: unexpected token at line 3 at column 19");
		expect(parsed).toEqual({
			message: "MALFORMED_QUERY: unexpected token at line 3 at column 19",
			line: 3,
			column: 19,
		});
	});

	it("extracts caret column from multiline salesforce error blocks", () => {
		const parsed = parseSoqlError(`SELECT Id FROM Account WHER Name = 'x'
                       ^
ERROR at Row:1:Column:24
No such column 'WHER' on entity 'Account'.`);
		expect(parsed.message).toBe("No such column 'WHER' on entity 'Account'.");
		expect(parsed.line).toBe(1);
		expect(parsed.column).toBe(24);
	});

	it("falls back to first line when no location metadata exists", () => {
		const parsed = parseSoqlError("Salesforce access token is missing.");
		expect(parsed).toEqual({ message: "Salesforce access token is missing." });
	});
});
