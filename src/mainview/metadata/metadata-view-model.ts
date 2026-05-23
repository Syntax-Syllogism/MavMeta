import type { MetadataComponentSummary, MetadataTypeSummary } from "../../shared/metadata";

export type MetadataComponentGroup = {
	name: string;
	components: MetadataComponentSummary[];
	isExpanded: boolean;
};

export function matchesMetadataTypeFilter(metadataType: MetadataTypeSummary, filter: string) {
	const normalizedFilter = filter.trim().toLowerCase();

	if (!normalizedFilter) {
		return true;
	}

	return [metadataType.label, metadataType.xmlName, metadataType.directoryName, metadataType.suffix]
		.filter((value): value is string => value !== undefined)
		.some((value) => value.toLowerCase().includes(normalizedFilter));
}

export function matchesMetadataComponentSearch(
	component: MetadataComponentSummary,
	filter: string,
) {
	const normalizedFilter = filter.trim().toLowerCase();

	if (!normalizedFilter) {
		return true;
	}

	return [
		component.fullName,
		component.label,
		component.developerName,
		component.fileName,
		component.folder,
		component.parentName,
		component.namespacePrefix,
	]
		.filter((value): value is string => value !== undefined)
		.some((value) => value.toLowerCase().includes(normalizedFilter));
}

export function buildMetadataComponentGroups(
	components: MetadataComponentSummary[],
	expandedGroups: string[],
): MetadataComponentGroup[] {
	const groupedComponents = new Map<string, MetadataComponentSummary[]>();

	for (const component of components) {
		const groupName = getMetadataComponentGroupName(component);
		const group = groupedComponents.get(groupName) ?? [];
		group.push(component);
		groupedComponents.set(groupName, group);
	}

	return Array.from(groupedComponents.entries())
		.map(([name, groupComponents]) => ({
			name,
			components: groupComponents.sort(compareMetadataComponentsForDisplay),
			isExpanded: expandedGroups.includes(name),
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
}

export function getMetadataComponentGroupName(component: MetadataComponentSummary) {
	return component.parentName ?? component.folder ?? component.namespacePrefix ?? "Ungrouped";
}

export function formatMetadataDetailValue(value: string | undefined) {
	return value?.trim() ? value : "n/a";
}

export function formatRawMetadata(component: MetadataComponentSummary) {
	return JSON.stringify(component.raw ?? component, null, 2);
}

export function getGroupedComponentDisplayName(
	component: MetadataComponentSummary,
	groupName: string,
) {
	const groupPrefix = `${groupName}/`;
	if (component.fullName.startsWith(groupPrefix)) {
		return component.fullName.slice(groupPrefix.length);
	}
	const segments = component.fullName.split("/");
	return segments.at(-1) ?? component.fullName;
}

function compareMetadataComponentsForDisplay(
	left: MetadataComponentSummary,
	right: MetadataComponentSummary,
) {
	const leftTimestamp = toTimestamp(left.lastModifiedDate);
	const rightTimestamp = toTimestamp(right.lastModifiedDate);

	if (leftTimestamp !== rightTimestamp) {
		return rightTimestamp - leftTimestamp;
	}

	return left.fullName.localeCompare(right.fullName);
}

function toTimestamp(value: string | undefined) {
	if (!value) {
		return Number.NEGATIVE_INFINITY;
	}

	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}
