import { Org } from "@salesforce/core";

import { ApiError } from "./api-error";
import type {
	FieldAccessRequest,
	FieldAccessResponse,
	FieldAccessRow,
} from "../shared/field-access";

type QueryResult<TRecord> = {
	records: TRecord[];
	done: boolean;
	nextRecordsUrl?: string;
};

type FieldAccessConnection = {
	query<TRecord>(soql: string): Promise<QueryResult<TRecord>>;
	queryMore<TRecord>(nextRecordsUrl: string): Promise<QueryResult<TRecord>>;
};

type FieldPermissionsRecord = {
	ParentId?: string;
	Parent?: {
		Name?: string;
		IsOwnedByProfile?: boolean;
		Type?: string;
		Profile?: {
			Name?: string;
		};
	};
	PermissionsRead?: boolean;
	PermissionsEdit?: boolean;
};

type PermissionSetGroupComponentRecord = {
	PermissionSetGroupId?: string;
	PermissionSetId?: string;
	PermissionSetGroup?: {
		DeveloperName?: string;
		MasterLabel?: string;
	};
	PermissionSet?: {
		Name?: string;
		Type?: string;
	};
};

type PermissionSetAssignmentRecord = {
	AssigneeId?: string;
	Assignee?: {
		Name?: string;
		Username?: string;
		IsActive?: boolean;
	};
	PermissionSetId?: string;
	PermissionSet?: {
		Name?: string;
		IsOwnedByProfile?: boolean;
		Profile?: {
			Name?: string;
		};
		ProfileId?: string;
	};
	PermissionSetGroupId?: string;
	PermissionSetGroup?: {
		DeveloperName?: string;
		MasterLabel?: string;
	};
};

type FieldGrant = {
	read: boolean;
	edit: boolean;
	parentName?: string;
	parentType?: string;
	profileName?: string;
	isOwnedByProfile: boolean;
};

type MutingRule = {
	mutingPermSetId: string;
	mutingPermSetName: string;
	muteRead: boolean;
	muteEdit: boolean;
};

type FieldAccessServiceOptions = {
	connectionFactory?: (username: string) => Promise<FieldAccessConnection>;
	maxAssignments?: number;
};

export type FieldAccessServiceApi = {
	resolve(request: FieldAccessRequest): Promise<FieldAccessResponse>;
};

const DEFAULT_MAX_ASSIGNMENTS = 50000;

export class FieldAccessService implements FieldAccessServiceApi {
	private readonly connectionFactory: (username: string) => Promise<FieldAccessConnection>;
	private readonly maxAssignments: number;

	constructor(options: FieldAccessServiceOptions = {}) {
		this.connectionFactory = options.connectionFactory ?? createConnection;
		this.maxAssignments = options.maxAssignments ?? DEFAULT_MAX_ASSIGNMENTS;
	}

