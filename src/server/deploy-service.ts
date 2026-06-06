import { randomUUID } from "node:crypto";
import path from "node:path";

import JSZip from "jszip";
import { Org, type Connection } from "@salesforce/core";

import type {
	CancelDeployResponse,
	CancelCrossOrgDeployResponse,
	CancelDestructiveDeployResponse,
	CrossOrgDeployResult,
	CrossOrgDeployStatusResponse,
	DeployFailedComponent,
	DeploySkippedComponent,
	DestructiveDeployResult,
	DestructiveDeployStatusResponse,
	HitListComponentInput,
	StartCrossOrgDeployRequest,
	StartCrossOrgDeployResponse,
	StartDestructiveDeployRequest,
	StartDestructiveDeployResponse,
} from "../shared/deploy";
import { getDestructiveCompatibilityIssue } from "../shared/destructive-compatibility";
import type { OrgEnvironment } from "../shared/org";
import { ApiError } from "./api-error";
import { validateMetadataName } from "./metadata-name";
import { redactSecrets } from "./redact-secrets";

type DeployMetadataApi = {
	deploy(zipInput: Buffer | string, options: Record<string, unknown>): Promise<unknown>;
	checkDeployStatus(id: string, includeDetails: boolean): Promise<unknown>;
	cancelDeploy?(id: string): Promise<unknown>;
};

type DeployConnection = {
	query(soql: string): Promise<unknown>;
	metadata: DeployMetadataApi;
};

type RetrieveConnection = DeployConnection & {
	metadata: DeployMetadataApi & {
		pollInterval?: number;
		pollTimeout?: number;
		retrieve(request: {
			apiVersion: string | number;
			unpackaged: { types: Array<{ name: string; members: string[] }>; version: string | number };
		}): {
			complete(): Promise<{ zipFile?: string }>;
			on?(event: "error", listener: (error: Error) => void): unknown;
			off?(event: "error", listener: (error: Error) => void): unknown;
			removeListener?(event: "error", listener: (error: Error) => void): unknown;
		};
	};
	getApiVersion(): string;
};

type DeployOperation = {
	id: string;
	targetUsername: string;
	mode: StartDestructiveDeployRequest["mode"];
	environment: OrgEnvironment;
	skipped: DeploySkippedComponent[];
	status: "pending" | "running" | "succeeded" | "failed" | "canceled";
	percentComplete: number;
	message: string;
	deployState?: string;
	componentsProcessed?: number;
	componentsTotal?: number;
	jobId?: string;
	cancelRequested?: boolean;
	result?: DestructiveDeployResult;
	completedAt?: number;
};

type CrossOrgDeployOperation = {
	id: string;
	sourceUsername: string;
	targetUsername: string;
	mode: StartCrossOrgDeployRequest["mode"];
	environment: OrgEnvironment;
	skipped: DeploySkippedComponent[];
	status: "pending" | "running" | "succeeded" | "failed" | "canceled";
	percentComplete: number;
	message: string;
	deployState?: string;
	componentsProcessed?: number;
	componentsTotal?: number;
	jobId?: string;
	cancelRequested?: boolean;
	result?: CrossOrgDeployResult;
	completedAt?: number;
};

export type DeployServiceApi = {
	startDestructiveDeploy(
		request: StartDestructiveDeployRequest,
	): Promise<StartDestructiveDeployResponse>;
	getDestructiveDeployStatus(operationId: string): Promise<DestructiveDeployStatusResponse>;
	cancelDestructiveDeploy(operationId: string): Promise<CancelDestructiveDeployResponse>;
	startCrossOrgDeploy(request: StartCrossOrgDeployRequest): Promise<StartCrossOrgDeployResponse>;
	getCrossOrgDeployStatus(operationId: string): Promise<CrossOrgDeployStatusResponse>;
	cancelCrossOrgDeploy(operationId: string): Promise<CancelCrossOrgDeployResponse>;
};

type DeployServiceOptions = {
	connectionFactory?: (username: string) => Promise<DeployConnection>;
	sleep?: (milliseconds: number) => Promise<void>;
	uuidFactory?: () => string;
	now?: () => number;
	completedOperationTtlMs?: number;
};

