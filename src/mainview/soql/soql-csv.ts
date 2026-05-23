export function toCsv(records: Record<string, unknown>[]): string {
	if (!records.length) return "";
	const columns = Array.from(new Set(records.flatMap((record) => Object.keys(record))));
	const header = columns.join(",");
	const rows = records.map((record) =>
		columns.map((column) => escapeCsvCell(record[column])).join(","),
	);
	return [header, ...rows].join("\n");
}

export function parseCsv(
	csv: string,
	options: { parseScalars?: boolean } = {},
): Record<string, unknown>[] {
	const rows = parseCsvRows(csv);
	if (!rows.length) return [];
	const [headerRow, ...dataRows] = rows;
	const headers = headerRow ?? [];
	return dataRows.map((row) => {
		const record: Record<string, unknown> = {};
		headers.forEach((header, index) => {
			const cell = row[index] ?? "";
			record[header] = options.parseScalars ? parseScalar(cell) : cell;
		});
		return record;
	});
}

function parseScalar(value: string): unknown {
	const trimmed = value.trim();
	if (!trimmed) return "";
	if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true";
	if (/^null$/i.test(trimmed)) return null;
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
	return value;
}

function parseCsvRows(csv: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let index = 0; index < csv.length; index += 1) {
		const char = csv[index];
		if (char === '"') {
			const next = csv[index + 1];
			if (inQuotes && next === '"') {
				current += '"';
				index += 1;
				continue;
			}
			inQuotes = !inQuotes;
			continue;
		}

		if (char === "," && !inQuotes) {
			row.push(current);
			current = "";
			continue;
		}

		if ((char === "\n" || char === "\r") && !inQuotes) {
			if (char === "\r" && csv[index + 1] === "\n") {
				index += 1;
			}
			row.push(current);
			current = "";
			if (row.length > 1 || row[0] !== "") {
				rows.push(row);
			}
			row = [];
			continue;
		}

		current += char;
	}

	if (current.length > 0 || row.length > 0) {
		row.push(current);
		rows.push(row);
	}

	return rows;
}

function escapeCsvCell(value: unknown): string {
	const raw = value === undefined || value === null ? "" : toDisplayString(value);
	if (/[",\n\r]/.test(raw)) {
		return `"${raw.replaceAll('"', '""')}"`;
	}
	return raw;
}

function toDisplayString(value: unknown): string {
	if (typeof value === "object") {
		return JSON.stringify(value);
	}
	return String(value);
}
