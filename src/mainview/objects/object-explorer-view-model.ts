import type { MetadataComponentSummary } from "../../shared/metadata";
import {
	CHILD_CATEGORY_LABELS,
	type ChildMetadataItem,
	type ObjectSummary,
	type ObjectType,
} from "../../shared/object-explorer";

export function matchesObjectSearch(obj: ObjectSummary, search: string): boolean {
	const normalized = search.trim().toLowerCase();
	if (!normalized) return true;
	return [obj.apiName, obj.label, obj.namespacePrefix]
		.filter((v): v is string => v !== undefined)
		.some((v) => v.toLowerCase().includes(normalized));
}

export function getCategoryLabel(metadataType: string): string {
	return CHILD_CATEGORY_LABELS[metadataType] ?? metadataType;
}

export function parseChildFullName(
	fullName: string,
): { parentObject: string; childApiName: string } | undefined {
	const dotIndex = fullName.indexOf(".");
	if (dotIndex <= 0) return undefined;
	return {
		parentObject: fullName.slice(0, dotIndex),
		childApiName: fullName.slice(dotIndex + 1),
	};
}

export function childItemToComponentSummary(item: ChildMetadataItem): MetadataComponentSummary {
	return {
		fullName: item.fullName,
		type: item.metadataType,
		label: item.label,
		parentName: item.parentObject,
		developerName: item.childApiName,
		manageableState: item.manageableState,
		lastModifiedByName: item.lastModifiedByName,
		lastModifiedDate: item.lastModifiedDate,
		raw: item.raw,
	};
}

const OBJECT_TYPE_LABELS: Record<ObjectType, string> = {
	standard: "Standard Object",
	custom: "Custom Object",
	customMetadata: "Custom Metadata Type",
	platformEvent: "Platform Event",
	customSetting: "Custom Setting",
};

export function getObjectTypeLabel(obj: ObjectSummary): string {
	return OBJECT_TYPE_LABELS[obj.objectType];
}

export function formatChildLabel(childApiName: string): string {
	return childApiName
		.replace(/__[a-z]+$/i, "")
		.replace(/_/g, " ")
		.trim();
}

export function getObjectBadge(obj: ObjectSummary): string {
	if (obj.namespacePrefix) return obj.namespacePrefix;
	return OBJECT_TYPE_LABELS[obj.objectType];
}