const DEFAULT_COMPLETED_OPERATION_TTL_MS = 10 * 60 * 1000;
const DEFAULT_RETRIEVE_POLL_TIMEOUT_MS = 120000;
const DEFAULT_RETRIEVE_POLL_INTERVAL_MS = 2000;
const DEPLOY_STATUS_POLL_INTERVAL_MS = 3000;
const RETRIEVE_COMPONENT_YIELD_MS = 500;

export class DeployService implements DeployServiceApi {
	private readonly operations = new Map<string, DeployOperation>();
	private readonly crossOrgOperations = new Map<string, CrossOrgDeployOperation>();
	private readonly connectionFactory: (username: string) => Promise<DeployConnection>;
	private readonly sleep: (milliseconds: number) => Promise<void>;
	private readonly uuidFactory: () => string;
	private readonly now: () => number;
	private readonly completedOperationTtlMs: number;

	constructor(options: DeployServiceOptions = {}) {
		this.connectionFactory = options.connectionFactory ?? createConnection;
		this.sleep = options.sleep ?? defaultSleep;
		this.uuidFactory = options.uuidFactory ?? randomUUID;
		this.now = options.now ?? Date.now;
		this.completedOperationTtlMs =
			options.completedOperationTtlMs ?? DEFAULT_COMPLETED_OPERATION_TTL_MS;
	}

	async startDestructiveDeploy(
		request: StartDestructiveDeployRequest,
	): Promise<StartDestructiveDeployResponse> {
		this.pruneExpiredOperations();
		const normalized = normalizeComponents(request.components);
		const [supported, skipped] = partitionSupportedComponents(normalized);
		const operationId = this.uuidFactory();
		const environment = await this.resolveOrgEnvironment(request.target.username);
		const operation: DeployOperation = {
			id: operationId,
			targetUsername: request.target.username,
			mode: request.mode,
			environment,
			skipped,
			status: "pending",
			percentComplete: 0,
			message: "Preparing destructive deployment request.",
		};
		this.operations.set(operationId, operation);

		if (!supported.length) {
			operation.status = "failed";
			operation.percentComplete = 100;
			operation.message = "No deployable components were provided.";
			operation.completedAt = this.now();
			operation.result = {
				target: request.target,
				mode: request.mode,
				environment,
				success: false,
				state: "Failed",
				message: operation.message,
				skipped,
				failed: [],
			};
			return { operationId };
		}

		void this.runDestructiveOperation(operationId, request, supported);
		return { operationId };
	}

	async getDestructiveDeployStatus(operationId: string): Promise<DestructiveDeployStatusResponse> {
		this.pruneExpiredOperations();
		const operation = this.operations.get(operationId);
		if (!operation) {
			throw new ApiError(404, "DEPLOY_OPERATION_NOT_FOUND", "Deploy operation not found.");
		}
		return {
			operationId,
			status: operation.status,
			percentComplete: operation.percentComplete,
			message: operation.message,
			deployState: operation.deployState,
			componentsProcessed: operation.componentsProcessed,
			componentsTotal: operation.componentsTotal,
			result: operation.result,
		};
	}

	async cancelDestructiveDeploy(operationId: string): Promise<CancelDestructiveDeployResponse> {
		return this.cancelOperation(operationId, this.operations);
	}

	async startCrossOrgDeploy(
		request: StartCrossOrgDeployRequest,
	): Promise<StartCrossOrgDeployResponse> {
		this.pruneExpiredOperations();
		if (request.source.username === request.target.username) {
			throw new ApiError(400, "INVALID_REQUEST", "Source and target orgs must be different.");
		}
		const normalized = normalizeComponents(request.components);
		const [supported, skipped] = partitionSupportedComponents(normalized);
		const operationId = this.uuidFactory();
		const environment = await this.resolveOrgEnvironment(request.target.username);
		const operation: CrossOrgDeployOperation = {
			id: operationId,
			sourceUsername: request.source.username,
			targetUsername: request.target.username,
			mode: request.mode,
			environment,
			skipped,
			status: "pending",
			percentComplete: 0,
			message: "Preparing cross-org deployment request.",
		};
		this.crossOrgOperations.set(operationId, operation);

		if (!supported.length) {
			operation.status = "failed";
			operation.percentComplete = 100;
			operation.message = "No deployable components were provided.";
			operation.completedAt = this.now();
			operation.result = {
				source: request.source,
				target: request.target,
				mode: request.mode,
				environment,
				success: false,
				state: "Failed",
				message: operation.message,
				skipped,
				failed: [],
			};
			return { operationId };
		}

		void this.runCrossOrgOperation(operationId, request, supported);
		return { operationId };
	}