	async resolve(request: FieldAccessRequest): Promise<FieldAccessResponse> {
		const sobjectType = request.sobjectType.trim();
		const fieldFullName = request.fieldFullName.trim();
		if (!sobjectType || !fieldFullName) {
			throw new ApiError(
				400,
				"INVALID_REQUEST",
				'Fields "sobjectType" and "fieldFullName" must be non-empty strings.',
			);
		}

		const connection = await this.connectionFactory(request.target.username);
		const warnings: string[] = [];

		const grantsByPermSetId = new Map<string, FieldGrant>();
		const standalonePermSetIds = new Set<string>();
		const allGrantPermSetIds = new Set<string>();

		const phaseASoql = [
			"SELECT ParentId, Parent.Name, Parent.IsOwnedByProfile, Parent.Profile.Name,",
			"Parent.Type, SobjectType, Field, PermissionsRead, PermissionsEdit",
			"FROM FieldPermissions",
			`WHERE SobjectType = '${escapeSoqlString(sobjectType)}'`,
			`AND Field = '${escapeSoqlString(fieldFullName)}'`,
			"LIMIT 2000",
		].join(" ");

		const grantRows = await queryAll<FieldPermissionsRecord>(connection, phaseASoql);
		for (const row of grantRows) {
			const parentId = row.ParentId?.trim();
			if (!parentId) continue;
			const read = row.PermissionsRead === true;
			const edit = row.PermissionsEdit === true;
			if (!read && !edit) continue;

			const existing = grantsByPermSetId.get(parentId);
			const isOwnedByProfile = row.Parent?.IsOwnedByProfile === true;
			const merged: FieldGrant = {
				read: read || existing?.read === true,
				edit: edit || existing?.edit === true,
				isOwnedByProfile: existing?.isOwnedByProfile ?? isOwnedByProfile,
				parentName: existing?.parentName ?? row.Parent?.Name,
				parentType: existing?.parentType ?? row.Parent?.Type,
				profileName: existing?.profileName ?? row.Parent?.Profile?.Name,
			};
			grantsByPermSetId.set(parentId, merged);
			allGrantPermSetIds.add(parentId);
			if (isOwnedByProfile) {
				continue;
			}
			if (row.Parent?.Type !== "Group") {
				standalonePermSetIds.add(parentId);
			}
		}

		if (!allGrantPermSetIds.size) {
			return buildEmptyResponse(warnings);
		}

		const psgIds = new Set<string>();
		const psgNameById = new Map<string, string>();
		const permSetIdsByPsgId = new Map<string, Set<string>>();

		if (standalonePermSetIds.size) {
			try {
				const phaseBSoql = [
					"SELECT PermissionSetGroupId, PermissionSetGroup.DeveloperName,",
					"PermissionSetGroup.MasterLabel, PermissionSetId",
					"FROM PermissionSetGroupComponent",
					`WHERE PermissionSetId IN (${toIdInClause(standalonePermSetIds)})`,
				].join(" ");
				const components = await queryAll<PermissionSetGroupComponentRecord>(
					connection,
					phaseBSoql,
				);
				for (const component of components) {
					const permissionSetGroupId = component.PermissionSetGroupId?.trim();
					const permissionSetId = component.PermissionSetId?.trim();
					if (!permissionSetGroupId || !permissionSetId) continue;

					psgIds.add(permissionSetGroupId);
					psgNameById.set(
						permissionSetGroupId,
						component.PermissionSetGroup?.MasterLabel ??
							component.PermissionSetGroup?.DeveloperName ??
							"(Unnamed Permission Set Group)",
					);

					const permSetIds = permSetIdsByPsgId.get(permissionSetGroupId) ?? new Set<string>();
					permSetIds.add(permissionSetId);
					permSetIdsByPsgId.set(permissionSetGroupId, permSetIds);
				}
			} catch (error) {
				warnings.push(`PSG resolution skipped: ${toErrorMessage(error)}`);
			}
		}

		const assignmentRows = await this.readAssignmentRows(
			connection,
			allGrantPermSetIds,
			psgIds,
			warnings,
		);

		for (const row of assignmentRows) {
			const permissionSetGroupId = row.PermissionSetGroupId?.trim();
			if (permissionSetGroupId) {
				psgIds.add(permissionSetGroupId);
				const psgName =
					row.PermissionSetGroup?.MasterLabel ?? row.PermissionSetGroup?.DeveloperName ?? "";
				if (psgName) {
					psgNameById.set(permissionSetGroupId, psgName);
				}
			}
		}

		const mutingRulesByPsgId = await this.resolveMutingRules(
			connection,
			psgIds,
			sobjectType,
			fieldFullName,
			warnings,
		);

		const rows: FieldAccessRow[] = [];
		const rowKeys = new Set<string>();
		const usersWithAccess = new Set<string>();
		const mutedUsers = new Set<string>();
		const profileGrantSources = new Set<string>();
		const permissionSetGrantSources = new Set<string>();
		const permissionSetGroupGrantSources = new Set<string>();

		for (const assignment of assignmentRows) {
			const userId = assignment.AssigneeId?.trim();
			if (!userId || assignment.Assignee?.IsActive !== true) continue;
			const userName = assignment.Assignee?.Name?.trim() || userId;
			const username = assignment.Assignee?.Username?.trim() || "";
			const permissionSetId = assignment.PermissionSetId?.trim();
			const permissionSetGroupId = assignment.PermissionSetGroupId?.trim();

			if (permissionSetGroupId) {
				const sourceName = psgNameById.get(permissionSetGroupId) ?? permissionSetGroupId;
				const mappedViaPermSetIds = permSetIdsByPsgId.get(permissionSetGroupId);
				const viaPermSetIds = mappedViaPermSetIds
					? Array.from(mappedViaPermSetIds)
					: permissionSetId
						? [permissionSetId]
						: [];

				for (const viaPermissionSetId of viaPermSetIds) {
					const grant = grantsByPermSetId.get(viaPermissionSetId);
					if (!grant) continue;
					const mutingRules = mutingRulesByPsgId.get(permissionSetGroupId) ?? [];
					const access = applyMuting(grant, mutingRules);
					const viaPermissionSetName =
						grantsByPermSetId.get(viaPermissionSetId)?.parentName ?? viaPermissionSetId;

					const row: FieldAccessRow = {
						userId,
						userName,
						username,
						isActive: true,
						accessLevel: access.accessLevel,
						assignmentType: "PermissionSetGroup",
						sourceId: permissionSetGroupId,
						sourceName,
						viaPermissionSetId,
						viaPermissionSetName,
						mutedBySourceId: access.mutedBySourceId,
						mutedBySourceName: access.mutedBySourceName,
					};
					if (!pushUniqueRow(rows, rowKeys, row)) continue;
					updateStatsFromRow(
						row,
						usersWithAccess,
						mutedUsers,
						profileGrantSources,
						permissionSetGrantSources,
						permissionSetGroupGrantSources,
					);
				}
				continue;
			}

			if (!permissionSetId) continue;
			const grant = grantsByPermSetId.get(permissionSetId);
			if (!grant) continue;
			const accessLevel = grant.edit ? "Edit" : grant.read ? "Read" : undefined;
			if (!accessLevel) continue;

			const isProfileAssignment = assignment.PermissionSet?.IsOwnedByProfile === true;
			const profileId = assignment.PermissionSet?.ProfileId?.trim();
			if (isProfileAssignment && profileId) {
				const profileName =
					assignment.PermissionSet?.Profile?.Name?.trim() ||
					grant.profileName ||
					assignment.PermissionSet?.Name?.trim() ||
					profileId;
				const row: FieldAccessRow = {
					userId,
					userName,
					username,
					isActive: true,
					accessLevel,
					assignmentType: "Profile",
					sourceId: profileId,
					sourceName: profileName,
				};
				if (!pushUniqueRow(rows, rowKeys, row)) continue;
				updateStatsFromRow(
					row,
					usersWithAccess,
					mutedUsers,
					profileGrantSources,
					permissionSetGrantSources,
					permissionSetGroupGrantSources,
				);
				continue;
			}

			const row: FieldAccessRow = {
				userId,
				userName,
				username,
				isActive: true,
				accessLevel,
				assignmentType: "PermissionSet",
				sourceId: permissionSetId,
				sourceName: assignment.PermissionSet?.Name?.trim() || grant.parentName || permissionSetId,
			};
			if (!pushUniqueRow(rows, rowKeys, row)) continue;
			updateStatsFromRow(
				row,
				usersWithAccess,
				mutedUsers,
				profileGrantSources,
				permissionSetGrantSources,
				permissionSetGroupGrantSources,
			);
		}

		rows.sort((left, right) => {
			const nameCompare = left.userName.localeCompare(right.userName);
			if (nameCompare !== 0) return nameCompare;
			const accessCompare = left.assignmentType.localeCompare(right.assignmentType);
			if (accessCompare !== 0) return accessCompare;
			const sourceCompare = left.sourceName.localeCompare(right.sourceName);
			if (sourceCompare !== 0) return sourceCompare;
			return (left.viaPermissionSetName ?? "").localeCompare(right.viaPermissionSetName ?? "");
		});

		return {
			rows,
			stats: {
				totalActiveUsersWithAccess: usersWithAccess.size,
				profileGrants: profileGrantSources.size,
				permissionSetGrants: permissionSetGrantSources.size,
				permissionSetGroupGrants: permissionSetGroupGrantSources.size,
				mutedUsers: mutedUsers.size,
			},
			warnings,
		};
	}

