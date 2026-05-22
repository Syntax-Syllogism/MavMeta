export type SoqlFilter = {
	field: string;
	operator: string;
	value?: string;
	fieldType?: string;
};

export type SoqlBuilderState = {
	sobject: string;
	selectedFields: string[];
	filters: SoqlFilter[];
	filterLogic: "AND" | "OR";
	orderBy?: { field: string; direction: "ASC" | "DESC" };
	limit?: number;
};

export function buildSoql(state: SoqlBuilderState): string {
	if (!state.sobject.trim()) {
		return "";
	}
	const fields = state.selectedFields.length ? state.selectedFields.join(", ") : "Id";
	const clauses = [`SELECT ${fields}`, `FROM ${state.sobject}`];
	const where = state.filters
		.filter((filter) => filter.field && filter.operator)
		.map((filter) => {
			if (filter.value === undefined || filter.value === "") {
				if (!isValueLessOperator(filter.operator)) {
					return "";
				}
				return `${filter.field} ${filter.operator}`;
			}
			return `${filter.field} ${filter.operator} ${formatValue(filter.value, filter.fieldType)}`;
		})
		.filter((clause) => clause.length > 0);
	if (where.length) clauses.push(`WHERE ${where.join(` ${state.filterLogic} `)}`);
	if (state.orderBy?.field) clauses.push(`ORDER BY ${state.orderBy.field} ${state.orderBy.direction}`);
	if (state.limit && state.limit > 0) clauses.push(`LIMIT ${state.limit}`);
	return clauses.join(" ");
}

function formatValue(value: string, fieldType?: string): string {
	if (value.startsWith("(") && value.endsWith(")")) return value;
	const type = (fieldType ?? "").toLowerCase();
	if (isDateLikeType(type)) return value;
	if (isStringLikeType(type)) return `'${value.replaceAll("'", "\\'")}'`;
	if (/^-?\d+(\.\d+)?$/.test(value)) return value;
	if (/^(true|false|null)$/i.test(value)) return value;
	return `'${value.replaceAll("'", "\\'")}'`;
}

function isStringLikeType(type: string): boolean {
	return type === "string"
		|| type === "textarea"
		|| type === "email"
		|| type === "phone"
		|| type === "url"
		|| type === "id"
		|| type === "reference"
		|| type === "picklist"
		|| type === "multipicklist";
}

function isDateLikeType(type: string): boolean {
	return type === "date" || type === "datetime" || type === "time";
}

function isValueLessOperator(operator: string): boolean {
	return operator === "= null" || operator === "!= null";
}
