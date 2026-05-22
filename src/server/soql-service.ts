import { Org } from "@salesforce/core";

import { ApiError } from "./api-error";
import { assertSalesforceHost } from "./salesforce-host";
import type {
	BulkQueryResultRequest,
	BulkQueryStatusRequest,
	BulkQueryStatusResponse,
	DescribeGlobalRequest,
	DescribeGlobalResponse,
	DescribeObjectRequest,
	DescribeObjectResponse,
	RunQueryRequest,
	RunQueryResponse,
	StartBulkQueryRequest,
	StartBulkQueryResponse,
	ValidateQueryRequest,
	ValidateQueryResponse,
} from "../shared/soql";

type QueryResponse = {
	records: Array<Record<string, unknown>>;
	totalSize: number;
	done: boolean;
	nextRecordsUrl?: string;
};

type DescribeGlobalRaw = {
	sobjects?: Array<{ name?: string; label?: string; custom?: boolean; queryable?: boolean; keyPrefix?: string }>;
};

type DescribeObjectRaw = {
	fields?: Array<{
		name?: string;
		label?: string;
		type?: string;
		length?: number;
		nillable?: boolean;
		filterable?: boolean;
		sortable?: boolean;
		picklistValues?: Array<{ value?: string }>;
		relationshipName?: string;
		referenceTo?: string[];
	}>;
};

type SoqlConnection = {
	instanceUrl: string;
	accessToken?: string;
	getApiVersion(): string;
	describeGlobal(): Promise<DescribeGlobalRaw>;
	describe(sobjectName: string): Promise<DescribeObjectRaw>;
	query(soql: string): Promise<QueryResponse>;
	queryMore(nextRecordsUrl: string): Promise<QueryResponse>;
	tooling: {
		describeGlobal(): Promise<DescribeGlobalRaw>;
		describe(sobjectName: string): Promise<DescribeObjectRaw>;
		query(soql: string): Promise<QueryResponse>;
	};
	bulk2?: {
		query(soql: string): Promise<{ id?: string } | string>;
		job(id: string): {
			check(): Promise<{ state: string; numberRecordsProcessed?: number }>;
			result(): Promise<string>;
		};
	};
};

type SoqlServiceOptions = {
	connectionFactory?: (username: string) => Promise<SoqlConnection>;
	fetcher?: typeof fetch;
};

export type SoqlServiceApi = {
	describeGlobal(request: DescribeGlobalRequest): Promise<DescribeGlobalResponse>;
	describeObject(request: DescribeObjectRequest): Promise<DescribeObjectResponse>;
	validateQuery(request: ValidateQueryRequest): Promise<ValidateQueryResponse>;
	runQuery(request: RunQueryRequest): Promise<RunQueryResponse>;
	startBulkQuery(request: StartBulkQueryRequest): Promise<StartBulkQueryResponse>;
	getBulkQueryStatus(request: BulkQueryStatusRequest): Promise<BulkQueryStatusResponse>;
	getBulkQueryResult(request: BulkQueryResultRequest): Promise<string>;
};

export class SoqlService implements SoqlServiceApi {
	private readonly connectionFactory: (username: string) => Promise<SoqlConnection>;
	private readonly fetcher: typeof fetch;
	private readonly describeGlobalCache = new Map<string, DescribeGlobalResponse>();
	private readonly describeObjectCache = new Map<string, DescribeObjectResponse>();

	constructor(options: SoqlServiceOptions = {}) {
		this.connectionFactory = options.connectionFactory ?? createConnection;
		this.fetcher = options.fetcher ?? fetch;
	}

	async describeGlobal(request: DescribeGlobalRequest): Promise<DescribeGlobalResponse> {
		const cacheKey = `${request.username}::${request.api}`;
		const cached = this.describeGlobalCache.get(cacheKey);
		if (cached) return cached;

		const connection = await this.connectionFactory(request.username);
		const raw = request.api === "tooling"
			? await connection.tooling.describeGlobal()
			: await connection.describeGlobal();
		const sobjects = (raw.sobjects ?? [])
			.filter((sobject) => {
				if (sobject.queryable !== true || typeof sobject.name !== "string") return false;
				const label = (sobject.label ?? "").toUpperCase();
				const apiName = sobject.name.toUpperCase();
				return !label.includes("__MISSING LABEL__") && !apiName.includes("__MISSING LABEL__");
			})
			.map((sobject) => ({
				apiName: sobject.name ?? "",
				label: sobject.label ?? sobject.name ?? "",
				custom: sobject.custom === true,
				queryable: sobject.queryable === true,
				keyPrefix: sobject.keyPrefix,
			}))
			.sort((left, right) => left.label.localeCompare(right.label));
		const response = { sobjects };
		this.describeGlobalCache.set(cacheKey, response);
		return response;
	}

