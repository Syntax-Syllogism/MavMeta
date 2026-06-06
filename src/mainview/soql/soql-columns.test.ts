import { describe, expect, it } from "vitest";

import { extractSelectedPaths, getPathValue } from "./soql-columns";

describe("extractSelectedPaths", () => {
	it("returns simple field names", () => {
		expect(extractSelectedPaths("SELECT Id, Name FROM Account")).toEqual(["Id", "Name"]);
	});

	it("returns dotted parent paths", () => {
		expect(
			extractSelectedPaths("SELECT Parent.Name, Parent.IsOwnedByProfile FROM FieldPermissions"),
		).toEqual(["Parent.Name", "Parent.IsOwnedByProfile"]);
	});

	it("returns multiple dotted paths from different parents", () => {
		expect(extractSelectedPaths("SELECT Parent.Name, Owner.Email, Id FROM Opportunity")).toEqual([
			"Parent.Name",
			"Owner.Email",
			"Id",
		]);
	});

	it("skips inner subqueries", () => {
		expect(extractSelectedPaths("SELECT Id, (SELECT Name FROM Contacts) FROM Account")).toEqual([
			"Id",
		]);
	});

	it("skips inner subquery with leading whitespace", () => {
		expect(
			extractSelectedPaths("SELECT Id, Name, (SELECT Id, Name FROM Contacts) FROM Account LIMIT 5"),
		).toEqual(["Id", "Name"]);
	});

	it("includes fields that appear after a child subquery (regression: outer FROM must be paren-aware)", () => {
		// The lazy regex would stop at FROM inside (SELECT … FROM Contacts) and drop Name.
		expect(
			extractSelectedPaths("SELECT Id, (SELECT Name FROM Contacts), Name FROM Account"),
		).toEqual(["Id", "Name"]);
	});

	it("returns empty array when SELECT contains aggregate functions (triggers Object.keys fallback)", () => {
		expect(extractSelectedPaths("SELECT SUM(Amount) FROM Opportunity")).toEqual([]);
		expect(extractSelectedPaths("SELECT MAX(CreatedDate) FROM Account")).toEqual([]);
		expect(extractSelectedPaths("SELECT AVG(Amount), MIN(Amount) FROM Opportunity")).toEqual([]);
	});

	it("returns empty array for COUNT aggregate (P2b: was not caught before GROUP BY check)", () => {
		expect(extractSelectedPaths("SELECT COUNT(Id), Name FROM Account GROUP BY Name")).toEqual([]);
	});

	it("handles multiline SOQL with leading whitespace", () => {
		expect(extractSelectedPaths("SELECT\n  Id,\n  Name\nFROM Account")).toEqual(["Id", "Name"]);
	});

	it("strips aliases (space-separated)", () => {
		expect(extractSelectedPaths("SELECT Name n FROM Account")).toEqual(["Name"]);
	});

	it("strips aliases (AS keyword)", () => {
		expect(extractSelectedPaths("SELECT Id AS myId, Name AS myName FROM Account")).toEqual([
			"Id",
			"Name",
		]);
	});

	it("returns empty array for empty string", () => {
		expect(extractSelectedPaths("")).toEqual([]);
	});

	it("returns empty array when no FROM keyword", () => {
		expect(extractSelectedPaths("SELECT Id Name")).toEqual([]);
	});

	it("handles full FieldPermissions example", () => {
		expect(
			extractSelectedPaths(
				"SELECT ParentId, Parent.Name, Parent.IsOwnedByProfile, SobjectType, Field, PermissionsRead, PermissionsEdit FROM FieldPermissions",
			),
		).toEqual([
			"ParentId",
			"Parent.Name",
			"Parent.IsOwnedByProfile",
			"SobjectType",
			"Field",
			"PermissionsRead",
			"PermissionsEdit",
		]);
	});
});

describe("getPathValue", () => {
	it("returns value for a direct key", () => {
		expect(getPathValue({ Id: "001" }, "Id")).toBe("001");
	});

	it("traverses a single-level dotted path", () => {
		expect(getPathValue({ Parent: { Name: "Acme" } }, "Parent.Name")).toBe("Acme");
	});

	it("traverses a multi-level dotted path", () => {
		expect(getPathValue({ A: { B: { C: 42 } } }, "A.B.C")).toBe(42);
	});

	it("returns undefined when an intermediate key is missing", () => {
		expect(getPathValue({ Id: "001" }, "Parent.Name")).toBeUndefined();
	});

	it("returns undefined when an intermediate value is null", () => {
		expect(getPathValue({ Parent: null }, "Parent.Name")).toBeUndefined();
	});

	it("returns undefined when an intermediate value is a scalar", () => {
		expect(getPathValue({ Parent: "string" }, "Parent.Name")).toBeUndefined();
	});

	it("returns null when the leaf value is null", () => {
		expect(getPathValue({ Parent: { Name: null } }, "Parent.Name")).toBeNull();
	});

	it("handles Salesforce parent object with attributes block", () => {
		const row = {
			Parent: {
				attributes: { type: "Profile", url: "/services/data/v59.0/sobjects/Profile/00e1" },
				Name: "Standard User",
				IsOwnedByProfile: true,
			},
		};
		expect(getPathValue(row, "Parent.Name")).toBe("Standard User");
		expect(getPathValue(row, "Parent.IsOwnedByProfile")).toBe(true);
	});
});