	private async readAssignmentRows(
		connection: FieldAccessConnection,
		allGrantPermSetIds: Set<string>,
		psgIds: Set<string>,
		warnings: string[],
	): Promise<PermissionSetAssignmentRecord[]> {
		const whereClauses: string[] = [];
		if (allGrantPermSetIds.size) {
			whereClauses.push(`PermissionSetId IN (${toIdInClause(allGrantPermSetIds)})`);
		}
		if (psgIds.size) {
			whereClauses.push(`PermissionSetGroupId IN (${toIdInClause(psgIds)})`);
		}
		if (!whereClauses.length) return [];

		const phaseCSoql = [
			"SELECT AssigneeId, Assignee.Name, Assignee.Username, Assignee.IsActive,",
			"PermissionSetId, PermissionSet.Name, PermissionSet.IsOwnedByProfile,",
			"PermissionSet.Profile.Name, PermissionSet.ProfileId, PermissionSetGroupId,",
			"PermissionSetGroup.DeveloperName, PermissionSetGroup.MasterLabel",
			"FROM PermissionSetAssignment",
			"WHERE Assignee.IsActive = true",
			`AND (${whereClauses.join(" OR ")})`,
			"ORDER BY Assignee.Name, Id",
			// 2000 is the Salesforce query page size for pagination; total rows are controlled by queryMore + maxAssignments.
			"LIMIT 2000",
		].join(" ");

		const assignments: PermissionSetAssignmentRecord[] = [];
		let page = await connection.query<PermissionSetAssignmentRecord>(phaseCSoql);
		for (;;) {
			for (const row of page.records) {
				if (assignments.length >= this.maxAssignments) {
					warnings.push(
						`Showing first ${this.maxAssignments.toLocaleString()} user assignments. Refine scope if you need a complete export.`,
					);
					return assignments;
				}
				assignments.push(row);
			}
			if (page.done || !page.nextRecordsUrl) {
				return assignments;
			}
			page = await connection.queryMore<PermissionSetAssignmentRecord>(page.nextRecordsUrl);
		}
	}

