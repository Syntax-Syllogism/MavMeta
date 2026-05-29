import type { OrgTarget } from "./org";

export type ObjectType =
	| "standard"
	| "custom"
	| "customMetadata"
	| "platformEvent"
	| "customSetting"
	| "bigObject"
	| "externalObject";

export type ObjectSummary = {
	apiName: string;
	label: string;
	objectType: ObjectType;
	namespacePrefix?: string;
	manageableState?: string;
};

export type ListObjectsRequest = {
	target: OrgTarget;
};

export type ListObjectsResponse = {
	target: OrgTarget;
	objects: ObjectSummary[];
};

export type ListObjectsPageRequest = {
	target: OrgTarget;
	cursor?: string;
	search?: string;
	limit?: number;
};

export type ListObjectsPageResponse = {
	target: OrgTarget;
	objects: ObjectSummary[];
	nextCursor?: string;
};

export type ChildMetadataItem = {
	fullName: string;
	childApiName: string;
	parentObject: string;
	metadataType: string;
	label?: string;
	manageableState?: string;
	lastModifiedByName?: string;
	lastModifiedDate?: string;
	raw?: Record<string, unknown>;
};

export type ListObjectChildrenRequest = {
	target: OrgTarget;
	objectApiName: string;
};

export type ListObjectChildrenResponse = {
	target: OrgTarget;
	objectApiName: string;
	children: Record<string, ChildMetadataItem[]>;
	errors: Array<{ metadataType: string; message: string }>;
};

export const OBJECT_CHILD_METADATA_TYPES = [
	"CustomField",
	"ValidationRule",
	"RecordType",
	"FieldSet",
	"ListView",
	"CompactLayout",
	"WebLink",
	"BusinessProcess",
	"SharingReason",
] as const;

export type ObjectChildMetadataType = (typeof OBJECT_CHILD_METADATA_TYPES)[number];

export const CHILD_CATEGORY_LABELS: Record<string, string> = {
	CustomField: "Fields & Relationships",
	ValidationRule: "Validation Rules",
	RecordType: "Record Types",
	FieldSet: "Field Sets",
	ListView: "List Views",
	CompactLayout: "Compact Layouts",
	WebLink: "Buttons, Links & Actions",
	BusinessProcess: "Business Processes",
	SharingReason: "Sharing Reasons",
};
