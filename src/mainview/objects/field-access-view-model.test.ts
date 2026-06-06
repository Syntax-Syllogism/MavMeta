import { describe, expect, it } from "vitest";

import type { FieldAccessRow } from "../../shared/field-access";
import {
	buildFieldAccessCsvFilename,
	buildFieldAccessCsvRows,
	filterFieldAccessRows,
} from "./field-access-view-model";

const sampleRows: FieldAccessRow[] = [
	{
		userId: "005A",
		userName: "Ada Admin",
		username: "ada@example.com",
		isActive: true,
		accessLevel: "Edit",
		assignmentType: "Profile",
		sourceId: "00eA",
		sourceName: "System Administrator",
	},
	{
		userId: "005B",
		userName: "Bob Builder",
		username: "bob@example.com",
		isActive: true,
		accessLevel: "None (Muted)",
		assignmentType: "PermissionSetGroup",
		sourceId: "0PG1",
		sourceName: "Finance Access",
		viaPermissionSetId: "0PS2",
		viaPermissionSetName: "Finance Field Edit",
		mutedBySourceId: "0PSM",
		mutedBySourceName: "Finance Muting",
	},
];

describe("field access view model", () => {
	it("filters muted rows by default", () => {
		const filtered = filterFieldAccessRows(sampleRows, "", false);
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.userName).toBe("Ada Admin");
	});

	it("matches search case-insensitively across user and source fields", () => {
		expect(filterFieldAccessRows(sampleRows, "ada", true)).toHaveLength(1);
		expect(filterFieldAccessRows(sampleRows, "finance", true)).toHaveLength(1);
		expect(filterFieldAccessRows(sampleRows, "BOB@EXAMPLE.COM", true)).toHaveLength(1);
	});

	it("builds CSV row objects with stable columns and ids", () => {
		const rows = buildFieldAccessCsvRows(sampleRows);
		expect(Object.keys(rows[0] ?? {})).toEqual([
			"userName",
			"username",
			"accessLevel",
			"assignmentType",
			"sourceName",
			"viaPermissionSetName",
			"mutedBySourceName",
			"userId",
			"sourceId",
			"viaPermissionSetId",
			"mutedBySourceId",
			"isActive",
		]);
		expect(rows[1]?.viaPermissionSetId).toBe("0PS2");
		expect(rows[1]?.mutedBySourceId).toBe("0PSM");
	});

	it("builds timestamped CSV filenames", () => {
		const filename = buildFieldAccessCsvFilename(
			"Account",
			"Account.Premium_Tier__c",
			new Date(2026, 4, 24, 13, 7, 0),
		);
		expect(filename).toBe("field-access_Account_Premium_Tier__c_20260524-1307.csv");
	});
});
