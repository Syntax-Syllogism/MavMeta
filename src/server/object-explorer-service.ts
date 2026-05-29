import { Org } from "@salesforce/core";

import { ApiError } from "./api-error";
import { runToolingQuery, type ToolingQueryConnection } from "./tooling-query";
import {
	OBJECT_CHILD_METADATA_TYPES,
	type ChildMetadataItem,
	type ListObjectChildrenRequest,
	type ListObjectChildrenResponse,
	type ListObjectsPageRequest,
	type ListObjectsPageResponse,
	type ListObjectsRequest,
	type ListObjectsResponse,
	type ObjectSummary,
	type ObjectType,
} from "../shared/object-explorer";

type SalesforceListMetadataQuery = {
	type: string;
	folder?: string;
};

type JsforceConnection = ToolingQueryConnection & {
	query(soql: string): Promise<{
		records: Array<Record<string, unknown>>;
		totalSize: number;
		done: boolean;
	}>;
	metadata: {
		list(queries: SalesforceListMetadataQuery[], apiVersion: string): Promise<unknown>;
	};
};

type EntityDefinitionRecord = {
	QualifiedApiName?: string;
	MasterLabel?: string;
	NamespacePrefix?: string | null;
	KeyPrefix?: string | null;
	IsCustomSetting?: boolean;
};

type CustomObjectRecord = {
	DeveloperName?: string;
	NamespacePrefix?: string | null;
	ManageableState?: string;
};

type EntityDefinitionQueryOptions = {
	cursor?: string;
	search?: string;
	searchField?: "QualifiedApiName" | "MasterLabel";
	limit: number;
};

type EntityDefinitionPage = {
	rows: EntityDefinitionRecord[];
	nextCursor?: string;
};

type ObjectExplorerServiceOptions = {
	connectionFactory?: (username: string) => Promise<JsforceConnection>;
	fetcher?: typeof fetch;
	metadataListTimeoutMs?: number;
	childMetadataListTimeoutMs?: number;
	toolingQueryTimeoutMs?: number;
};

export type ObjectExplorerServiceApi = {
	listObjects(request: ListObjectsRequest): Promise<ListObjectsResponse>;
	listObjectsPage(request: ListObjectsPageRequest): Promise<ListObjectsPageResponse>;
	listObjectChildren(request: ListObjectChildrenRequest): Promise<ListObjectChildrenResponse>;
};

export class ObjectExplorerService implements ObjectExplorerServiceApi {
	private readonly connectionFactory: (username: string) => Promise<JsforceConnection>;
	private readonly fetcher: typeof fetch;
	private readonly metadataListTimeoutMs: number;
	private readonly childMetadataListTimeoutMs: number;
	private readonly toolingQueryTimeoutMs: number;
	private readonly orgNamespaceCache = new Map<string, string | null>();

	constructor(options: ObjectExplorerServiceOptions = {}) {
		this.connectionFactory = options.connectionFactory ?? createConnection;
		this.fetcher = options.fetcher ?? fetch;
		this.metadataListTimeoutMs = options.metadataListTimeoutMs ?? 60_000;
		this.childMetadataListTimeoutMs = options.childMetadataListTimeoutMs ?? 30_000;
		this.toolingQueryTimeoutMs = options.toolingQueryTimeoutMs ?? 15_000;
	}

	async listObjects(request: ListObjectsRequest): Promise<ListObjectsResponse> {
		const connection = await this.getConnection(request.target.username);
		const apiVersion = connection.getApiVersion();
		const records = toArray(
			await withTimeout(
				connection.metadata.list([{ type: "CustomObject" }], apiVersion),
				this.metadataListTimeoutMs,
				() =>
					new ApiError(504, "OBJECT_LIST_TIMEOUT", "Listing CustomObject metadata took too long."),
			),
		);

		const objects: ObjectSummary[] = records
			.map(toObjectSummary)
			.filter((obj): obj is ObjectSummary => obj !== undefined)
			.sort((left, right) => left.label.localeCompare(right.label));

		return { target: request.target, objects };
	}

	async listObjectsPage(request: ListObjectsPageRequest): Promise<ListObjectsPageResponse> {
		const connection = await this.getConnection(request.target.username);
		const limit = normalizePageLimit(request.limit);
		const orgNamespace = await this.getOrgNamespace(request.target.username, connection);
		const entityPage = await this.loadEntityDefinitionPage(connection, orgNamespace, {
			cursor: request.cursor,
			search: request.search,
			limit,
		});
		const manageableStates = await this.loadManageableStates(connection, entityPage.rows);
		const objects = entityPage.rows.map((row) => toObjectSummaryFromEntity(row, manageableStates));

		return {
			target: request.target,
			objects,
			nextCursor: entityPage.nextCursor,
		};
	}

