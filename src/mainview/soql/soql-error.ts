export type ParsedSoqlError = {
	message: string;
	line?: number;
	column?: number;
};

const CARET_LINE = /^\s*\^+\s*$/;
const ROW_COLUMN_LINE = /ERROR at Row:(\d+):Column:(\d+)/i;

export function parseSoqlError(input: string): ParsedSoqlError {
	const raw = input.trim();
	if (!raw) return { message: "SOQL validation failed." };
	const lines = raw.split(/\r?\n/);

	const caretIndex = lines.findIndex((line) => CARET_LINE.test(line));
	if (caretIndex > 0) {
		const errorIndex = lines.findIndex((line) => ROW_COLUMN_LINE.test(line));
		const errorLine = errorIndex >= 0 ? lines[errorIndex] : "";
		const rowColumn = errorLine.match(ROW_COLUMN_LINE);
		const line = rowColumn ? Number.parseInt(rowColumn[1] ?? "", 10) : 1;
		const column = rowColumn ? Number.parseInt(rowColumn[2] ?? "", 10) : Math.max(1, (lines[caretIndex] ?? "").search(/\^/) + 1);
		const message = errorIndex >= 0
			? lines.slice(errorIndex + 1).join(" ").trim()
			: "";
		return {
			message: message || "SOQL validation failed.",
			line: Number.isFinite(line) ? line : undefined,
			column: Number.isFinite(column) ? column : undefined,
		};
	}

	const locationMatch = raw.match(/line\s+(\d+)\s+at\s+column\s+(\d+)/i);
	if (locationMatch) {
		const line = Number.parseInt(locationMatch[1] ?? "", 10);
		const column = Number.parseInt(locationMatch[2] ?? "", 10);
		return {
			message: lines[0] ?? raw,
			line: Number.isFinite(line) ? line : undefined,
			column: Number.isFinite(column) ? column : undefined,
		};
	}

	return { message: lines[0] ?? raw };
}
