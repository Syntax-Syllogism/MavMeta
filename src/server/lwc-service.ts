import { Org } from "@salesforce/core";

import { ApiError } from "./api-error";
import type {
	DeployLwcBundleRequest,
	DeployLwcBundleResponse,
	GetLwcBundleRequest,
	GetLwcBundleResponse,
	ListLwcBundlesRequest,
	ListLwcBundlesResponse,
	LwcBundleSummary,
	LwcCompileError,
	LwcFile,
} from "../shared/lwc";

const SALESFORCE_ID_REGEX = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;

type ToolingRecord = Record<string, unknown>;

type ToolingConnection = {
	query: (soql: string) => Promise<{ records: ToolingRecord[] }>;
	sobject: (type: string) => {
		update: (data: ToolingRecord) => Promise<void>;
	};
};

type LwcConnection = {
	tooling: ToolingConnection;
};

type LwcServiceOptions = {
	connectionFactory?: (username: string) => Promise<LwcConnection>;
};

export type LwcServiceApi = {
	listBundles(request: ListLwcBundlesRequest): Promise<ListLwcBundlesResponse>;
	getBundle(request: GetLwcBundleRequest): Promise<GetLwcBundleResponse>;
	deployBundle(request: DeployLwcBundleRequest): Promise<DeployLwcBundleResponse>;
};

export class LwcService implements LwcServiceApi {
	private readonly connectionFactory: (username: string) => Promise<LwcConnection>;

	constructor(options: LwcServiceOptions = {}) {
		this.connectionFactory = options.connectionFactory ?? createConnection;
	}

	async listBundles(request: ListLwcBundlesRequest): Promise<ListLwcBundlesResponse> {
		const { tooling } = await this.connectionFactory(request.orgUsername);
		const result = await tooling.query(
			"SELECT Id, DeveloperName, MasterLabel, NamespacePrefix, ApiVersion, LastModifiedDate, LastModifiedBy.Name FROM LightningComponentBundle ORDER BY DeveloperName",
		);
		return {
			bundles: result.records.map(toBundleSummary),
		};
	}

	async getBundle(request: GetLwcBundleRequest): Promise<GetLwcBundleResponse> {
		validateBundleId(request.bundleId);
		const { tooling } = await this.connectionFactory(request.orgUsername);

		const [bundleResult, resourcesResult] = await Promise.all([
			tooling.query(
				`SELECT Id, DeveloperName, MasterLabel, NamespacePrefix, ApiVersion, LastModifiedDate, LastModifiedBy.Name FROM LightningComponentBundle WHERE Id = '${request.bundleId}'`,
			),
			tooling.query(
				`SELECT Id, FilePath, Format, Source, LastModifiedDate FROM LightningComponentResource WHERE LightningComponentBundleId = '${request.bundleId}'`,
			),
		]);

		if (!bundleResult.records.length) {
			throw new ApiError(404, "NOT_FOUND", `Bundle ${request.bundleId} not found.`);
		}

		return {
			bundle: toBundleSummary(bundleResult.records[0]),
			files: resourcesResult.records.map(toFile),
		};
	}

	async deployBundle(request: DeployLwcBundleRequest): Promise<DeployLwcBundleResponse> {
		validateBundleId(request.bundleId);
		const { tooling } = await this.connectionFactory(request.orgUsername);

		if (!request.force) {
			const conflictResult = await checkConflict(
				tooling,
				request.bundleId,
				request.expectedLastModifiedDate,
			);
			if (conflictResult) {
				return conflictResult;
			}
		}

		const start = Date.now();

		const existingResult = await tooling.query(
			`SELECT Id, FilePath FROM LightningComponentResource WHERE LightningComponentBundleId = '${request.bundleId}'`,
		);
		const idByPath = new Map<string, string>();
		for (const record of existingResult.records) {
			idByPath.set(String(record.FilePath ?? ""), String(record.Id ?? ""));
		}

		const missingPaths = request.files.filter((f) => !idByPath.has(f.path)).map((f) => f.path);
		if (missingPaths.length > 0) {
			return {
				status: "error",
				durationMs: Date.now() - start,
				errors: missingPaths.map((p) => ({
					filePath: p,
					message: `Resource not found on org: ${p}`,
					severity: "error" as const,
				})),
			};
		}

		try {
			await Promise.all(
				request.files.map((file) =>
					tooling.sobject("LightningComponentResource").update({
						Id: idByPath.get(file.path)!,
						Source: file.source,
					}),
				),
			);
		} catch (err) {
			return {
				status: "error",
				durationMs: Date.now() - start,
				errors: parseLwcErrors(err),
			};
		}

		const bundleResult = await tooling.query(
			`SELECT LastModifiedDate FROM LightningComponentBundle WHERE Id = '${request.bundleId}'`,
		);
		const newLastModifiedDate =
			bundleResult.records.length > 0
				? String(bundleResult.records[0].LastModifiedDate ?? "")
				: request.expectedLastModifiedDate;

		return {
			status: "success",
			durationMs: Date.now() - start,
			newLastModifiedDate,
		};
	}
}

