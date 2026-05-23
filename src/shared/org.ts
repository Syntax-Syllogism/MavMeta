export type OrgEnvironment = "production" | "sandbox" | "developer" | "scratch" | "unknown";

export type OrgAuthStatus = "connected" | "expired" | "unknown";

export type OrgSummary = {
	alias?: string;
	username: string;
	orgId?: string;
	instanceUrl?: string;
	loginUrl?: string;
	trialExpirationDate?: string;
	environment: OrgEnvironment;
	isDefault: boolean;
	authStatus: OrgAuthStatus;
};

export type OrgTarget = {
	username: string;
	startPath?: string;
};

export type AuthOrgRequest = {
	loginUrl: string;
	alias?: string;
};

export type SetAliasRequest = {
	target: OrgTarget;
	alias: string;
};

export type OrgListResponse = {
	orgs: OrgSummary[];
	activeOrg?: OrgSummary;
};

export type OrgActionResponse = {
	org?: OrgSummary;
	message: string;
};
