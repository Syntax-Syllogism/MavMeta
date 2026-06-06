import type { MetadataComponentSummary } from "../../shared/metadata";
import type { OrgSummary } from "../../shared/org";

export type CartStep = "list" | "actions" | "confirm" | "result";
export type CartAction = "delete" | "deploy" | "compare";

export type StagedItem = {
	id: string;
	orgUsername: string;
	metadataType: string;
	fullName: string;
	component: MetadataComponentSummary;
};

export type StagedItemGroup = {
	metadataType: string;
	items: StagedItem[];
};

export type CompareDiffLine = {
	sourceLineNum?: number;
	targetLineNum?: number;
	sourceLine?: string;
	targetLine?: string;
	/** context = unchanged; remove = deleted from source; add = inserted in target; change = replaced */
	kind: "context" | "remove" | "add" | "change";
};

export function toStagedItemId(orgUsername: string, metadataType: string, fullName: string) {
	return `${orgUsername}::${metadataType}::${fullName.toLowerCase()}`;
}

export function buildStagedItemGroups(stagedItems: StagedItem[]) {
	return Array.from(
		stagedItems.reduce((groups, item) => {
			const items = groups.get(item.metadataType) ?? [];
			items.push(item);
			groups.set(item.metadataType, items);
			return groups;
		}, new Map<string, StagedItem[]>()),
	)
		.map(
			([metadataType, items]): StagedItemGroup => ({
				metadataType,
				items: items.toSorted((left, right) => left.fullName.localeCompare(right.fullName)),
			}),
		)
		.sort((left, right) => left.metadataType.localeCompare(right.metadataType));
}

export function countStagedItemsByMetadataType(stagedItems: StagedItem[]) {
	return Array.from(
		stagedItems
			.reduce((counts, item) => {
				counts.set(item.metadataType, (counts.get(item.metadataType) ?? 0) + 1);
				return counts;
			}, new Map<string, number>())
			.entries(),
	)
		.map(([metadataType, count]) => ({ metadataType, count }))
		.sort((left, right) => left.metadataType.localeCompare(right.metadataType));
}

export function formatItemCount(count: number) {
	return `${count} ${count === 1 ? "item" : "items"}`;
}

export function deriveSingleSourceOrgUsername(stagedItems: StagedItem[]) {
	if (!stagedItems.length) {
		return undefined;
	}
	const source = stagedItems[0]?.orgUsername;
	return stagedItems.every((item) => item.orgUsername === source) ? source : undefined;
}

export function hasMixedSourceOrgs(stagedItems: StagedItem[]) {
	return stagedItems.length > 1 && deriveSingleSourceOrgUsername(stagedItems) === undefined;
}

export function listEligibleTargetOrgs(orgs: OrgSummary[], sourceOrgUsername: string | undefined) {
	return orgs.filter(
		(org) =>
			org.authStatus === "connected" &&
			(sourceOrgUsername === undefined || org.username !== sourceOrgUsername),
	);
}

export function getCartTitle(step: CartStep) {
	if (step === "list") {
		return "Staged Items";
	}

	if (step === "actions") {
		return "Select Action";
	}

	if (step === "confirm") {
		return "Final Confirmation";
	}

	return "Result";
}

export function hasCompareXml(value: string | undefined): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

export function buildCompareDiffLines(
	sourceXml: string | undefined,
	targetXml: string | undefined,
): CompareDiffLine[] {
	if (!hasCompareXml(sourceXml) && !hasCompareXml(targetXml)) {
		return [];
	}

	const sourceLines = hasCompareXml(sourceXml) ? sourceXml.split("\n") : [];
	const targetLines = hasCompareXml(targetXml) ? targetXml.split("\n") : [];

	type RawOp =
		| { kind: "context"; source: string; target: string }
		| { kind: "remove"; source: string }
		| { kind: "add"; target: string };

	const ops: RawOp[] = [];
	const MAX_LCS_LINES = 500;

	if (sourceLines.length <= MAX_LCS_LINES && targetLines.length <= MAX_LCS_LINES) {
		const m = sourceLines.length;
		const n = targetLines.length;
		const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
		for (let i = 1; i <= m; i++) {
			for (let j = 1; j <= n; j++) {
				dp[i][j] =
					sourceLines[i - 1] === targetLines[j - 1]
						? dp[i - 1][j - 1] + 1
						: Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
		let i = m;
		let j = n;
		while (i > 0 || j > 0) {
			if (i > 0 && j > 0 && sourceLines[i - 1] === targetLines[j - 1]) {
				ops.unshift({ kind: "context", source: sourceLines[i - 1]!, target: targetLines[j - 1]! });
				i--;
				j--;
			} else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
				ops.unshift({ kind: "add", target: targetLines[j - 1]! });
				j--;
			} else {
				ops.unshift({ kind: "remove", source: sourceLines[i - 1]! });
				i--;
			}
		}
	} else {
		// Fallback for very large files: pair lines by index
		const max = Math.max(sourceLines.length, targetLines.length);
		for (let idx = 0; idx < max; idx++) {
			const s = sourceLines[idx];
			const t = targetLines[idx];
			if (s !== undefined && t !== undefined) {
				if (s === t) {
					ops.push({ kind: "context", source: s, target: t });
				} else {
					ops.push({ kind: "remove", source: s });
					ops.push({ kind: "add", target: t });
				}
			} else if (s !== undefined) {
				ops.push({ kind: "remove", source: s });
			} else if (t !== undefined) {
				ops.push({ kind: "add", target: t });
			}
		}
	}

	// Build side-by-side rows, pairing adjacent remove+add as "change"
	const rows: CompareDiffLine[] = [];
	let sourceNum = 1;
	let targetNum = 1;
	let idx = 0;
	while (idx < ops.length) {
		const op = ops[idx]!;
		if (op.kind === "context") {
			rows.push({
				kind: "context",
				sourceLineNum: sourceNum++,
				targetLineNum: targetNum++,
				sourceLine: op.source,
				targetLine: op.target,
			});
			idx++;
		} else if (op.kind === "remove") {
			const next = ops[idx + 1];
			if (next?.kind === "add") {
				rows.push({
					kind: "change",
					sourceLineNum: sourceNum++,
					targetLineNum: targetNum++,
					sourceLine: op.source,
					targetLine: next.target,
				});
				idx += 2;
			} else {
				rows.push({ kind: "remove", sourceLineNum: sourceNum++, sourceLine: op.source });
				idx++;
			}
		} else {
			rows.push({ kind: "add", targetLineNum: targetNum++, targetLine: op.target });
			idx++;
		}
	}

	return rows;
}
