import { describe, expect, it } from "vitest";

import { parseCsv, toCsv } from "./soql-csv";

describe("soql-csv", () => {
	it("serializes CSV with escaping", () => {
		const csv = toCsv([{ Id: "001", Name: "Acme, Inc", Note: "a\nline" }]);
		expect(csv).toBe('Id,Name,Note\n001,"Acme, Inc","a\nline"');
	});

	it("parses quoted multiline values", () => {
		const csv = 'Id,Description\n001,"Line 1\nLine 2"\n';
		expect(parseCsv(csv)).toEqual([{ Id: "001", Description: "Line 1\nLine 2" }]);
	});

	it("optionally parses scalar values for JSON export normalization", () => {
		const csv = "Flag,Amount,Empty,Word,Nothing\ntrue,10.5,,Acme,null\n";
		expect(parseCsv(csv, { parseScalars: true })).toEqual([
			{ Flag: true, Amount: 10.5, Empty: "", Word: "Acme", Nothing: null },
		]);
	});
});