	private async loadEntityDefinitionPage(
		connection: JsforceConnection,
		orgNamespace: string | null,
		{
			cursor,
			search,
			limit,
		}: {
			cursor?: string;
			search?: string;
			limit: number;
		},
	): Promise<EntityDefinitionPage> {
		const searchFields = search?.trim()
			? (["QualifiedApiName", "MasterLabel"] as const)
			: [undefined];
		const rowsByApiName = new Map<string, EntityDefinitionRecord>();
		let rawNextCursor: string | undefined;
		let sourceHasMore = false;

		for (const searchField of searchFields) {
			let queryCursor = cursor;
			let acceptedForQuery = 0;
			let attempts = 0;
			let queryHasMore = false;

			while (attempts < 25 && acceptedForQuery < limit) {
				attempts++;
				const response = await runToolingQuery(
					connection,
					buildEntityDefinitionQuery({
						cursor: queryCursor,
						search,
						searchField,
						limit,
					}),
					this.fetcher,
					this.toolingQueryTimeoutMs,
				);
				let lastRawApiName: string | undefined;
				for (const row of response.records
					.map(toEntityDefinitionRecord)
					.filter((record): record is EntityDefinitionRecord => record !== undefined)) {
					if (row.QualifiedApiName) {
						lastRawApiName = row.QualifiedApiName;
						rawNextCursor = row.QualifiedApiName;
					}
					if (!namespaceMatchesOrg(row.NamespacePrefix, orgNamespace)) continue;
					if (row.QualifiedApiName && !rowsByApiName.has(row.QualifiedApiName)) {
						acceptedForQuery++;
						rowsByApiName.set(row.QualifiedApiName, row);
					}
				}
				queryHasMore =
					lastRawApiName !== undefined &&
					(response.done === false ||
						response.nextRecordsUrl !== undefined ||
						response.records.length === limit);
				if (!queryHasMore) break;
				queryCursor = lastRawApiName;
			}
			sourceHasMore ||= queryHasMore || (attempts >= 25 && rawNextCursor !== undefined);
		}

		const allRows = [...rowsByApiName.values()].sort((left, right) =>
			(left.QualifiedApiName ?? "").localeCompare(right.QualifiedApiName ?? ""),
		);
		const rows = allRows.slice(0, limit);
		const lastRowApiName = rows[rows.length - 1]?.QualifiedApiName;
		const nextCursor =
			allRows.length > limit || sourceHasMore ? (lastRowApiName ?? rawNextCursor) : undefined;
		return { rows, nextCursor };
	}

	async listObjectChildren(
		request: ListObjectChildrenRequest,
	): Promise<ListObjectChildrenResponse> {
		const connection = await this.getConnection(request.target.username);
		const apiVersion = connection.getApiVersion();

		const results = await Promise.allSettled(
			OBJECT_CHILD_METADATA_TYPES.map(async (childType) => {
				const records = toArray(
					await withTimeout(
						connection.metadata.list(
							[{ type: childType, folder: request.objectApiName }],
							apiVersion,
						),
						this.childMetadataListTimeoutMs,
						() =>
							new ApiError(
								504,
								"OBJECT_CHILD_LIST_TIMEOUT",
								`Listing ${childType} metadata took too long.`,
							),
					),
				);
				const items = records
					.map((record) => toChildMetadataItem(record, childType, request.objectApiName))
					.filter((item): item is ChildMetadataItem => item !== undefined);
				return { childType, items };
			}),
		);

		const children: Record<string, ChildMetadataItem[]> = {};
		const errors: Array<{ metadataType: string; message: string }> = [];

		for (let i = 0; i < OBJECT_CHILD_METADATA_TYPES.length; i++) {
			const childType = OBJECT_CHILD_METADATA_TYPES[i];
			const result = results[i];
			if (!result || !childType) continue;

			if (result.status === "fulfilled") {
				children[childType] = result.value.items;
			} else {
				children[childType] = [];
				const reason = result.reason;
				errors.push({
					metadataType: childType,
					message: reason instanceof Error ? reason.message : "Unknown error",
				});
			}
		}

		return {
			target: request.target,
			objectApiName: request.objectApiName,
			children,
			errors,
		};
	}