	private async resolveMutingRules(
		connection: FieldAccessConnection,
		psgIds: Set<string>,
		sobjectType: string,
		fieldFullName: string,
		warnings: string[],
	): Promise<Map<string, MutingRule[]>> {
		if (!psgIds.size) return new Map<string, MutingRule[]>();

		try {
			const mutingComponentSoql = [
				"SELECT Id, PermissionSetGroupId, PermissionSetId, PermissionSet.Type, PermissionSet.Name",
				"FROM PermissionSetGroupComponent",
				`WHERE PermissionSetGroupId IN (${toIdInClause(psgIds)})`,
				"AND PermissionSet.Type = 'Muting'",
			].join(" ");
			const mutingComponents = await queryAll<PermissionSetGroupComponentRecord>(
				connection,
				mutingComponentSoql,
			);

			const mutingPermSetIds = new Set<string>();
			const psgEntries = new Map<
				string,
				Array<{ mutingPermSetId: string; mutingPermSetName: string }>
			>();
			for (const component of mutingComponents) {
				const permissionSetGroupId = component.PermissionSetGroupId?.trim();
				const permissionSetId = component.PermissionSetId?.trim();
				if (!permissionSetGroupId || !permissionSetId) continue;
				mutingPermSetIds.add(permissionSetId);
				const entries = psgEntries.get(permissionSetGroupId) ?? [];
				entries.push({
					mutingPermSetId: permissionSetId,
					mutingPermSetName:
						component.PermissionSet?.Name?.trim() || "(Unnamed Muting Permission Set)",
				});
				psgEntries.set(permissionSetGroupId, entries);
			}

			if (!mutingPermSetIds.size) return new Map<string, MutingRule[]>();

			const mutingFieldSoql = [
				"SELECT ParentId, PermissionsRead, PermissionsEdit",
				"FROM FieldPermissions",
				"WHERE Parent.IsOwnedByProfile = false",
				`AND ParentId IN (${toIdInClause(mutingPermSetIds)})`,
				`AND SobjectType = '${escapeSoqlString(sobjectType)}'`,
				`AND Field = '${escapeSoqlString(fieldFullName)}'`,
			].join(" ");
			const mutingFieldRows = await queryAll<FieldPermissionsRecord>(connection, mutingFieldSoql);
			const mutingEffectByPermSetId = new Map<string, { muteRead: boolean; muteEdit: boolean }>();
			for (const row of mutingFieldRows) {
				const parentId = row.ParentId?.trim();
				if (!parentId) continue;
				const existing = mutingEffectByPermSetId.get(parentId);
				mutingEffectByPermSetId.set(parentId, {
					muteRead: existing?.muteRead === true || row.PermissionsRead === false,
					muteEdit: existing?.muteEdit === true || row.PermissionsEdit === false,
				});
			}

			const mutingRulesByPsgId = new Map<string, MutingRule[]>();
			for (const [permissionSetGroupId, entries] of psgEntries) {
				for (const entry of entries) {
					const effect = mutingEffectByPermSetId.get(entry.mutingPermSetId);
					if (!effect || (!effect.muteRead && !effect.muteEdit)) continue;
					const rules = mutingRulesByPsgId.get(permissionSetGroupId) ?? [];
					rules.push({
						mutingPermSetId: entry.mutingPermSetId,
						mutingPermSetName: entry.mutingPermSetName,
						muteRead: effect.muteRead,
						muteEdit: effect.muteEdit,
					});
					mutingRulesByPsgId.set(permissionSetGroupId, rules);
				}
			}
			return mutingRulesByPsgId;
		} catch (error) {
			warnings.push(`Muting resolution skipped: ${toErrorMessage(error)}`);
			return new Map<string, MutingRule[]>();
		}
	}
}

