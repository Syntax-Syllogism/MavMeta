import JSZip from "jszip";
import { Org } from "@salesforce/core";

import { ApiError } from "./api-error";
import { redactSecrets } from "./redact-secrets";
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

type MetadataConnection = {
	deploy(zipInput: Buffer, options: Record<string, unknown>): Promise<unknown>;
	checkDeployStatus(id: string, includeDetails: boolean): Promise<unknown>;
};

type LwcConnection = {
	tooling: ToolingConnection;
	metadata: MetadataConnection;
};

// Poll interval / timeout for the Metadata API fallback.
// Both are overridable via LwcServiceOptions so unit tests run instantly.
const DEFAULT_LWC_METADATA_POLL_INTERVAL_MS = 3000;
const DEFAULT_LWC_METADATA_DEPLOY_TIMEOUT_MS = 120_000;

type LwcServiceOptions = {
	connectionFactory?: (username: string) => Promise<LwcConnection>;
	/** Injectable for tests — defaults to a real setTimeout-based sleep. */
	sleep?: (ms: number) => Promise<void>;
	/** Max ms to wait for the Metadata fallback job before timing out. */
	metadataDeployTimeoutMs?: number;
	/** How often to poll checkDeployStatus during the fallback. */
	metadataDeployPollIntervalMs?: number;
};

export type LwcServiceApi = {
	listBundles(request: ListLwcBundlesRequest): Promise<ListLwcBundlesResponse>;
	getBundle(request: GetLwcBundleRequest): Promise<GetLwcBundleResponse>;
	deployBundle(request: DeployLwcBundleRequest): Promise<DeployLwcBundleResponse>;
};

export class LwcService implements LwcServiceApi {
	private readonly connectionFactory: (username: string) => Promise<LwcConnection>;
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly metadataDeployTimeoutMs: number;
	private readonly metadataDeployPollIntervalMs: number;