	async describeObject(request: DescribeObjectRequest): Promise<DescribeObjectResponse> {
		const cacheKey = `${request.username}::${request.api}::${request.sobject.toLowerCase()}`;
		const cached = this.describeObjectCache.get(cacheKey);
		if (cached) return cached;

		const connection = await this.connectionFactory(request.username);
		const raw = request.api === "tooling"
			? await connection.tooling.describe(request.sobject)
			: await connection.describe(request.sobject);
		const response = {
			sobject: request.sobject,
			fields: (raw.fields ?? [])
				.filter((field) => typeof field.name === "string")
				.map((field) => {
					const picklistValues = (field.picklistValues ?? [])
						.map((value) => value.value)
						.filter((value): value is string => typeof value === "string");
					return {
						apiName: field.name ?? "",
						label: field.label ?? field.name ?? "",
						type: field.type ?? "unknown",
						length: field.length,
						nillable: field.nillable !== false,
						filterable: field.filterable === true,
						sortable: field.sortable === true,
						picklistValues: picklistValues.length ? picklistValues : undefined,
						relationshipName: field.relationshipName,
						referenceTo: field.referenceTo,
					};
				})
				.sort((left, right) => left.label.localeCompare(right.label)),
		};
		this.describeObjectCache.set(cacheKey, response);
		return response;
	}

	async validateQuery(request: ValidateQueryRequest): Promise<ValidateQueryResponse> {
		const trimmed = request.soql.trim();
		if (!trimmed) {
			throw new ApiError(400, "INVALID_REQUEST", "SOQL query must be a non-empty string.");
		}
		const connection = await this.connectionFactory(request.username);
		if (request.api === "tooling") {
			const toolingSoql = ensureToolingValidationLimit(trimmed);
			try {
				await runToolingQuery(connection, toolingSoql, this.fetcher);
				return { valid: true };
			} catch (error) {
				return { valid: false, message: toErrorMessage(error) };
			}
		}

		assertSalesforceHost(connection.instanceUrl);
		if (!connection.accessToken?.trim()) {
			throw new ApiError(401, "INVALID_SESSION", "Salesforce access token is missing.");
		}
		const encoded = encodeURIComponent(trimmed);
		const version = connection.getApiVersion();
		const timeoutSignal = AbortSignal.timeout(15000);
		const response = await this.fetcher(
			`${connection.instanceUrl}/services/data/v${version}/query/?explain=${encoded}`,
			{
				method: "GET",
				signal: timeoutSignal,
				headers: {
					Authorization: `Bearer ${connection.accessToken}`,
					Accept: "application/json",
				},
			},
		);

		if (response.ok) return { valid: true };
		const message = await readFetchError(response);
		return { valid: false, message };
	}

	async runQuery(request: RunQueryRequest): Promise<RunQueryResponse> {
		const connection = await this.connectionFactory(request.username);
		if (request.nextRecordsUrl) {
			if (request.api === "tooling") {
				throw new ApiError(400, "TOOLING_QUERYMORE_UNSUPPORTED", "Tooling API pagination is not supported for this object. Add LIMIT to keep results in one batch.");
			}
			let page = await connection.queryMore(request.nextRecordsUrl);
			let records = sanitizeRecords(page.records);
			let nextRecordsUrl = page.nextRecordsUrl;
			let done = page.done;
			while (!done && nextRecordsUrl) {
				page = await connection.queryMore(nextRecordsUrl);
				records = records.concat(sanitizeRecords(page.records));
				nextRecordsUrl = page.nextRecordsUrl;
				done = page.done;
			}
			return {
				records,
				totalSize: 0,
				done,
				nextRecordsUrl,
			};
		}

		const queryText = request.previewLimit ? applyPreviewLimit(request.soql, request.previewLimit) : request.soql;
		const firstPage = request.api === "tooling"
			? await runToolingQuery(connection, queryText, this.fetcher)
			: await connection.query(queryText);

		if (request.previewLimit) {
			const records = sanitizeRecords(firstPage.records).slice(0, request.previewLimit);
			return {
				records,
				totalSize: firstPage.totalSize,
				done: firstPage.done,
				nextRecordsUrl: firstPage.nextRecordsUrl,
			};
		}

		if (request.includeAllPages !== true) {
			return {
				records: sanitizeRecords(firstPage.records),
				totalSize: firstPage.totalSize,
				done: firstPage.done,
				nextRecordsUrl: firstPage.nextRecordsUrl,
			};
		}
		if (request.api === "tooling") {
			return {
				records: sanitizeRecords(firstPage.records),
				totalSize: firstPage.totalSize,
				done: firstPage.done,
				nextRecordsUrl: firstPage.nextRecordsUrl,
			};
		}

		let records = sanitizeRecords(firstPage.records);
		let nextRecordsUrl = firstPage.nextRecordsUrl;
		let done = firstPage.done;
		while (!done && nextRecordsUrl) {
			const page = await connection.queryMore(nextRecordsUrl);
			records = records.concat(sanitizeRecords(page.records));
			nextRecordsUrl = page.nextRecordsUrl;
			done = page.done;
		}

		return {
			records,
			totalSize: firstPage.totalSize,
			done,
			nextRecordsUrl,
		};
	}