async function createConnection(username: string): Promise<FieldAccessConnection> {
	const org = await Org.create({ aliasOrUsername: username });
	return org.getConnection() as unknown as FieldAccessConnection;
}

async function queryAll<TRecord>(
	connection: FieldAccessConnection,
	soql: string,
): Promise<TRecord[]> {
	const rows: TRecord[] = [];
	let page = await connection.query<TRecord>(soql);
	for (;;) {
		rows.push(...page.records);
		if (page.done || !page.nextRecordsUrl) {
			return rows;
		}
		page = await connection.queryMore<TRecord>(page.nextRecordsUrl);
	}
}

function applyMuting(
	grant: FieldGrant,
	mutingRules: MutingRule[],
): {
	accessLevel: FieldAccessRow["accessLevel"];
	mutedBySourceId?: string;
	mutedBySourceName?: string;
} {
	if (!grant.read && !grant.edit) {
		throw new Error("Invariant violation: applyMuting called without a read/edit grant.");
	}

	let effectiveRead = grant.read || grant.edit;
	let effectiveEdit = grant.edit;
	let mutedBySourceId: string | undefined;
	let mutedBySourceName: string | undefined;

	for (const rule of mutingRules) {
		let changed = false;
		if (rule.muteRead && (effectiveRead || effectiveEdit)) {
			effectiveRead = false;
			effectiveEdit = false;
			changed = true;
		}
		if (rule.muteEdit && effectiveEdit) {
			effectiveEdit = false;
			changed = true;
		}
		if (changed && !mutedBySourceId) {
			mutedBySourceId = rule.mutingPermSetId;
			mutedBySourceName = rule.mutingPermSetName;
		}
	}

	if (effectiveEdit) {
		return { accessLevel: "Edit", mutedBySourceId, mutedBySourceName };
	}
	if (effectiveRead) {
		return { accessLevel: "Read", mutedBySourceId, mutedBySourceName };
	}
	if (mutedBySourceId) {
		return { accessLevel: "None (Muted)", mutedBySourceId, mutedBySourceName };
	}
	throw new Error(
		"Invariant violation: no effective access remained but no muting source was identified.",
	);
}

function pushUniqueRow(rows: FieldAccessRow[], rowKeys: Set<string>, row: FieldAccessRow): boolean {
	const rowKey = `${row.userId}::${row.assignmentType}::${row.sourceId}::${row.viaPermissionSetId ?? ""}`;
	if (rowKeys.has(rowKey)) return false;
	rowKeys.add(rowKey);
	rows.push(row);
	return true;
}

function updateStatsFromRow(
	row: FieldAccessRow,
	usersWithAccess: Set<string>,
	mutedUsers: Set<string>,
	profileGrantSources: Set<string>,
	permissionSetGrantSources: Set<string>,
	permissionSetGroupGrantSources: Set<string>,
) {
	if (row.accessLevel === "None (Muted)") {
		mutedUsers.add(row.userId);
		return;
	}
	usersWithAccess.add(row.userId);
	if (row.assignmentType === "Profile") {
		profileGrantSources.add(row.sourceId);
		return;
	}
	if (row.assignmentType === "PermissionSet") {
		permissionSetGrantSources.add(row.sourceId);
		return;
	}
	permissionSetGroupGrantSources.add(row.sourceId);
}

function toIdInClause(ids: Iterable<string>): string {
	return Array.from(ids)
		.map((id) => `'${escapeSoqlString(id)}'`)
		.join(", ");
}

function escapeSoqlString(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return "Unknown error";
}

function buildEmptyResponse(warnings: string[]): FieldAccessResponse {
	return {
		rows: [],
		stats: {
			totalActiveUsersWithAccess: 0,
			profileGrants: 0,
			permissionSetGrants: 0,
			permissionSetGroupGrants: 0,
			mutedUsers: 0,
		},
		warnings,
	};
}