	constructor(options: LwcServiceOptions = {}) {
		this.connectionFactory = options.connectionFactory ?? createConnection;
		this.sleep = options.sleep ?? defaultSleep;
		this.metadataDeployTimeoutMs =
			options.metadataDeployTimeoutMs ?? DEFAULT_LWC_METADATA_DEPLOY_TIMEOUT_MS;
		this.metadataDeployPollIntervalMs =
			options.metadataDeployPollIntervalMs ?? DEFAULT_LWC_METADATA_POLL_INTERVAL_MS;
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
		const connection = await this.connectionFactory(request.orgUsername);
		const { tooling } = connection;

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
			// If this looks like the known Tooling API schema-ref bug, fall back to
			// the Metadata API which handles `@salesforce/schema` imports correctly.
			if (isToolingSchemaRefBug(err)) {
				console.warn(
					`[lwc-service] Tooling API deploy failed with schema-ref bug; falling back to Metadata API. Original error: ${redactSecrets(err instanceof Error ? err.message : String(err))}`,
				);
				return this.fallbackToMetadataDeploy(connection, request, start);
			}
			return {
				status: "error",
				durationMs: Date.now() - start,
				errors: parseLwcErrors(
					err,
					request.files.map((f) => f.path),
				),
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

	/**
	 * Metadata API fallback for the Tooling API schema-ref bug.
	 *
	 * Assembles the complete bundle (server sources + edited sources overlaid),
	 * deploys via `connection.metadata.deploy`, polls to completion, and returns
	 * the same `DeployLwcBundleResponse` shape the Tooling path uses.
	 *
	 * All internal errors (network, query, deploy, poll) are caught and returned
	 * as a `status: "error"` response so callers never see an unhandled rejection.
	 */
	private async fallbackToMetadataDeploy(
		connection: LwcConnection,
		request: DeployLwcBundleRequest,
		start: number,
	): Promise<DeployLwcBundleResponse> {
		const { tooling, metadata } = connection;

		try {
			// 1. Resolve bundle identity (DeveloperName, ApiVersion).
			// Note: namespaced bundles are out of scope for this fallback — the
			// playground exclusively edits no-namespace bundles, so NamespacePrefix
			// is intentionally not fetched or used. The package.xml member is always
			// the bare DeveloperName.
			const bundleInfoResult = await tooling.query(
				`SELECT DeveloperName, ApiVersion FROM LightningComponentBundle WHERE Id = '${request.bundleId}'`,
			);
			if (!bundleInfoResult.records.length) {
				return {
					status: "error",
					durationMs: Date.now() - start,
					errors: [
						{
							filePath: "",
							message: `Bundle ${request.bundleId} not found during Metadata fallback.`,
							severity: "error",
						},
					],
				};
			}
			const bundleInfo = bundleInfoResult.records[0];
			const developerName = String(bundleInfo.DeveloperName ?? "");

			// ApiVersion is a number from the Tooling API (e.g. 62, not "62.0").
			// The Metadata API expects the "XX.0" string form in package.xml.
			const apiVersionNum = Number(bundleInfo.ApiVersion || 66);
			const apiVersion = Number.isFinite(apiVersionNum) ? apiVersionNum.toFixed(1) : "66.0";

			// 2. Assemble full file set: all current resources, dirty files overlaid.
			const resourcesResult = await tooling.query(
				`SELECT FilePath, Source, Format FROM LightningComponentResource WHERE LightningComponentBundleId = '${request.bundleId}'`,
			);

			const editedByPath = new Map(request.files.map((f) => [f.path, f.source]));

			const allFiles = resourcesResult.records.map((r) => ({
				filePath: String(r.FilePath ?? ""),
				source: editedByPath.has(String(r.FilePath ?? ""))
					? editedByPath.get(String(r.FilePath ?? ""))!
					: String(r.Source ?? ""),
			}));

			// 3. Build the deploy zip (may throw on unsafe paths).
			const zipBuffer = await buildLwcDeployZip(developerName, apiVersion, allFiles);

			// 4. Deploy + poll.
			const deployResult = await this.runMetadataDeployAndPoll(metadata, zipBuffer, start);
			if (deployResult.status === "error") {
				return deployResult;
			}

			// 5. On success, re-query LastModifiedDate so the playground snapshot stays correct.
			const updatedBundleResult = await tooling.query(
				`SELECT LastModifiedDate FROM LightningComponentBundle WHERE Id = '${request.bundleId}'`,
			);
			const newLastModifiedDate =
				updatedBundleResult.records.length > 0
					? String(updatedBundleResult.records[0].LastModifiedDate ?? "")
					: request.expectedLastModifiedDate;

			return {
				status: "success",
				durationMs: Date.now() - start,
				newLastModifiedDate,
			};
		} catch (err) {
			// Any unexpected error (network, SOQL, jsforce) is mapped to a graceful
			// error response so the client always receives JSON instead of a 500.
			console.error(
				`[lwc-service] Unexpected error during Metadata API fallback: ${redactSecrets(err instanceof Error ? err.message : String(err))}`,
			);
			return {
				status: "error",
				durationMs: Date.now() - start,
				errors: [
					{
						filePath: "",
						message: redactSecrets(
							err instanceof Error ? err.message : "Metadata API fallback failed unexpectedly.",
						),
						severity: "error",
					},
				],
			};
		}
	}

	/**
	 * Starts a Metadata API deploy job and polls until a terminal state.
	 * Returns success or a mapped error response. Throws on unexpected errors
	 * (caught by the `fallbackToMetadataDeploy` try/catch).
	 */
	private async runMetadataDeployAndPoll(
		metadata: MetadataConnection,
		zipBuffer: Buffer,
		start: number,
	): Promise<DeployLwcBundleResponse & { status: "success" | "error" }> {
		// Start the deploy. jsforce may return either a plain { id } object or a
		// DeployResultLocator that exposes a .check() method — mirror the handling
		// in deploy-service's readDeployStartPayload.
		const startResponse = await metadata.deploy(zipBuffer, {
			singlePackage: true,
			rollbackOnError: true,
		});

		const jobId = await readMetadataJobId(startResponse);
		if (!jobId) {
			return {
				status: "error",
				durationMs: Date.now() - start,
				errors: [
					{
						filePath: "",
						message: "Metadata API deploy did not return a job ID.",
						severity: "error",
					},
				],
			};
		}

		// Poll until terminal state or timeout.
		const deadline = Date.now() + this.metadataDeployTimeoutMs;

		for (;;) {
			await this.sleep(this.metadataDeployPollIntervalMs);

			if (Date.now() > deadline) {
				return {
					status: "error",
					durationMs: Date.now() - start,
					errors: [
						{
							filePath: "",
							message: `Metadata API deploy timed out after ${this.metadataDeployTimeoutMs}ms (job ${jobId}).`,
							severity: "error",
						},
					],
				};
			}

			// A transient checkDeployStatus failure (network blip, session expiry
			// during a long poll) is re-thrown to the fallbackToMetadataDeploy
			// try/catch which maps it to a graceful error response.
			const rawStatus = await metadata.checkDeployStatus(jobId, true);
			const statusPayload = unwrapMetadataResult(rawStatus);
			const state = readMetadataState(statusPayload);

			if (!isMetadataTerminalState(state)) continue;

			if (state === "Succeeded") {
				// Caller will re-query LastModifiedDate; return a placeholder success.
				return {
					status: "success",
					durationMs: Date.now() - start,
					newLastModifiedDate: "",
				};
			}

			// Terminal non-success: extract component failures.
			const errors = extractMetadataErrors(statusPayload);
			return {
				status: "error",
				durationMs: Date.now() - start,
				errors:
					errors.length > 0
						? errors
						: [
								{
									filePath: "",
									message: `Metadata API deploy failed with state: ${state}.`,
									severity: "error",
								},
							],
			};
		}
	}
}

// ---------------------------------------------------------------------------
// Metadata result helpers (inline, scoped to the LWC fallback path)
// ---------------------------------------------------------------------------

function unwrapMetadataResult(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const record = value as Record<string, unknown>;
	const nested = record.result;
	if (nested && typeof nested === "object" && !Array.isArray(nested)) {
		return nested as Record<string, unknown>;
	}
	return record;
}

async function readMetadataJobId(value: unknown): Promise<string | undefined> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;

	// jsforce v2 may return a DeployResultLocator with a .check() method rather
	// than a plain { id } object. Mirror deploy-service's readDeployStartPayload.
	const checkCandidate = record.check;
	if (typeof checkCandidate === "function") {
		const checkResult = await (checkCandidate as () => Promise<unknown>)();
		return extractJobIdFromRecord(unwrapMetadataResult(checkResult));
	}

	// Plain { id } or { result: { id } } shapes.
	return extractJobIdFromRecord(record) ?? extractJobIdFromRecord(unwrapMetadataResult(value));
}

function extractJobIdFromRecord(record: Record<string, unknown>): string | undefined {
	for (const candidate of [record.id, record.jobId, record.asyncId, record.deployId]) {
		if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
	}
	return undefined;
}

function readMetadataState(payload: Record<string, unknown>): string {
	const status = payload.status;
	return typeof status === "string" && status.trim() ? status.trim() : "InProgress";
}

function isMetadataTerminalState(state: string): boolean {
	return (
		state === "Succeeded" ||
		state === "SucceededPartial" ||
		state === "Failed" ||
		state === "Canceled" ||
		state === "Canceling" ||
		state === "FinalizingDeployFailed"
	);
}

function extractMetadataErrors(payload: Record<string, unknown>): LwcCompileError[] {
	const details = payload.details;
	if (!details || typeof details !== "object" || Array.isArray(details)) return [];
	const detailsRecord = details as Record<string, unknown>;
	const raw = detailsRecord.componentFailures;
	const failures: unknown[] = Array.isArray(raw) ? raw : raw ? [raw] : [];

	return failures
		.map((failure) => {
			if (!failure || typeof failure !== "object" || Array.isArray(failure)) return null;
			const f = failure as Record<string, unknown>;
			const problem = typeof f.problem === "string" ? f.problem.trim() : "";
			const fileName = typeof f.fileName === "string" ? f.fileName.trim() : "";
			if (!problem) return null;

			const lineNum = typeof f.lineNumber === "number" ? f.lineNumber : Number(f.lineNumber);
			const colNum = typeof f.columnNumber === "number" ? f.columnNumber : Number(f.columnNumber);

			const error: LwcCompileError = {
				filePath: fileName,
				message: problem,
				severity: "error" as const,
			};
			if (Number.isFinite(lineNum) && lineNum > 0) error.line = lineNum;
			if (Number.isFinite(colNum) && colNum > 0) error.column = colNum;
			return error;
		})
		.filter((e): e is LwcCompileError => e !== null);
}

// ---------------------------------------------------------------------------
// LWC Metadata deploy zip builder
// ---------------------------------------------------------------------------

/**
 * Validates that a FilePath from the Tooling API is safe to use as a zip entry.
 * Paths must start with `lwc/` and must not contain traversal segments.
 */
function validateLwcFilePath(filePath: string): void {
	const normalized = filePath.replaceAll("\\", "/");
	if (!normalized.startsWith("lwc/")) {
		throw new Error(`Unsafe LWC resource path (must start with lwc/): ${filePath}`);
	}
	if (normalized.startsWith("/") || normalized.includes("\0")) {
		throw new Error(`Unsafe LWC resource path: ${filePath}`);
	}
	const segments = normalized.split("/");
	if (segments.some((s) => s === "..")) {
		throw new Error(`Unsafe LWC resource path: ${filePath}`);
	}
}

function buildLwcPackageXml(developerName: string, apiVersion: string): string {
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
		"  <types>",
		`    <members>${xmlEscape(developerName)}</members>`,
		"    <name>LightningComponentBundle</name>",
		"  </types>",
		`  <version>${xmlEscape(String(apiVersion))}</version>`,
		"</Package>",
	].join("\n");
}