	async getCrossOrgDeployStatus(operationId: string): Promise<CrossOrgDeployStatusResponse> {
		this.pruneExpiredOperations();
		const operation = this.crossOrgOperations.get(operationId);
		if (!operation) {
			throw new ApiError(404, "DEPLOY_OPERATION_NOT_FOUND", "Deploy operation not found.");
		}
		return {
			operationId,
			status: operation.status,
			percentComplete: operation.percentComplete,
			message: operation.message,
			deployState: operation.deployState,
			componentsProcessed: operation.componentsProcessed,
			componentsTotal: operation.componentsTotal,
			result: operation.result,
		};
	}

	async cancelCrossOrgDeploy(operationId: string): Promise<CancelCrossOrgDeployResponse> {
		return this.cancelOperation(operationId, this.crossOrgOperations);
	}

	private async cancelOperation(
		operationId: string,
		operations: Map<string, DeployOperation | CrossOrgDeployOperation>,
	): Promise<CancelDeployResponse> {
		this.pruneExpiredOperations();
		const operation = operations.get(operationId);
		if (!operation) {
			return { operationId, canceled: false, message: "Deploy operation not found." };
		}
		if (isCompletedStatus(operation.status)) {
			return { operationId, canceled: false, message: "Deploy operation already completed." };
		}
		operation.cancelRequested = true;
		operation.message = "Cancel requested. Stopping deploy.";
		if (operation.jobId) {
			try {
				const connection = await this.connectionFactory(operation.targetUsername);
				await connection.metadata.cancelDeploy?.(operation.jobId);
			} catch {
				// best effort
			}
		}
		return { operationId, canceled: true, message: "Deploy cancel request sent." };
	}

	private async runDestructiveOperation(
		operationId: string,
		request: StartDestructiveDeployRequest,
		supported: HitListComponentInput[],
	) {
		const operation = this.operations.get(operationId);
		if (!operation) return;
		operation.status = "running";
		operation.message = "Starting Metadata API deployment job.";

		try {
			const connection = await this.connectionFactory(request.target.username);
			const zipBuffer = await buildMetadataDeployZip(supported);
			const finalPayload = await this.runDeployPolling({
				connection,
				zipBuffer,
				checkOnly: request.mode === "validate",
				onProgress: (progress) => {
					operation.percentComplete = progress.percentComplete;
					operation.message = progress.message;
					operation.deployState = progress.state;
					operation.componentsProcessed = progress.processed;
					operation.componentsTotal = progress.total;
				},
				onJobId: (jobId) => {
					operation.jobId = jobId;
				},
				shouldCancel: () => operation.cancelRequested === true,
			});
			if (!finalPayload) throw new Error("Missing deploy status payload.");
			const failed = extractFailedComponents(finalPayload);
			const outcome = resolveDeployOutcome(operation.deployState ?? "Failed", finalPayload, failed);
			operation.status = outcome.status;
			operation.percentComplete = 100;
			operation.completedAt = this.now();
			operation.result = {
				target: request.target,
				mode: request.mode,
				environment: operation.environment,
				success: outcome.success,
				state: outcome.resultState,
				message: outcome.success
					? `${request.mode === "validate" ? "Validation" : "Deploy"} completed successfully for ${supported.length} component(s).`
					: (outcome.message ?? operation.message),
				skipped: operation.skipped,
				failed,
				rawResult: finalPayload,
			};
			operation.message = operation.result.message;
		} catch (error) {
			operation.status = operation.cancelRequested ? "canceled" : "failed";
			operation.percentComplete = 100;
			operation.completedAt = this.now();
			operation.message = operation.cancelRequested
				? "Deploy canceled by user."
				: error instanceof Error
					? redactSecrets(error.message)
					: "Destructive deploy failed.";
			operation.result = {
				target: request.target,
				mode: request.mode,
				environment: operation.environment,
				success: false,
				state: operation.cancelRequested ? "Canceled" : "Failed",
				message: operation.message,
				skipped: operation.skipped,
				failed: [],
			};
		}
	}

