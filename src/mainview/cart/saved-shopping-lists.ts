export const SAVED_METADATA_SHOPPING_LISTS_STORAGE_KEY = "rogueforce.savedMetadataShoppingLists.v1";
export const SAVED_METADATA_SHOPPING_LISTS_VERSION = 1;
// Fallback when org API version is unavailable; keep aligned with product decision in work-item notes.
export const DEFAULT_METADATA_API_VERSION = "62.0";

export type SavedMetadataShoppingListItem = {
	metadataType: string;
	fullName: string;
};

export type SavedMetadataShoppingList = {
	id: string;
	name: string;
	items: SavedMetadataShoppingListItem[];
	createdAt: string;
	updatedAt: string;
};

export type SavedMetadataShoppingListsPayload = {
	version: number;
	lists: SavedMetadataShoppingList[];
};

export function normalizeSavedMetadataItemKey(item: SavedMetadataShoppingListItem) {
	return `${item.metadataType.toLowerCase()}::${item.fullName.toLowerCase()}`;
}

export function dedupeSavedMetadataItems(
	items: SavedMetadataShoppingListItem[],
): SavedMetadataShoppingListItem[] {
	const seen = new Set<string>();
	const deduped: SavedMetadataShoppingListItem[] = [];
	for (const item of items) {
		const key = normalizeSavedMetadataItemKey(item);
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(item);
	}
	return deduped;
}

export function serializeSavedMetadataShoppingLists(
	lists: SavedMetadataShoppingList[],
): string {
	const payload: SavedMetadataShoppingListsPayload = {
		version: SAVED_METADATA_SHOPPING_LISTS_VERSION,
		lists,
	};
	return JSON.stringify(payload);
}

export function parseSavedMetadataShoppingListsPayload(
	serialized: string,
): SavedMetadataShoppingList[] {
	const parsed = JSON.parse(serialized) as Partial<SavedMetadataShoppingListsPayload>;
	if (!parsed || typeof parsed !== "object") {
		return [];
	}
	if (parsed.version !== SAVED_METADATA_SHOPPING_LISTS_VERSION) {
		return [];
	}
	if (!Array.isArray(parsed.lists)) {
		return [];
	}
	return parsed.lists.filter(isSavedMetadataShoppingList).map((list) => ({
		...list,
		items: dedupeSavedMetadataItems(list.items),
	}));
}

function isSavedMetadataShoppingList(value: unknown): value is SavedMetadataShoppingList {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<SavedMetadataShoppingList>;
	return typeof candidate.id === "string" &&
		typeof candidate.name === "string" &&
		typeof candidate.createdAt === "string" &&
		typeof candidate.updatedAt === "string" &&
		Array.isArray(candidate.items) &&
		candidate.items.every(isSavedMetadataShoppingListItem);
}

function isSavedMetadataShoppingListItem(value: unknown): value is SavedMetadataShoppingListItem {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<SavedMetadataShoppingListItem>;
	return typeof candidate.metadataType === "string" && typeof candidate.fullName === "string";
}

export function buildPackageXml(
	items: SavedMetadataShoppingListItem[],
	apiVersion: string = DEFAULT_METADATA_API_VERSION,
): string {
	const byType = new Map<string, string[]>();
	for (const item of dedupeSavedMetadataItems(items)) {
		const members = byType.get(item.metadataType) ?? [];
		members.push(item.fullName);
		byType.set(item.metadataType, members);
	}

	const typeNames = Array.from(byType.keys()).sort((a, b) => a.localeCompare(b));
	const lines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
	];
	for (const typeName of typeNames) {
		lines.push("  <types>");
		const members = (byType.get(typeName) ?? []).toSorted((a, b) => a.localeCompare(b));
		for (const member of members) {
			lines.push(`    <members>${escapeXml(member)}</members>`);
		}
		lines.push(`    <name>${escapeXml(typeName)}</name>`);
		lines.push("  </types>");
	}
	lines.push(`  <version>${escapeXml(apiVersion)}</version>`);
	lines.push("</Package>");
	return lines.join("\n");
}

export function parsePackageXml(xml: string): SavedMetadataShoppingListItem[] {
	const normalized = xml.replace(/\r\n/g, "\n");
	// V1 parser targets standard package.xml structures (<types>/<members>/<name>) without full XML DOM parsing.
	const typeBlocks = Array.from(normalized.matchAll(/<types>([\s\S]*?)<\/types>/g));
	if (!typeBlocks.length) {
		throw new Error("Could not find metadata <types> entries in package.xml.");
	}

	const parsedItems: SavedMetadataShoppingListItem[] = [];
	for (const block of typeBlocks) {
		const body = block[1] ?? "";
		const typeNameMatch = body.match(/<name>([\s\S]*?)<\/name>/);
		if (!typeNameMatch?.[1]) {
			throw new Error("One package.xml <types> entry is missing a <name>.");
		}
		const metadataType = unescapeXml(typeNameMatch[1].trim());
		const members = Array.from(body.matchAll(/<members>([\s\S]*?)<\/members>/g)).map((match) =>
			unescapeXml((match[1] ?? "").trim()),
		);
		if (!members.length) {
			throw new Error(`The ${metadataType} entry has no <members>.`);
		}
		for (const fullName of members) {
			if (!fullName) continue;
			parsedItems.push({ metadataType, fullName });
		}
	}

	return dedupeSavedMetadataItems(parsedItems);
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function unescapeXml(value: string): string {
	return value
		.replaceAll("&apos;", "'")
		.replaceAll("&quot;", '"')
		.replaceAll("&gt;", ">")
		.replaceAll("&lt;", "<")
		.replaceAll("&amp;", "&");
}
