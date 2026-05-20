import type { OrgTarget } from "./org";

export type MetadataTypeSummary = {
	xmlName: string;
	label: string;
	directoryName?: string;
	suffix?: string;
	childXmlNames: string[];
	inFolder: boolean;
	metaFile: boolean;
};

export type ListMetadataTypesRequest = {
	target: OrgTarget;
};

export type ListMetadataTypesResponse = {
	target: OrgTarget;
	types: MetadataTypeSummary[];
	apiVersion?: string;
};

export type MetadataComponentSummary = {
	fullName: string;
	type: string;
	id?: string;
	fileName?: string;
	folder?: string;
	parentName?: string;
	namespacePrefix?: string;
	manageableState?: string;
	label?: string;
	developerName?: string;
	createdByName?: string;
	createdDate?: string;
	lastModifiedByName?: string;
	lastModifiedDate?: string;
	raw?: Record<string, unknown>;
};

export type ListMetadataComponentsRequest = {
	target: OrgTarget;
	metadataType: string;
	folder?: string;
	search?: string;
};

export type ListMetadataComponentsError = {
	scope?: string;
	message: string;
};

export type ListMetadataComponentsResponse = {
	target: OrgTarget;
	metadataType: string;
	components: MetadataComponentSummary[];
	apiVersion?: string;
	errors: ListMetadataComponentsError[];
};

export type GetComponentSourceRequest = {
	target: OrgTarget;
	metadataType: string;
	fullName: string;
	fileName?: string;
	folder?: string;
};

export type GetComponentSourceResponse = {
	target: OrgTarget;
	metadataType: string;
	fullName: string;
	source?: string;
	truncated?: boolean;
	error?: {
		message: string;
		scope?: string;
	};
	apiVersion?: string;
};

export type CrossOrgDiffComponentInput = {
	metadataType: string;
	fullName: string;
	fileName?: string;
	folder?: string;
};

export type DiffComponentState =
	| "Same"
	| "Changed"
	| "MissingInTarget"
	| "MissingInSource"
	| "Error";

export type CrossOrgDiffRequest = {
	source: OrgTarget;
	target: OrgTarget;
	components: CrossOrgDiffComponentInput[];
};

export type CrossOrgDiffResult = {
	metadataType: string;
	fullName: string;
	// Per-resource filename for bundle-style metadata (e.g. LWC/Aura); undefined for single-file types.
	fileName?: string;
	state: DiffComponentState;
	sourceXml?: string;
	targetXml?: string;
	message?: string;
};

export type CrossOrgDiffResponse = {
	source: OrgTarget;
	target: OrgTarget;
	results: CrossOrgDiffResult[];
};
