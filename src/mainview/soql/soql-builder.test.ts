import { describe, expect, it } from "vitest";

import { buildSoql } from "./soql-builder";

describe("buildSoql", () => {
	it("returns empty query when no object is selected", () => {
		expect(
			buildSoql({ sobject: "", selectedFields: ["Id"], filters: [], filterLogic: "AND" }),
		).toBe("");
	});

	it("builds minimal query", () => {
		expect(
			buildSoql({ sobject: "Account", selectedFields: ["Id"], filters: [], filterLogic: "AND" }),
		).toBe("SELECT Id FROM Account");
	});

	it("builds filters and order/limit", () => {
		expect(
			buildSoql({
				sobject: "Contact",
				selectedFields: ["Id", "Name"],
				filters: [
					{ field: "LastName", operator: "LIKE", value: "Ada%" },
					{ field: "IsDeleted", operator: "=", value: "false" },
				],
				filterLogic: "AND",
				orderBy: { field: "LastName", direction: "ASC" },
				limit: 10,
			}),
		).toBe(
			"SELECT Id, Name FROM Contact WHERE LastName LIKE 'Ada%' AND IsDeleted = false ORDER BY LastName ASC LIMIT 10",
		);
	});

	it("supports OR filter logic with null operator", () => {
		expect(
			buildSoql({
				sobject: "Account",
				selectedFields: ["Id"],
				filters: [
					{ field: "Name", operator: "LIKE", value: "Acme%" },
					{ field: "OwnerId", operator: "!= null" },
				],
				filterLogic: "OR",
			}),
		).toBe("SELECT Id FROM Account WHERE Name LIKE 'Acme%' OR OwnerId != null");
	});

	it("keeps IN clauses unquoted when wrapped in parentheses", () => {
		expect(
			buildSoql({
				sobject: "Case",
				selectedFields: ["Id"],
				filters: [{ field: "Status", operator: "IN", value: "('New','Working')" }],
				filterLogic: "AND",
			}),
		).toBe("SELECT Id FROM Case WHERE Status IN ('New','Working')");
	});

	it("quotes numeric-looking values for string-like field types", () => {
		expect(
			buildSoql({
				sobject: "Account",
				selectedFields: ["Id"],
				filters: [{ field: "Phone", fieldType: "phone", operator: "LIKE", value: "123" }],
				filterLogic: "AND",
			}),
		).toBe("SELECT Id FROM Account WHERE Phone LIKE '123'");
	});

	it("omits filters with value operators when the value is empty", () => {
		expect(
			buildSoql({
				sobject: "Account",
				selectedFields: ["Id"],
				filters: [{ field: "Name", operator: "LIKE", value: "" }],
				filterLogic: "AND",
			}),
		).toBe("SELECT Id FROM Account");
	});

	it("keeps date and datetime values unquoted", () => {
		expect(
			buildSoql({
				sobject: "Opportunity",
				selectedFields: ["Id"],
				filters: [
					{ field: "CloseDate", fieldType: "date", operator: "=", value: "2026-01-01" },
					{
						field: "CreatedDate",
						fieldType: "datetime",
						operator: ">",
						value: "2026-01-01T00:00:00Z",
					},
				],
				filterLogic: "AND",
			}),
		).toBe(
			"SELECT Id FROM Opportunity WHERE CloseDate = 2026-01-01 AND CreatedDate > 2026-01-01T00:00:00Z",
		);
	});

	it("keeps numeric values unquoted for numeric field types", () => {
		expect(
			buildSoql({
				sobject: "Opportunity",
				selectedFields: ["Id"],
				filters: [{ field: "Amount", fieldType: "currency", operator: ">", value: "42.5" }],
				filterLogic: "AND",
			}),
		).toBe("SELECT Id FROM Opportunity WHERE Amount > 42.5");
	});
});