async function checkConflict(
	tooling: ToolingConnection,
	bundleId: string,
	expectedLastModifiedDate: string,
): Promise<DeployLwcBundleResponse & { status: "conflict" } | null> {
	const result = await tooling.query(
		`SELECT LastModifiedDate FROM LightningComponentBundle WHERE Id = '${bundleId}'`,
	);

	if (!result.records.length) {
		return null;
	}

	const currentLastModifiedDate = String(result.records[0].LastModifiedDate ?? "");
	const expectedTime = new Date(expectedLastModifiedDate).getTime();
	const currentTime = new Date(currentLastModifiedDate).getTime();

	if (currentTime <= expectedTime) {
		return null;
	}

	const resourcesResult = await tooling.query(
		`SELECT FilePath FROM LightningComponentResource WHERE LightningComponentBundleId = '${bundleId}'`,
	);

	return {
		status: "conflict",
		currentLastModifiedDate,
		changedFiles: resourcesResult.records.map((r) => String(r.FilePath ?? "")),
	};
}


// LWC Tooling API compile errors: "LWC1099: message\n  lwc/comp/file.js:line:col"
const LWC_ERROR_RE = /LWC\d+:\s*([^\n]+)(?:\n\s+([\w/.-]+):(\d+):(\d+))?/g;

function parseLwcErrors(err: unknown): LwcCompileError[] {
	const message = err instanceof Error ? err.message : String(err);
	const errors: LwcCompileError[] = [];

	let match: RegExpExecArray | null;
	LWC_ERROR_RE.lastIndex = 0;
	while ((match = LWC_ERROR_RE.exec(message)) !== null) {
		errors.push({
			filePath: match[2] ?? "",
			line: match[3] !== undefined ? Number(match[3]) : undefined,
			column: match[4] !== undefined ? Number(match[4]) : undefined,
			message: match[1].trim(),
			severity: "error",
		});
	}

	return errors.length > 0 ? errors : [{ filePath: "", message, severity: "error" }];
}

function validateBundleId(bundleId: string): void {
	if (!SALESFORCE_ID_REGEX.test(bundleId)) {
		throw new ApiError(400, "INVALID_REQUEST", "bundleId must be a valid 15 or 18-character Salesforce Id.");
	}
}

function toBundleSummary(record: ToolingRecord): LwcBundleSummary {
	const lastModifiedBy = record.LastModifiedBy as { Name?: string } | null | undefined;
	return {
		id: String(record.Id ?? ""),
		developerName: String(record.DeveloperName ?? ""),
		masterLabel: String(record.MasterLabel ?? ""),
		namespacePrefix: record.NamespacePrefix ? String(record.NamespacePrefix) : null,
		apiVersion: Number(record.ApiVersion ?? 0),
		lastModifiedDate: String(record.LastModifiedDate ?? ""),
		lastModifiedByName: lastModifiedBy?.Name ?? "",
	};
}

function toFile(record: ToolingRecord): LwcFile {
	return {
		id: String(record.Id ?? ""),
		filePath: String(record.FilePath ?? ""),
		format: String(record.Format ?? ""),
		source: String(record.Source ?? ""),
		lastModifiedDate: String(record.LastModifiedDate ?? ""),
	};
}

async function createConnection(username: string): Promise<LwcConnection> {
	const org = await Org.create({ aliasOrUsername: username });
	const connection = org.getConnection();
	return connection as unknown as LwcConnection;
}