	private async runDeployPolling(options: {
		connection: DeployConnection;
		zipBuffer: Buffer;
		checkOnly: boolean;
		onProgress: (progress: ReturnType<typeof readProgress>) => void;
		onJobId: (jobId: string) => void;
		shouldCancel: () => boolean;
	}): Promise<Record<string, unknown> | undefined> {
		const startResponse = await options.connection.metadata.deploy(options.zipBuffer, {
			checkOnly: options.checkOnly,
			rollbackOnError: true,
			singlePackage: true,
		});
		const startPayload = await readDeployStartPayload(startResponse);
		const jobId = readJobId(startPayload) ?? readJobId(startResponse);
		if (!jobId) {
			throw new Error(
				`Salesforce did not return a deploy job id. ${summarizeResultShape(startPayload ?? startResponse)}`,
			);
		}
		options.onJobId(jobId);

		for (;;) {
			await this.sleep(DEPLOY_STATUS_POLL_INTERVAL_MS);
			const rawStatusResult = await options.connection.metadata.checkDeployStatus(jobId, true);
			const statusPayload = unwrapDeployResult(rawStatusResult);
			const progress = readProgress(statusPayload);
			options.onProgress(progress);
			if (options.shouldCancel()) {
				throw new Error("Deploy canceled by user.");
			}
			if (progress.isTerminal) return statusPayload;
		}
	}

	private async runCrossOrgOperation(
		operationId: string,
		request: StartCrossOrgDeployRequest,
		supported: HitListComponentInput[],
	) {
		const operation = this.crossOrgOperations.get(operationId);
		if (!operation) return;
		operation.status = "running";
		operation.message = "Retrieving source metadata from source org.";

		try {
			const sourceConnection = (await this.connectionFactory(
				request.source.username,
			)) as RetrieveConnection;
			const targetConnection = await this.connectionFactory(request.target.username);
			const zipBuffer = await buildCrossOrgDeployZip(sourceConnection, supported);
			operation.message = "Starting cross-org Metadata API deployment job.";

			const finalPayload = await this.runDeployPolling({
				connection: targetConnection,
				zipBuffer,
				checkOnly: request.mode === "validate",
				onProgress: (progress) => {
					operation.percentComplete = progress.percentComplete;
					operation.message = progress.message;
					operation.deployState = progress.state;
					operation.componentsProcessed = progress.processed;
					operation.componentsTotal = progress.total;
				},
				onJobId: (jobId) => {
					operation.jobId = jobId;
				},
				shouldCancel: () => operation.cancelRequested === true,
			});
			if (!finalPayload) throw new Error("Missing deploy status payload.");
			const failed = extractFailedComponents(finalPayload);
			const outcome = resolveDeployOutcome(operation.deployState ?? "Failed", finalPayload, failed);
			operation.status = outcome.status;
			operation.percentComplete = 100;
			operation.completedAt = this.now();
			operation.result = {
				source: request.source,
				target: request.target,
				mode: request.mode,
				environment: operation.environment,
				success: outcome.success,
				state: outcome.resultState,
				message: outcome.success
					? `${request.mode === "validate" ? "Validation" : "Deploy"} completed successfully for ${supported.length} component(s).`
					: (outcome.message ?? operation.message),
				skipped: operation.skipped,
				failed,
				rawResult: finalPayload,
			};
			operation.message = operation.result.message;
		} catch (error) {
			operation.status = operation.cancelRequested ? "canceled" : "failed";
			operation.percentComplete = 100;
			operation.completedAt = this.now();
			operation.message = operation.cancelRequested
				? "Deploy canceled by user."
				: error instanceof Error
					? redactSecrets(error.message)
					: "Cross-org deploy failed.";
			operation.result = {
				source: request.source,
				target: request.target,
				mode: request.mode,
				environment: operation.environment,
				success: false,
				state: operation.cancelRequested ? "Canceled" : "Failed",
				message: operation.message,
				skipped: operation.skipped,
				failed: [],
			};
		}
	}

