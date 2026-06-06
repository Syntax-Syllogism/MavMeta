import type { OrgTarget } from "./org";

export type FieldAccessRequest = {
	target: OrgTarget;
	sobjectType: string;
	fieldFullName: string;
};

export type FieldAccessLevel = "Edit" | "Read" | "None (Muted)";

export type FieldAccessAssignmentType = "Profile" | "PermissionSet" | "PermissionSetGroup";

export type FieldAccessRow = {
	userId: string;
	userName: string;
	username: string;
	isActive: boolean;
	accessLevel: FieldAccessLevel;
	assignmentType: FieldAccessAssignmentType;
	sourceId: string;
	sourceName: string;
	viaPermissionSetId?: string;
	viaPermissionSetName?: string;
	mutedBySourceId?: string;
	mutedBySourceName?: string;
};

export type FieldAccessStats = {
	totalActiveUsersWithAccess: number;
	profileGrants: number;
	permissionSetGrants: number;
	permissionSetGroupGrants: number;
	mutedUsers: number;
};

export type FieldAccessResponse = {
	rows: FieldAccessRow[];
	stats: FieldAccessStats;
	warnings: string[];
};