	private async getOrgNamespace(
		username: string,
		connection: JsforceConnection,
	): Promise<string | null> {
		if (this.orgNamespaceCache.has(username)) {
			return this.orgNamespaceCache.get(username) ?? null;
		}

		const response = await withTimeout(
			connection.query("SELECT NamespacePrefix FROM Organization LIMIT 1"),
			this.toolingQueryTimeoutMs,
			() => new ApiError(504, "ORG_NAMESPACE_TIMEOUT", "Reading the org namespace took too long."),
		);
		const namespacePrefix = readNullableStringField(response.records[0], "NamespacePrefix");
		this.orgNamespaceCache.set(username, namespacePrefix ?? null);
		return namespacePrefix ?? null;
	}

	private async loadManageableStates(
		connection: JsforceConnection,
		entityRows: EntityDefinitionRecord[],
	): Promise<Map<string, string>> {
		const developerNames = [
			...new Set(
				entityRows
					.map((row) => deriveCustomObjectDeveloperName(readStringField(row, "QualifiedApiName")))
					.filter((name): name is string => name !== undefined),
			),
		];
		if (!developerNames.length) return new Map();

		const developerNameList = developerNames
			.map((name) => `'${escapeSoqlString(name)}'`)
			.join(", ");
		const response = await runToolingQuery(
			connection,
			`SELECT DeveloperName, NamespacePrefix, ManageableState FROM CustomObject WHERE DeveloperName IN (${developerNameList})`,
			this.fetcher,
			this.toolingQueryTimeoutMs,
		);
		const states = new Map<string, string>();
		for (const record of response.records) {
			const row = toCustomObjectRecord(record);
			if (!row?.DeveloperName || !row.ManageableState) continue;
			states.set(manageableStateKey(row.NamespacePrefix, row.DeveloperName), row.ManageableState);
		}
		return states;
	}

	private async getConnection(username: string): Promise<JsforceConnection> {
		return this.connectionFactory(username);
	}
}

async function createConnection(username: string): Promise<JsforceConnection> {
	const org = await Org.create({ aliasOrUsername: username });
	return org.getConnection() as unknown as JsforceConnection;
}

function buildEntityDefinitionQuery({
	cursor,
	search,
	searchField,
	limit,
}: EntityDefinitionQueryOptions): string {
	const clauses = ["IsCustomizable = true"];
	if (cursor?.trim()) {
		clauses.push(`QualifiedApiName > '${escapeSoqlString(cursor.trim())}'`);
	}
	const searchTerm = toLikeSearchTerm(search);
	if (searchTerm && searchField) {
		clauses.push(`${searchField} LIKE '${searchTerm}'`);
	}

	return [
		"SELECT QualifiedApiName, MasterLabel, NamespacePrefix, KeyPrefix, IsCustomSetting",
		"FROM EntityDefinition",
		`WHERE ${clauses.join(" AND ")}`,
		"ORDER BY QualifiedApiName ASC",
		`LIMIT ${limit}`,
	].join(" ");
}

function toLikeSearchTerm(search: string | undefined): string | undefined {
	const trimmed = search?.trim();
	if (!trimmed) return undefined;
	return `%${escapeSoqlLikePattern(trimmed)}%`;
}

function normalizePageLimit(limit: number | undefined): number {
	if (limit === undefined) return 200;
	if (!Number.isInteger(limit) || limit <= 0) return 200;
	return Math.min(limit, 200);
}

function toObjectSummary(record: unknown): ObjectSummary | undefined {
	if (!isObjectRecord(record)) return undefined;

	const fullName = readStringField(record, "fullName");
	if (!fullName) return undefined;

	const label = readStringField(record, "label") ?? toObjectLabel(fullName);

	return {
		apiName: fullName,
		label,
		objectType: deriveObjectType(fullName),
		namespacePrefix: readStringField(record, "namespacePrefix"),
		manageableState: readStringField(record, "manageableState"),
	};
}

function toObjectSummaryFromEntity(
	row: EntityDefinitionRecord,
	manageableStates: Map<string, string>,
): ObjectSummary {
	const apiName = row.QualifiedApiName ?? "";
	const developerName = deriveCustomObjectDeveloperName(apiName);
	const manageableState = developerName
		? manageableStates.get(manageableStateKey(row.NamespacePrefix, developerName))
		: undefined;

	return {
		apiName,
		label: row.MasterLabel?.trim() || toObjectLabel(apiName),
		objectType: deriveObjectType(apiName, row.IsCustomSetting === true),
		namespacePrefix: row.NamespacePrefix ?? undefined,
		manageableState,
	};
}

