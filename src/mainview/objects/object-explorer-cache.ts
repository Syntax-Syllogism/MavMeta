import type { ChildMetadataItem, ObjectSummary } from "../../shared/object-explorer";

export const objectListCache = new Map<string, ObjectSummary[]>();

export const objectChildrenCache = new Map<
	string,
	{
		children: Record<string, ChildMetadataItem[]>;
		errors: Array<{ metadataType: string; message: string }>;
	}
>();
