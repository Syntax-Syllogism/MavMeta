import type { FieldAccessRow } from "../../shared/field-access";

export function filterFieldAccessRows(
	rows: FieldAccessRow[],
	search: string,
	includeMuted: boolean,
): FieldAccessRow[] {
	const normalizedSearch = search.trim().toLowerCase();
	return rows.filter((row) => {
		if (!includeMuted && row.accessLevel === "None (Muted)") return false;
		if (!normalizedSearch) return true;
		return [row.userName, row.username, row.sourceName, row.viaPermissionSetName]
			.filter((value): value is string => typeof value === "string" && value.length > 0)
			.some((value) => value.toLowerCase().includes(normalizedSearch));
	});
}

export function buildFieldAccessCsvRows(rows: FieldAccessRow[]): Record<string, unknown>[] {
	return rows.map((row) => ({
		userName: row.userName,
		username: row.username,
		accessLevel: row.accessLevel,
		assignmentType: row.assignmentType,
		sourceName: row.sourceName,
		viaPermissionSetName: row.viaPermissionSetName ?? "",
		mutedBySourceName: row.mutedBySourceName ?? "",
		userId: row.userId,
		sourceId: row.sourceId,
		viaPermissionSetId: row.viaPermissionSetId ?? "",
		mutedBySourceId: row.mutedBySourceId ?? "",
		isActive: row.isActive,
	}));
}

export function buildFieldAccessCsvFilename(
	sobjectType: string,
	fieldFullName: string,
	now: Date = new Date(),
): string {
	const fieldApiName = fieldFullName.split(".").at(-1) ?? fieldFullName;
	const yyyy = String(now.getFullYear());
	const mm = String(now.getMonth() + 1).padStart(2, "0");
	const dd = String(now.getDate()).padStart(2, "0");
	const hh = String(now.getHours()).padStart(2, "0");
	const min = String(now.getMinutes()).padStart(2, "0");
	return `field-access_${sobjectType}_${fieldApiName}_${yyyy}${mm}${dd}-${hh}${min}.csv`;
}
