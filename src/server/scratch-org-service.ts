import { randomUUID } from "node:crypto";

import { AuthInfo, Org, scratchOrgCreate } from "@salesforce/core";

import type {
	ListSnapshotsResponse,
	OrgSnapshot,
	ScratchOrgCreateStatus,
	ScratchOrgCreateStatusResponse,
	StartScratchOrgCreateRequest,
	StartScratchOrgCreateResponse,
} from "../shared/scratch-org";
import { ApiError } from "./api-error";
import { redactSecrets } from "./redact-secrets";

type CreateOperation = {
	id: string;
	status: ScratchOrgCreateStatus;
	message: string;
	username?: string;
	warnings?: string[];
	completedAt?: number;
};

type ScratchOrgCreateResult = {
	username?: string;
	warnings: string[];
};

export type ScratchOrgServiceApi = {
	startCreate(request: StartScratchOrgCreateRequest): Promise<StartScratchOrgCreateResponse>;
	getStatus(operationId: string): Promise<ScratchOrgCreateStatusResponse>;
	listSnapshots(devHubUsername: string): Promise<ListSnapshotsResponse>;
};

type ScratchOrgServiceOptions = {
	uuidFactory?: () => string;
	now?: () => number;
	completedOperationTtlMs?: number;
	scratchOrgCreateFn?: (
		hubOrg: Org,
		orgConfig: Record<string, unknown>,
		durationDays: number,
	) => Promise<ScratchOrgCreateResult>;
	orgFactory?: (username: string) => Promise<Org>;
	authInfoFactory?: (username: string) => Promise<{ setAlias: (alias: string) => Promise<void> }>;
};

type QueryRecord = Record<string, unknown>;
type QueryResult = {
	totalSize?: number;
	records?: QueryRecord[];
};
type QueryErrorPayload = {
	errorCode?: string;
	message?: string;
};

const DEFAULT_COMPLETED_OPERATION_TTL_MS = 10 * 60 * 1000;
const SNAPSHOT_ELIGIBILITY_QUERY = "SELECT Id FROM OrgSnapshot LIMIT 1";
const SNAPSHOT_LIST_QUERY =
	"SELECT Id, SnapshotName, Content, Status, ExpirationDate, CreatedDate, SourceOrg FROM OrgSnapshot ORDER BY CreatedDate DESC LIMIT 200";

export class ScratchOrgService implements ScratchOrgServiceApi {
	private readonly operations = new Map<string, CreateOperation>();
	private readonly uuidFactory: () => string;
	private readonly now: () => number;
	private readonly completedOperationTtlMs: number;
	private readonly scratchOrgCreateFn: (
		hubOrg: Org,
		orgConfig: Record<string, unknown>,
		durationDays: number,
	) => Promise<ScratchOrgCreateResult>;
	private readonly orgFactory: (username: string) => Promise<Org>;
	private readonly authInfoFactory: (
		username: string,
	) => Promise<{ setAlias: (alias: string) => Promise<void> }>;

	constructor(options: ScratchOrgServiceOptions = {}) {
		this.uuidFactory = options.uuidFactory ?? randomUUID;
		this.now = options.now ?? Date.now;
		this.completedOperationTtlMs =
			options.completedOperationTtlMs ?? DEFAULT_COMPLETED_OPERATION_TTL_MS;
		this.scratchOrgCreateFn =
			options.scratchOrgCreateFn ??
			(async (hubOrg, orgConfig, durationDays) => {
				const result = await scratchOrgCreate({ hubOrg, orgConfig, durationDays });
				return { username: result.username, warnings: result.warnings };
			});
		this.orgFactory =
			options.orgFactory ?? ((username) => Org.create({ aliasOrUsername: username }));
		this.authInfoFactory = options.authInfoFactory ?? ((username) => AuthInfo.create({ username }));
	}

	async startCreate(request: StartScratchOrgCreateRequest): Promise<StartScratchOrgCreateResponse> {
		this.pruneCompletedOperations();

		const operationId = this.uuidFactory();
		const operation: CreateOperation = {
			id: operationId,
			status: "pending",
			message: "Preparing to create scratch org...",
		};
		this.operations.set(operationId, operation);

		void this.runCreate(operation, request);

		return { operationId };
	}

	async getStatus(operationId: string): Promise<ScratchOrgCreateStatusResponse> {
		const operation = this.operations.get(operationId);
		if (!operation) {
			throw new ApiError(
				404,
				"NOT_FOUND",
				`No scratch org create operation found with id "${operationId}".`,
			);
		}

		return {
			operationId: operation.id,
			status: operation.status,
			message: operation.message,
			username: operation.username,
			warnings: operation.warnings,
		};
	}