	private async resolveOrgEnvironment(username: string): Promise<OrgEnvironment> {
		try {
			const connection = await this.connectionFactory(username);
			const queryResult = (await connection.query(
				"SELECT Id, IsSandbox, TrialExpirationDate FROM Organization",
			)) as {
				records?: Array<{ IsSandbox?: boolean; TrialExpirationDate?: string | null }>;
			};
			const record = queryResult.records?.[0];
			if (!record) return "unknown";
			if (record.TrialExpirationDate) return "scratch";
			return record.IsSandbox ? "sandbox" : "production";
		} catch {
			return "unknown";
		}
	}

	private pruneExpiredOperations() {
		const now = this.now();
		for (const [operationId, operation] of this.operations.entries()) {
			if (operation.completedAt && now - operation.completedAt > this.completedOperationTtlMs) {
				this.operations.delete(operationId);
			}
		}
		for (const [operationId, operation] of this.crossOrgOperations.entries()) {
			if (operation.completedAt && now - operation.completedAt > this.completedOperationTtlMs) {
				this.crossOrgOperations.delete(operationId);
			}
		}
	}
}

async function buildCrossOrgDeployZip(
	sourceConnection: RetrieveConnection,
	components: HitListComponentInput[],
) {
	const outputZip = new JSZip();
	const apiVersion = sourceConnection.getApiVersion();
	const byType = new Map<string, string[]>();
	configureRetrievePolling(sourceConnection);

	const componentYieldMs = resolveRetrieveComponentYieldMs();
	for (let index = 0; index < components.length; index += 1) {
		const component = components[index];
		const locator = sourceConnection.metadata.retrieve({
			apiVersion,
			unpackaged: {
				types: [{ name: component.metadataType, members: [component.fullName] }],
				version: apiVersion,
			},
		});
		const result = await completeRetrieveLocator(locator, component);
		if (!result.zipFile) {
			throw new Error(
				`Could not retrieve ${component.metadataType}:${component.fullName} from source org. The component may not exist or may not be retrievable.`,
			);
		}
		const componentZip = await JSZip.loadAsync(Buffer.from(result.zipFile, "base64"));
		for (const [fileName, file] of Object.entries(componentZip.files)) {
			if (file.dir || fileName === "package.xml") continue;
			const normalizedFileName = normalizeRetrievedDeployPath(fileName);
			const nextSource = await file.async("nodebuffer");
			const existing = outputZip.file(normalizedFileName);
			if (!existing) {
				outputZip.file(normalizedFileName, nextSource);
				continue;
			}

			const existingSource = await existing.async("nodebuffer");
			if (
				shouldKeepExistingDeployFile(
					normalizedFileName,
					existingSource.toString("utf8"),
					nextSource.toString("utf8"),
				)
			) {
				continue;
			}
			outputZip.file(normalizedFileName, nextSource);
		}
		const members = byType.get(component.metadataType) ?? [];
		members.push(component.fullName);
		byType.set(component.metadataType, members);
		if (componentYieldMs > 0 && index < components.length - 1) {
			await defaultSleep(componentYieldMs);
		}
	}

	outputZip.file("package.xml", buildPackageXmlFromTypes(byType, apiVersion));
	return outputZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function configureRetrievePolling(sourceConnection: RetrieveConnection) {
	const configuredTimeout = Number(process.env.MAVMETA_RETRIEVE_POLL_TIMEOUT_MS);
	const configuredInterval = Number(process.env.MAVMETA_RETRIEVE_POLL_INTERVAL_MS);

	sourceConnection.metadata.pollTimeout =
		Number.isFinite(configuredTimeout) && configuredTimeout > 0
			? configuredTimeout
			: DEFAULT_RETRIEVE_POLL_TIMEOUT_MS;
	sourceConnection.metadata.pollInterval =
		Number.isFinite(configuredInterval) && configuredInterval > 0
			? configuredInterval
			: DEFAULT_RETRIEVE_POLL_INTERVAL_MS;
}

function resolveRetrieveComponentYieldMs() {
	const configured = Number(process.env.MAVMETA_RETRIEVE_COMPONENT_YIELD_MS);
	if (Number.isFinite(configured) && configured >= 0) return configured;
	return process.env.NODE_ENV === "test" ? 0 : RETRIEVE_COMPONENT_YIELD_MS;
}

async function completeRetrieveLocator(
	locator: {
		complete(): Promise<{ zipFile?: string }>;
		on?(event: "error", listener: (error: Error) => void): unknown;
		off?(event: "error", listener: (error: Error) => void): unknown;
		removeListener?(event: "error", listener: (error: Error) => void): unknown;
	},
	component: HitListComponentInput,
) {
	let emittedError: Error | undefined;
	const errorListener = (error: Error) => {
		emittedError = error;
	};

	locator.on?.("error", errorListener);
	try {
		return await locator.complete();
	} catch (error) {
		const resolvedError =
			error instanceof Error
				? error
				: (emittedError ??
					new Error(
						`Unknown retrieve failure for ${component.metadataType}:${component.fullName}.`,
					));
		throw new Error(
			`Source retrieve failed for ${component.metadataType}:${component.fullName}: ${redactSecrets(resolvedError.message)}`,
		);
	} finally {
		if (locator.off) {
			locator.off("error", errorListener);
		} else {
			locator.removeListener?.("error", errorListener);
		}
	}
}

async function createConnection(username: string): Promise<DeployConnection> {
	const org = await Org.create({ aliasOrUsername: username });
	const connection = org.getConnection() as Connection;
	return connection as unknown as DeployConnection;
}

async function defaultSleep(milliseconds: number) {
	await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeComponents(components: HitListComponentInput[]) {
	return components.map((component) => ({
		metadataType: component.metadataType.trim(),
		fullName: component.fullName.trim(),
	}));
}

function partitionSupportedComponents(components: HitListComponentInput[]) {
	const supported: HitListComponentInput[] = [];
	const skipped: DeploySkippedComponent[] = [];
	for (const component of components) {
		if (!component.metadataType || !component.fullName) {
			skipped.push({
				metadataType: component.metadataType,
				fullName: component.fullName,
				reason: "Missing metadata type or full name.",
			});
			continue;
		}
		if (!validateMetadataName(component.fullName)) {
			skipped.push({
				metadataType: component.metadataType,
				fullName: component.fullName,
				reason: "Invalid metadata full name.",
			});
			continue;
		}
		const compatibilityIssue = getDestructiveCompatibilityIssue(component.metadataType);
		if (compatibilityIssue) {
			skipped.push({
				metadataType: component.metadataType,
				fullName: component.fullName,
				reason: compatibilityIssue,
			});
			continue;
		}
		supported.push(component);
	}
	return [supported, skipped] as const;
}

async function buildMetadataDeployZip(components: HitListComponentInput[]) {
	const zip = new JSZip();
	zip.file("package.xml", buildPackageXml());
	zip.file("destructiveChanges.xml", buildDestructiveXml(components));
	return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function buildPackageXml() {
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
		"  <version>66.0</version>",
		"</Package>",
	].join("\n");
}

function buildPackageXmlFromTypes(byType: Map<string, string[]>, apiVersion: string) {
	const typeBlocks = Array.from(byType.entries())
		.sort((left, right) => left[0].localeCompare(right[0]))
		.map(([metadataType, members]) => {
			const lines = members
				.sort((left, right) => left.localeCompare(right))
				.map((member) => `    <members>${xmlEscape(member)}</members>`)
				.join("\n");
			return `  <types>\n${lines}\n    <name>${xmlEscape(metadataType)}</name>\n  </types>`;
		})
		.join("\n");
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
		typeBlocks,
		`  <version>${xmlEscape(apiVersion)}</version>`,
		"</Package>",
	].join("\n");
}

function buildDestructiveXml(components: HitListComponentInput[]) {
	const byType = new Map<string, string[]>();
	for (const component of components) {
		const entries = byType.get(component.metadataType) ?? [];
		entries.push(component.fullName);
		byType.set(component.metadataType, entries);
	}

	const typeBlocks = Array.from(byType.entries())
		.sort((left, right) => left[0].localeCompare(right[0]))
		.map(([metadataType, members]) => {
			const lines = members
				.sort((left, right) => left.localeCompare(right))
				.map((member) => `    <members>${xmlEscape(member)}</members>`)
				.join("\n");
			return `  <types>\n${lines}\n    <name>${xmlEscape(metadataType)}</name>\n  </types>`;
		})
		.join("\n");

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
		typeBlocks,
		"  <version>66.0</version>",
		"</Package>",
	].join("\n");
}

