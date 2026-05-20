export type StartScratchOrgCreateRequest = {
	devHubUsername: string;
	definition: Record<string, unknown>;
	alias?: string;
	durationDays: number;
};

export type StartScratchOrgCreateResponse = {
	operationId: string;
};

export type ScratchOrgCreateStatusRequest = {
	operationId: string;
};

export type ScratchOrgCreateStatus = "pending" | "running" | "succeeded" | "failed";

export type ScratchOrgCreateStatusResponse = {
	operationId: string;
	status: ScratchOrgCreateStatus;
	message: string;
	username?: string;
	warnings?: string[];
};

export type OrgSnapshot = {
	id: string;
	snapshotName: string;
	description?: string;
	status: "Active" | "InProgress" | "Error" | (string & {});
	expirationDate?: string;
	createdDate: string;
	sourceOrgId?: string;
};

export type ListSnapshotsResponse = {
	eligibility: "enabled" | "not-enabled";
	snapshots: OrgSnapshot[];
};