	async listSnapshots(devHubUsername: string): Promise<ListSnapshotsResponse> {
		const hubOrg = await this.orgFactory(devHubUsername);
		const connection = await this.readConnection(hubOrg);

		try {
			await connection.query(SNAPSHOT_ELIGIBILITY_QUERY);
		} catch (error) {
			if (this.isSnapshotsNotEnabledError(error)) {
				return {
					eligibility: "not-enabled",
					snapshots: [],
				};
			}
			throw error;
		}

		const response = await connection.query(SNAPSHOT_LIST_QUERY);
		const records = Array.isArray(response.records) ? response.records : [];
		return {
			eligibility: "enabled",
			snapshots: records
				.map((record) => this.mapOrgSnapshot(record))
				.filter((snapshot): snapshot is OrgSnapshot => snapshot !== undefined),
		};
	}

	private async runCreate(
		operation: CreateOperation,
		request: StartScratchOrgCreateRequest,
	): Promise<void> {
		operation.status = "running";
		operation.message = "Creating scratch org...";

		try {
			const hubOrg = await this.orgFactory(request.devHubUsername);
			const result = await this.scratchOrgCreateFn(
				hubOrg,
				request.definition,
				request.durationDays,
			);

			if (request.alias?.trim() && result.username) {
				const authInfo = await this.authInfoFactory(result.username);
				await authInfo.setAlias(request.alias.trim());
			}

			operation.username = result.username;
			operation.warnings = result.warnings;
			operation.status = "succeeded";
			operation.message = result.username
				? `Scratch org ${result.username} created successfully.`
				: "Scratch org created successfully.";
		} catch (error) {
			operation.status = "failed";
			operation.message =
				error instanceof Error ? redactSecrets(error.message) : "Scratch org creation failed.";
		} finally {
			operation.completedAt = this.now();
		}
	}

	private pruneCompletedOperations(): void {
		const cutoff = this.now() - this.completedOperationTtlMs;
		for (const [id, operation] of this.operations) {
			if (operation.completedAt !== undefined && operation.completedAt < cutoff) {
				this.operations.delete(id);
			}
		}
	}

	private async readConnection(hubOrg: Org): Promise<{
		query: (query: string) => Promise<QueryResult>;
	}> {
		const getConnection = (
			hubOrg as unknown as {
				getConnection?: () => Promise<{
					query?: (query: string) => Promise<QueryResult>;
				}>;
			}
		).getConnection;

		if (typeof getConnection === "function") {
			const connection = await getConnection.call(hubOrg);
			if (typeof connection?.query === "function") {
				return connection as {
					query: (query: string) => Promise<QueryResult>;
				};
			}
		}

		const connection = (
			hubOrg as unknown as {
				connection?: {
					query?: (query: string) => Promise<QueryResult>;
				};
			}
		).connection;
		if (typeof connection?.query !== "function") {
			throw new ApiError(500, "INTERNAL_ERROR", "Salesforce API is unavailable for this org.");
		}
		return connection as {
			query: (query: string) => Promise<QueryResult>;
		};
	}

	private isSnapshotsNotEnabledError(error: unknown): boolean {
		const details = this.readQueryErrorDetails(error);
		if (details.errorCode === "INVALID_TYPE" && details.message.includes("orgsnapshot")) {
			return true;
		}
		return details.message.includes("sobject type 'orgsnapshot' is not supported");
	}

	private mapOrgSnapshot(record: QueryRecord): OrgSnapshot | undefined {
		const id = this.readOptionalString(record.Id);
		const snapshotName = this.readOptionalString(record.SnapshotName);
		const createdDate = this.readOptionalString(record.CreatedDate);
		if (!id || !snapshotName || !createdDate) {
			return undefined;
		}

		return {
			id,
			snapshotName,
			description: this.readOptionalString(record.Content),
			status: this.readOptionalString(record.Status) ?? "Unknown",
			expirationDate: this.readOptionalString(record.ExpirationDate),
			createdDate,
			sourceOrgId: this.readOptionalString(record.SourceOrg),
		};
	}

	private readOptionalString(value: unknown): string | undefined {
		return typeof value === "string" && value.trim() !== "" ? value : undefined;
	}

	private readQueryErrorDetails(error: unknown): { errorCode?: string; message: string } {
		if (!error || typeof error !== "object") {
			return { message: "" };
		}
		const objectError = error as {
			errorCode?: unknown;
			message?: unknown;
			data?: unknown;
		};
		const message =
			typeof objectError.message === "string" ? objectError.message.toLowerCase() : "";
		const errorCode = typeof objectError.errorCode === "string" ? objectError.errorCode : undefined;

		const firstDataError =
			Array.isArray(objectError.data) && objectError.data.length > 0
				? (objectError.data[0] as QueryErrorPayload)
				: undefined;
		const dataMessage =
			typeof firstDataError?.message === "string" ? firstDataError.message.toLowerCase() : "";
		const dataErrorCode =
			typeof firstDataError?.errorCode === "string" ? firstDataError.errorCode : undefined;

		return {
			errorCode: errorCode ?? dataErrorCode,
			message: dataMessage || message,
		};
	}
}
