export type SoqlApiType = "rest" | "tooling";

export type SObjectSummary = {
	apiName: string;
	label: string;
	custom: boolean;
	queryable: boolean;
	keyPrefix?: string;
};

export type SoqlFieldInfo = {
	apiName: string;
	label: string;
	type: string;
	length?: number;
	nillable: boolean;
	filterable: boolean;
	sortable: boolean;
	picklistValues?: string[];
	relationshipName?: string;
	referenceTo?: string[];
};

export type DescribeGlobalRequest = { username: string; api: SoqlApiType };
export type DescribeGlobalResponse = { sobjects: SObjectSummary[] };

export type DescribeObjectRequest = { username: string; api: SoqlApiType; sobject: string };
export type DescribeObjectResponse = { sobject: string; fields: SoqlFieldInfo[] };

export type ValidateQueryRequest = { username: string; api: SoqlApiType; soql: string };
export type ValidateQueryResponse = { valid: boolean; message?: string };

export type RunQueryRequest = {
	username: string;
	api: SoqlApiType;
	soql: string;
	previewLimit?: number;
	includeAllPages?: boolean;
	nextRecordsUrl?: string;
};

export type RunQueryResponse = {
	records: Record<string, unknown>[];
	totalSize: number;
	done: boolean;
	nextRecordsUrl?: string;
};

export type StartBulkQueryRequest = { username: string; soql: string };
export type StartBulkQueryResponse = { jobId: string };

export type BulkQueryStatusRequest = { username: string; jobId: string };
export type BulkQueryStatusResponse = {
	jobId: string;
	state: string;
	recordsProcessed?: number;
};

export type BulkQueryResultRequest = { username: string; jobId: string };