function xmlEscape(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function buildLwcDeployZip(
	developerName: string,
	apiVersion: string,
	files: Array<{ filePath: string; source: string }>,
): Promise<Buffer> {
	const zip = new JSZip();
	for (const file of files) {
		validateLwcFilePath(file.filePath);
		zip.file(file.filePath, file.source);
	}
	zip.file("package.xml", buildLwcPackageXml(developerName, apiVersion));
	return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// ---------------------------------------------------------------------------
// Conflict check
// ---------------------------------------------------------------------------

async function checkConflict(
	tooling: ToolingConnection,
	bundleId: string,
	expectedLastModifiedDate: string,
): Promise<(DeployLwcBundleResponse & { status: "conflict" }) | null> {
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

// ---------------------------------------------------------------------------
// Error parsing
// ---------------------------------------------------------------------------

// LWC Tooling API compile errors: "LWC1099: message\n  lwc/comp/file.js:line:col"
const LWC_ERROR_RE = /LWC\d+:\s*([^\n]+)(?:\n\s+([\w/.-]+):(\d+):(\d+))?/g;

// Tooling API schema validation: "Invalid reference Foo__c.Bar__c of type sobjectField in file foo.js: Source"
const SCHEMA_REF_ERROR_RE =
	/Invalid reference (\S+) of type sobjectField in file ([\w./-]+):\s*Source/g;

/**
 * Returns true when the Tooling API error matches the known schema-ref bug
 * (`FIELD_INTEGRITY_EXCEPTION` / "Invalid reference … of type sobjectField").
 * Used to decide whether to fall back to the Metadata API.
 */
function isToolingSchemaRefBug(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	// Check the error code field that jsforce sometimes exposes
	if (
		err !== null &&
		typeof err === "object" &&
		"errorCode" in err &&
		err.errorCode === "FIELD_INTEGRITY_EXCEPTION"
	) {
		return true;
	}
	if (message.includes("FIELD_INTEGRITY_EXCEPTION")) return true;
	SCHEMA_REF_ERROR_RE.lastIndex = 0;
	return SCHEMA_REF_ERROR_RE.test(message);
}

function parseLwcErrors(err: unknown, requestPaths: string[] = []): LwcCompileError[] {
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

	SCHEMA_REF_ERROR_RE.lastIndex = 0;
	while ((match = SCHEMA_REF_ERROR_RE.exec(message)) !== null) {
		const ref = match[1];
		const fileName = match[2];
		errors.push({
			filePath: resolveFilePath(fileName, requestPaths),
			message:
				`Could not resolve @salesforce/schema reference '${ref}'. ` +
				`Confirm the field exists in the target org and the running user has FLS access ` +
				`(managed-package fields require the namespace prefix). ` +
				`If the field is confirmed present and accessible, this can also be a Salesforce ` +
				`Tooling API bug with @salesforce/schema imports.`,
			severity: "error",
		});
	}

	return errors.length > 0 ? errors : [{ filePath: "", message, severity: "error" }];
}

function resolveFilePath(fileName: string, requestPaths: string[]): string {
	const match = requestPaths.find((p) => p === fileName || p.endsWith(`/${fileName}`));
	return match ?? fileName;
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

function validateBundleId(bundleId: string): void {
	if (!SALESFORCE_ID_REGEX.test(bundleId)) {
		throw new ApiError(
			400,
			"INVALID_REQUEST",
			"bundleId must be a valid 15 or 18-character Salesforce Id.",
		);
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

async function defaultSleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function createConnection(username: string): Promise<LwcConnection> {
	const org = await Org.create({ aliasOrUsername: username });
	const connection = org.getConnection();
	return connection as unknown as LwcConnection;
}