function xmlEscape(value: string) {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function isCompletedStatus(status: DeployOperation["status"] | CrossOrgDeployOperation["status"]) {
	return status === "succeeded" || status === "failed" || status === "canceled";
}

function toObject(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

function unwrapDeployResult(value: unknown): Record<string, unknown> {
	const objectValue = toObject(value);
	if (!objectValue) return {};
	const nestedResult = toObject(objectValue.result);
	return nestedResult ?? objectValue;
}

async function readDeployStartPayload(value: unknown) {
	const record = toObject(value);
	if (!record) return undefined;
	const checkCandidate = record.check;
	if (typeof checkCandidate === "function") {
		const checkResult = await (checkCandidate as () => Promise<unknown>)();
		return unwrapDeployResult(checkResult);
	}
	return unwrapDeployResult(record);
}

function readJobId(result: unknown): string | undefined {
	const record = toObject(result);
	if (!record) return undefined;
	const directCandidates = [record.id, record.jobId, record.asyncId, record.deployId];
	for (const candidate of directCandidates) {
		if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
	}
	for (const [key, fieldValue] of Object.entries(record)) {
		if (
			typeof fieldValue === "string" &&
			(key.toLowerCase().includes("id") || key.toLowerCase().includes("job")) &&
			fieldValue.trim()
		) {
			return fieldValue.trim();
		}
	}
	for (const nestedValue of Object.values(record)) {
		if (Array.isArray(nestedValue)) {
			for (const nestedItem of nestedValue) {
				const found = readJobId(nestedItem);
				if (found) return found;
			}
			continue;
		}
		const found = readJobId(nestedValue);
		if (found) return found;
	}
	return undefined;
}

function readProgress(rawResult: Record<string, unknown>) {
	const state = readStatusString(rawResult);
	const total = readNumberField(rawResult, "numberComponentsTotal");
	const deployed = readNumberField(rawResult, "numberComponentsDeployed");
	const errors = readNumberField(rawResult, "numberComponentErrors");
	const processed = Math.max(0, deployed + errors);
	const percentComplete =
		total > 0
			? isTerminalState(state)
				? 100
				: Math.min(99, Math.round((processed / total) * 100))
			: isTerminalState(state)
				? 100
				: 0;
	return {
		state,
		processed,
		total,
		percentComplete,
		isTerminal: isTerminalState(state),
		message: `${state} ${percentComplete}% (${processed}/${total || 0} components processed)`,
	};
}

function readStatusString(rawResult: Record<string, unknown>) {
	const status = rawResult.status;
	return typeof status === "string" && status.trim() ? status.trim() : "InProgress";
}

function readNumberField(rawResult: Record<string, unknown>, field: string) {
	const value = rawResult[field];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isTerminalState(state: string) {
	return (
		state === "Succeeded" ||
		state === "SucceededPartial" ||
		state === "Failed" ||
		state === "Canceled" ||
		state === "Canceling" ||
		state === "FinalizingDeployFailed"
	);
}

function resolveDeployOutcome(
	state: string,
	rawResult: Record<string, unknown>,
	failed: DeployFailedComponent[],
) {
	const successField = rawResult.success;
	const successFromPayload = typeof successField === "boolean" ? successField : undefined;
	if (state === "Succeeded")
		return {
			success: true,
			status: "succeeded" as const,
			resultState: "Succeeded" as const,
			message: undefined,
		};
	if (state === "Canceled" || state === "Canceling")
		return {
			success: false,
			status: "canceled" as const,
			resultState: "Canceled" as const,
			message: "Deploy canceled by user.",
		};
	if (state === "SucceededPartial") {
		const summary = failed.length
			? `Deploy completed with partial failures (${failed.length} component failure${failed.length === 1 ? "" : "s"}).`
			: "Deploy completed with partial failures.";
		return {
			success: false,
			status: "failed" as const,
			resultState: "PartiallySucceeded" as const,
			message: summary,
		};
	}
	if (successFromPayload === true)
		return {
			success: true,
			status: "succeeded" as const,
			resultState: "Succeeded" as const,
			message: undefined,
		};
	return {
		success: false,
		status: "failed" as const,
		resultState: "Failed" as const,
		message: undefined,
	};
}

function extractFailedComponents(rawResult: Record<string, unknown>): DeployFailedComponent[] {
	const details = toObject(rawResult.details);
	if (!details) return [];
	const componentFailures = details.componentFailures;
	const failures = Array.isArray(componentFailures)
		? componentFailures
		: componentFailures
			? [componentFailures]
			: [];
	return failures
		.map((failure) => {
			const failureRecord = toObject(failure);
			if (!failureRecord) return undefined;
			const metadataType = stringOrEmpty(failureRecord.componentType);
			const fullName = stringOrEmpty(failureRecord.fullName);
			const problem = stringOrEmpty(failureRecord.problem) || "Deploy failure.";
			if (!metadataType || !fullName) return undefined;
			const normalized: DeployFailedComponent = { metadataType, fullName, problem };
			return normalized;
		})
		.filter((failure): failure is DeployFailedComponent => failure !== undefined);
}

function stringOrEmpty(value: unknown) {
	return typeof value === "string" ? value.trim() : "";
}

function summarizeResultShape(result: unknown) {
	const record = toObject(result);
	if (!record) return "Start result payload was empty.";
	const keys = Object.keys(record);
	if (!keys.length) return "Start result payload had no keys.";
	return `Start result keys: ${keys.join(", ")}.`;
}

function normalizeRetrievedDeployPath(fileName: string) {
	const normalized = fileName.startsWith("unpackaged/")
		? fileName.slice("unpackaged/".length)
		: fileName;
	const sanitized = normalized.replaceAll("\\", "/");
	if (sanitized.startsWith("/") || sanitized.includes("\0")) {
		throw new Error(`Unsafe retrieved path: ${fileName}`);
	}
	const rawSegments = sanitized.split("/");
	if (rawSegments.some((segment) => segment === "..")) {
		throw new Error(`Unsafe retrieved path: ${fileName}`);
	}
	const normalizedPosix = path.posix.normalize(sanitized);
	if (normalizedPosix.startsWith("../") || normalizedPosix === "..") {
		throw new Error(`Unsafe retrieved path: ${fileName}`);
	}
	return normalizedPosix;
}

function shouldKeepExistingDeployFile(
	fileName: string,
	existingSource: string,
	nextSource: string,
) {
	const isCustomObjectMetadataFile =
		fileName.endsWith(".object") || fileName.endsWith(".object-meta.xml");
	if (!isCustomObjectMetadataFile) {
		return false;
	}

	const existingHasLabel = hasTopLevelCustomObjectLabel(existingSource);
	const nextHasLabel = hasTopLevelCustomObjectLabel(nextSource);
	if (existingHasLabel && !nextHasLabel) {
		return true;
	}

	// Prefer richer object payload when both include labels.
	return existingHasLabel && nextHasLabel && existingSource.length >= nextSource.length;
}

function hasTopLevelCustomObjectLabel(source: string) {
	const labelIndex = source.indexOf("<label>");
	if (labelIndex < 0) return false;
	const fieldsIndex = source.indexOf("<fields>");
	return fieldsIndex < 0 || labelIndex < fieldsIndex;
}
