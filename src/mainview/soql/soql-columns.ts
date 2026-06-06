export function extractSelectedPaths(soql: string): string[] {
	const selectMatch = soql.match(/^\s*SELECT\s+/i);
	if (!selectMatch) return [];
	const clauseStart = selectMatch[0].length;

	// Scan for the outer FROM at paren depth 0, so FROM inside child subqueries is skipped.
	let depth = 0;
	let fromIdx = -1;
	for (let i = clauseStart; i < soql.length; i++) {
		if (soql[i] === "(") depth++;
		else if (soql[i] === ")") depth--;
		else if (depth === 0 && /^FROM\b/i.test(soql.slice(i))) {
			fromIdx = i;
			break;
		}
	}
	if (fromIdx === -1) return [];

	const selectClause = soql.slice(clauseStart, fromIdx);

	// Split by comma at depth 0 to avoid splitting inside subqueries like (SELECT … FROM …)
	const tokens: string[] = [];
	depth = 0;
	let start = 0;
	for (let i = 0; i < selectClause.length; i++) {
		if (selectClause[i] === "(") depth++;
		else if (selectClause[i] === ")") depth--;
		else if (selectClause[i] === "," && depth === 0) {
			tokens.push(selectClause.slice(start, i));
			start = i + 1;
		}
	}
	tokens.push(selectClause.slice(start));

	const paths = tokens
		.map((token) => token.trim())
		.filter((token) => token.length > 0 && !token.startsWith("("))
		.map((token) => token.split(/\s+/)[0]);

	// Any function call (SUM, COUNT, MAX, …) means Salesforce returns expr0/expr1 keys,
	// not the column names. Return [] to trigger the Object.keys fallback.
	if (paths.some((path) => path.includes("("))) return [];
	return paths;
}

export function getPathValue(row: Record<string, unknown>, path: string): unknown {
	return path.split(".").reduce<unknown>((acc, segment) => {
		if (acc == null || typeof acc !== "object") return undefined;
		return (acc as Record<string, unknown>)[segment];
	}, row);
}