function toChildMetadataItem(
	record: unknown,
	metadataType: string,
	parentObject: string,
): ChildMetadataItem | undefined {
	if (!isObjectRecord(record)) return undefined;

	const fullName = readStringField(record, "fullName");
	if (!fullName) return undefined;

	const childApiName = deriveChildApiName(fullName);

	return {
		fullName,
		childApiName,
		parentObject: deriveParentFromFullName(fullName) ?? parentObject,
		metadataType,
		label: readStringField(record, "label"),
		manageableState: readStringField(record, "manageableState"),
		lastModifiedByName: readStringField(record, "lastModifiedByName"),
		lastModifiedDate: readStringField(record, "lastModifiedDate"),
		raw: record,
	};
}

function toEntityDefinitionRecord(
	record: Record<string, unknown>,
): EntityDefinitionRecord | undefined {
	const qualifiedApiName = readStringField(record, "QualifiedApiName");
	if (!qualifiedApiName) return undefined;
	return {
		QualifiedApiName: qualifiedApiName,
		MasterLabel: readStringField(record, "MasterLabel"),
		NamespacePrefix: readNullableStringField(record, "NamespacePrefix"),
		KeyPrefix: readNullableStringField(record, "KeyPrefix"),
		IsCustomSetting: record.IsCustomSetting === true,
	};
}

function toCustomObjectRecord(record: Record<string, unknown>): CustomObjectRecord | undefined {
	const developerName = readStringField(record, "DeveloperName");
	if (!developerName) return undefined;
	return {
		DeveloperName: developerName,
		NamespacePrefix: readNullableStringField(record, "NamespacePrefix"),
		ManageableState: readStringField(record, "ManageableState"),
	};
}

function deriveChildApiName(fullName: string): string {
	const dotIndex = fullName.indexOf(".");
	return dotIndex >= 0 ? fullName.slice(dotIndex + 1) : fullName;
}

function deriveParentFromFullName(fullName: string): string | undefined {
	const dotIndex = fullName.indexOf(".");
	return dotIndex > 0 ? fullName.slice(0, dotIndex) : undefined;
}

function deriveObjectType(apiName: string, isCustomSetting = false): ObjectType {
	if (isCustomSetting) return "customSetting";
	if (apiName.endsWith("__mdt")) return "customMetadata";
	if (apiName.endsWith("__e")) return "platformEvent";
	if (apiName.endsWith("__b")) return "bigObject";
	if (apiName.endsWith("__x")) return "externalObject";
	if (apiName.endsWith("__c")) return "custom";
	return "standard";
}

function deriveCustomObjectDeveloperName(apiName: string | undefined): string | undefined {
	if (!apiName || !/__(c|mdt|e|b|x)$/i.test(apiName)) return undefined;
	const suffixless = apiName.replace(/__(c|mdt|e|b|x)$/i, "");
	const namespaceSeparator = suffixless.indexOf("__");
	return namespaceSeparator >= 0 ? suffixless.slice(namespaceSeparator + 2) : suffixless;
}

function toObjectLabel(apiName: string): string {
	return apiName
		.replace(/__c$/, "")
		.replace(/__e$/, "")
		.replace(/__mdt$/, "")
		.replace(/__b$/, "")
		.replace(/__x$/, "")
		.replace(/_/g, " ")
		.trim();
}

function manageableStateKey(
	namespacePrefix: string | null | undefined,
	developerName: string,
): string {
	return `${namespacePrefix ?? ""}::${developerName}`;
}

function namespaceMatchesOrg(
	namespacePrefix: string | null | undefined,
	orgNamespace: string | null,
) {
	return !namespacePrefix || namespacePrefix === orgNamespace;
}

function escapeSoqlLikePattern(value: string): string {
	return escapeSoqlString(value).replace(/[%_]/g, (match) => `\\${match}`);
}

function escapeSoqlString(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function readStringField(record: Record<string, unknown>, fieldName: string): string | undefined {
	const value = record[fieldName];
	return typeof value === "string" && value.trim() ? value : undefined;
}

function readNullableStringField(
	record: Record<string, unknown> | undefined,
	fieldName: string,
): string | null {
	if (!record) return null;
	const value = record[fieldName];
	return typeof value === "string" && value.trim() ? value : null;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toArray(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	return value === undefined || value === null ? [] : [value];
}

function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	createError: () => Error,
): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<T>((_, reject) => {
		timeoutId = setTimeout(() => reject(createError()), timeoutMs);
	});
	return Promise.race([promise, timeoutPromise]).finally(() => {
		if (timeoutId) clearTimeout(timeoutId);
	});
}
