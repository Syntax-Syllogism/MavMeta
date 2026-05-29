import type { ChildMetadataItem, ObjectSummary } from "../../shared/object-explorer";

export type ObjectListCacheEntry = {
	objects: ObjectSummary[];
	nextCursor: string | undefined;
	done: boolean;
};

export const objectListCache = new Map<string, ObjectListCacheEntry>();

export function getObjectListCacheKey(username: string, search: string | undefined): string {
	return `${username}::${(search ?? "").trim().toLowerCase()}`;
}

export const objectChildrenCache = new Map<
	string,
	{
		children: Record<string, ChildMetadataItem[]>;
		errors: Array<{ metadataType: string; message: string }>;
	}
>();