	async startBulkQuery(request: StartBulkQueryRequest): Promise<StartBulkQueryResponse> {
		const connection = await this.connectionFactory(request.username);
		if (!connection.bulk2) {
			throw new ApiError(400, "BULK_UNAVAILABLE", "Bulk API is unavailable for this org connection.");
		}
		const started = await connection.bulk2.query(request.soql);
		const jobId = typeof started === "string" ? started : started.id;
		if (!jobId) {
			throw new ApiError(500, "BULK_START_FAILED", "Bulk query job did not return an id.");
		}
		return { jobId };
	}

	async getBulkQueryStatus(request: BulkQueryStatusRequest): Promise<BulkQueryStatusResponse> {
		const connection = await this.connectionFactory(request.username);
		if (!connection.bulk2) {
			throw new ApiError(400, "BULK_UNAVAILABLE", "Bulk API is unavailable for this org connection.");
		}
		const status = await connection.bulk2.job(request.jobId).check();
		return {
			jobId: request.jobId,
			state: status.state,
			recordsProcessed: status.numberRecordsProcessed,
		};
	}

	async getBulkQueryResult(request: BulkQueryResultRequest): Promise<string> {
		const connection = await this.connectionFactory(request.username);
		if (!connection.bulk2) {
			throw new ApiError(400, "BULK_UNAVAILABLE", "Bulk API is unavailable for this org connection.");
		}
		return connection.bulk2.job(request.jobId).result();
	}
}

async function createConnection(username: string): Promise<SoqlConnection> {
	const org = await Org.create({ aliasOrUsername: username });
	return org.getConnection() as unknown as SoqlConnection;
}

function sanitizeRecords(records: Array<Record<string, unknown>>) {
	return records.map((record) => {
		const sanitized = { ...record };
		delete sanitized.attributes;
		return sanitized;
	});
}

async function runToolingQuery(
	connection: SoqlConnection,
	soql: string,
	fetcher: typeof fetch,
): Promise<QueryResponse> {
	assertSalesforceHost(connection.instanceUrl);
	if (!connection.accessToken?.trim()) {
		throw new ApiError(401, "INVALID_SESSION", "Salesforce access token is missing.");
	}
	const encoded = encodeURIComponent(soql);
	const version = connection.getApiVersion();
	const timeoutSignal = AbortSignal.timeout(15000);
	const response = await fetcher(
		`${connection.instanceUrl}/services/data/v${version}/tooling/query/?q=${encoded}`,
		{
			method: "GET",
			signal: timeoutSignal,
			headers: {
				Authorization: `Bearer ${connection.accessToken}`,
				Accept: "application/json",
			},
		},
	);
	if (!response.ok) {
		throw new Error(await readFetchError(response));
	}
	return (await response.json()) as QueryResponse;
}

function ensureToolingValidationLimit(soql: string): string {
	return applyPreviewLimit(soql, 1);
}

function applyPreviewLimit(soql: string, previewLimit: number): string {
	const normalizedLimit = Math.max(0, Math.min(previewLimit, 5));
	const trailingModifierMatch = soql.match(/\s+FOR\s+(VIEW|UPDATE)\s*$/i);
	const trailingModifier = trailingModifierMatch?.[0] ?? "";
	const withoutTrailingModifier = trailingModifier ? soql.slice(0, -trailingModifier.length) : soql;

	const limitMatch = withoutTrailingModifier.match(/\s+\bLIMIT\s+(\d+)\b(\s+OFFSET\s+\d+)?\s*$/i);
	if (limitMatch) {
		const existing = Number(limitMatch[1]);
		const offsetPart = limitMatch[2] ?? "";
		const replacement = ` LIMIT ${Math.min(existing, normalizedLimit)}${offsetPart}`;
		return `${withoutTrailingModifier.replace(/\s+\bLIMIT\s+\d+\b(\s+OFFSET\s+\d+)?\s*$/i, replacement)}${trailingModifier}`;
	}

	return `${withoutTrailingModifier} LIMIT ${normalizedLimit}${trailingModifier}`;
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return "SOQL validation failed.";
}

async function readFetchError(response: Response): Promise<string> {
	try {
		const payload = (await response.json()) as Array<{ message?: string }> | { message?: string };
		if (Array.isArray(payload)) {
			return payload[0]?.message ?? `Validation failed (${response.status}).`;
		}
		return payload.message ?? `Validation failed (${response.status}).`;
	} catch {
		return `Validation failed (${response.status}).`;
	}
}

