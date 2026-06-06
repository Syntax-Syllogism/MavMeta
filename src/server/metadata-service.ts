import path from "node:path";
import { Org } from "@salesforce/core";
import { ApiError } from "./api-error";
import { redactSecrets } from "./redact-secrets";

import type {
	CrossOrgDiffRequest,
	CrossOrgDiffResponse,
	DiffComponentState,
	ListMetadataComponentsRequest,
	ListMetadataComponentsResponse,
	ListMetadataTypesRequest,
	ListMetadataTypesResponse,
	MetadataComponentSummary,
	MetadataTypeSummary,
	GetComponentSourceRequest,
	GetComponentSourceResponse,
} from "../shared/metadata";

const MAX_CACHE_ENTRIES = 50;

type CacheEntry = { source: string; truncated: boolean };

type SalesforceMetadataObject = {
	xmlName?: string;
	directoryName?: string;
	suffix?: string;
	childXmlNames?: string | string[];
	inFolder?: boolean;
	metaFile?: boolean;
};

type SalesforceDescribeMetadataResult = {
	metadataObjects?: SalesforceMetadataObject[];
};

type SalesforceListMetadataQuery = {
	type: string;
	folder?: string;
};

type JsforceRetrieveLocator = {
	complete(): Promise<{ zipFile?: string }>;
};

type JsforceConnection = {
	getApiVersion(): string;
	metadata: {
		describe(apiVersion: string): Promise<unknown>;
		list(queries: SalesforceListMetadataQuery[], apiVersion: string): Promise<unknown>;
		read(type: string, fullNames: string[]): Promise<unknown>;
		retrieve(request: {
			apiVersion: string | number;
			unpackaged: { types: Array<{ name: string; members: string[] }>; version: string | number };
		}): JsforceRetrieveLocator;
	};
};

type SalesforceFileProperties = {
	fullName?: string;
	type?: string;
	id?: string;
	fileName?: string;
	folder?: string;
	parentName?: string;
	namespacePrefix?: string;
	manageableState?: string;
	label?: string;
	developerName?: string;
	createdByName?: string;
	createdDate?: string;
	lastModifiedByName?: string;
	lastModifiedDate?: string;
};

export type MetadataServiceApi = {
	listMetadataTypes(request: ListMetadataTypesRequest): Promise<ListMetadataTypesResponse>;
	listMetadataComponents(
		request: ListMetadataComponentsRequest,
	): Promise<ListMetadataComponentsResponse>;
	getComponentSource(request: GetComponentSourceRequest): Promise<GetComponentSourceResponse>;
	getCrossOrgComponentDiff(request: CrossOrgDiffRequest): Promise<CrossOrgDiffResponse>;
};

export class MetadataService implements MetadataServiceApi {
	private componentSourceCache = new Map<string, CacheEntry>();

	async listMetadataTypes(request: ListMetadataTypesRequest): Promise<ListMetadataTypesResponse> {
		const connection = await this.getConnection(request.target.username);
		const apiVersion = connection.getApiVersion();
		const describeResult = (await connection.metadata.describe(
			apiVersion,
		)) as SalesforceDescribeMetadataResult;

		return {
			target: request.target,
			apiVersion,
			types: toMetadataTypes(describeResult),
		};
	}

	async listMetadataComponents(
		request: ListMetadataComponentsRequest,
	): Promise<ListMetadataComponentsResponse> {
		const connection = await this.getConnection(request.target.username);
		const apiVersion = connection.getApiVersion();
		const componentsRaw = await this.listMetadataRecords(request, connection, apiVersion);
		const normalizedSearch = request.search?.trim().toLowerCase();
		const components = componentsRaw
			.map((record) => toMetadataComponentSummary(record, request.metadataType))
			.filter((component): component is MetadataComponentSummary => component !== undefined)
			.filter((component) => matchesMetadataComponentSearch(component, normalizedSearch))
			.sort(compareMetadataComponents);

		return {
			target: request.target,
			metadataType: request.metadataType,
			apiVersion,
			components,
			errors: [],
		};
	}

	private async getConnection(username: string): Promise<JsforceConnection> {
		const org = await Org.create({ aliasOrUsername: username });
		return org.getConnection() as unknown as JsforceConnection;
	}

	private async listMetadataRecords(
		request: ListMetadataComponentsRequest,
		connection: JsforceConnection,
		apiVersion: string,
	): Promise<unknown[]> {
		if (request.folder) {
			return toArray(
				await connection.metadata.list(
					[{ type: request.metadataType, folder: request.folder }],
					apiVersion,
				),
			);
		}

		const folderType = getFolderMetadataType(request.metadataType);
		if (!folderType) {
			return toArray(await connection.metadata.list([{ type: request.metadataType }], apiVersion));
		}

		const folderRecords = toArray(
			await connection.metadata.list([{ type: folderType }], apiVersion),
		);
		const folderNames = folderRecords
			.map((record) => readStringField(record, "fullName"))
			.filter((folder): folder is string => folder !== undefined);
		const grouped = await Promise.all(
			folderNames.map((folder) =>
				connection.metadata.list([{ type: request.metadataType, folder }], apiVersion),
			),
		);

		return grouped.flatMap((value) => toArray(value));
	}

	async getComponentSource(
		request: GetComponentSourceRequest,
	): Promise<GetComponentSourceResponse> {
		const cacheKey = `${request.target.username}:${request.metadataType}:${request.fullName}`;
		const cached = this.componentSourceCache.get(cacheKey);
		if (cached) {
			return {
				target: request.target,
				metadataType: request.metadataType,
				fullName: request.fullName,
				source: cached.source,
				truncated: cached.truncated,
			};
		}

		try {
			const org = await Org.create({ aliasOrUsername: request.target.username });
			const connection = org.getConnection() as unknown as JsforceConnection;
			const apiVersion = connection.getApiVersion();

			const xmlContent = await this.retrieveInMemory(
				connection,
				request.metadataType,
				request.fullName,
				apiVersion,
			);

			const lines = xmlContent.split("\n");
			const truncated = lines.length > 1000;
			const source = truncated ? lines.slice(0, 1000).join("\n") + "\n... (truncated)" : xmlContent;

			if (this.componentSourceCache.size >= MAX_CACHE_ENTRIES) {
				const firstKey = this.componentSourceCache.keys().next().value;
				if (firstKey !== undefined) {
					this.componentSourceCache.delete(firstKey);
				}
			}
			this.componentSourceCache.set(cacheKey, { source, truncated });

			return {
				target: request.target,
				metadataType: request.metadataType,
				fullName: request.fullName,
				source,
				truncated,
				apiVersion,
			};
		} catch (error) {
			return {
				target: request.target,
				metadataType: request.metadataType,
				fullName: request.fullName,
				error: {
					message: error instanceof Error ? redactSecrets(error.message) : "Unknown error",
					scope: "component-source",
				},
			};
		}
	}

	async getCrossOrgComponentDiff(request: CrossOrgDiffRequest): Promise<CrossOrgDiffResponse> {
		const sourceUsername = request.source.username;
		const targetUsername = request.target.username;

		if (sourceUsername === targetUsername) {
			throw new ApiError(
				400,
				"INVALID_REQUEST",
				"Source and target orgs must be different for metadata diff.",
			);
		}

		await this.requireAuthenticatedOrg(sourceUsername, "Source");
		await this.requireAuthenticatedOrg(targetUsername, "Target");

		const results = await Promise.all(
			request.components.map(async (component) => {
				const sourceResponse = await this.getComponentSource({
					target: request.source,
					metadataType: component.metadataType,
					fullName: component.fullName,
					fileName: component.fileName,
					folder: component.folder,
				});
				const targetResponse = await this.getComponentSource({
					target: request.target,
					metadataType: component.metadataType,
					fullName: component.fullName,
					fileName: component.fileName,
					folder: component.folder,
				});

				const sourceXml = sourceResponse.source;
				const targetXml = targetResponse.source;
				const state = resolveDiffState(sourceResponse, targetResponse);

				return {
					metadataType: component.metadataType,
					fullName: component.fullName,
					fileName: component.fileName,
					state,
					sourceXml,
					targetXml,
					message: sourceResponse.error?.message ?? targetResponse.error?.message,
				};
			}),
		);

		return { source: request.source, target: request.target, results };
	}

	private async requireAuthenticatedOrg(username: string, orgRole: "Source" | "Target") {
		try {
			await this.getConnection(username);
		} catch {
			throw new ApiError(
				400,
				"ORG_NOT_AUTHENTICATED",
				`${orgRole} org is no longer authenticated. Re-authenticate it before comparing or deploying.`,
			);
		}
	}

	private async retrieveInMemory(
		connection: JsforceConnection,
		metadataType: string,
		fullName: string,
		apiVersion: string,
	): Promise<string> {
		try {
			const locator = connection.metadata.retrieve({
				apiVersion,
				unpackaged: { types: [{ name: metadataType, members: [fullName] }], version: apiVersion },
			});
			const status = await locator.complete();
			if (status.zipFile) {
				const extracted = await this.extractFromZipBuffer(
					Buffer.from(status.zipFile, "base64"),
					fullName,
				);
				if (extracted) {
					return extracted;
				}
			}
		} catch (e) {
			const errorMessage = e instanceof Error ? e.message : String(e);
			console.warn(
				`In-memory retrieve failed for ${metadataType}/${fullName}, falling back to metadata.read: ${redactSecrets(errorMessage)}`,
			);
		}

		return this.readAndSerialize(connection, metadataType, fullName);
	}

	private async extractFromZipBuffer(
		zipBuffer: Buffer,
		fullName: string,
	): Promise<string | undefined> {
		const JSZip = await import("jszip");
		const zip = await JSZip.default.loadAsync(zipBuffer);
		const baseName = fullName.includes("/") ? fullName.split("/").pop()! : fullName;
		const matchingFile = Object.keys(zip.files).find(
			(name) => !zip.files[name].dir && isSafeZipEntryPath(name) && name.includes(baseName),
		);
		if (matchingFile) {
			return zip.files[matchingFile].async("string");
		}
		return undefined;
	}

	private async readAndSerialize(
		connection: JsforceConnection,
		metadataType: string,
		fullName: string,
	): Promise<string> {
		const unsupportedTypes = ["ApexClass", "ApexTrigger", "ApexComponent", "ApexPage"];
		if (!unsupportedTypes.includes(metadataType)) {
			try {
				const result = await connection.metadata.read(metadataType, [fullName]);
				const record = Array.isArray(result) ? result[0] : result;
				if (record && typeof record === "object" && Object.keys(record as object).length > 0) {
					return this.serializeToXml(metadataType, record);
				}
			} catch {
				// fall through to empty serialization
			}
		}
		return this.serializeToXml(metadataType, undefined);
	}

	private serializeToXml(
		metadataType: string,
		metadata: Record<string, unknown> | undefined,
	): string {
		// Simple XML serialization fallback
		const header = '<?xml version="1.0" encoding="UTF-8"?>\n';
		const rootStart = `<${metadataType} xmlns="http://soap.sforce.com/2006/04/metadata">\n`;
		const rootEnd = `</${metadataType}>`;

		const body = this.objectToXml(metadata, 1);
		return header + rootStart + body + rootEnd;
	}

	private objectToXml(obj: unknown, indent: number): string {
		let xml = "";
		const padding = "    ".repeat(indent);
		if (!isObjectRecord(obj)) {
			return xml;
		}

		for (const [key, value] of Object.entries(obj)) {
			if (key === "$" || key === "@" || key === "xmlns") continue;

			if (value === null || value === undefined) continue;

			if (Array.isArray(value)) {
				for (const item of value) {
					xml += `${padding}<${key}>\n${this.objectToXml(item, indent + 1)}${padding}</${key}>\n`;
				}
			} else if (typeof value === "object") {
				xml += `${padding}<${key}>\n${this.objectToXml(value, indent + 1)}${padding}</${key}>\n`;
			} else {
				xml += `${padding}<${key}>${this.escapeXml(String(value))}</${key}>\n`;
			}
		}

		return xml;
	}

	private escapeXml(unsafe: string): string {
		return unsafe.replace(/[<>&"']/g, (c) => {
			switch (c) {
				case "<":
					return "&lt;";
				case ">":
					return "&gt;";
				case "&":
					return "&amp;";
				case '"':
					return "&quot;";
				case "'":
					return "&apos;";
				default:
					return c;
			}
		});
	}
}

function getFolderMetadataType(metadataType: string): string | undefined {
	const folderTypes: Record<string, string> = {
		Dashboard: "DashboardFolder",
		Document: "DocumentFolder",
		EmailTemplate: "EmailFolder",
		Report: "ReportFolder",
	};

	return folderTypes[metadataType];
}

function toMetadataTypes(describeResult: SalesforceDescribeMetadataResult): MetadataTypeSummary[] {
	return (describeResult.metadataObjects ?? [])
		.filter(hasXmlName)
		.map((metadataObject) => ({
			xmlName: metadataObject.xmlName,
			label: toTypeLabel(metadataObject.xmlName),
			directoryName: metadataObject.directoryName,
			suffix: metadataObject.suffix,
			childXmlNames: toChildXmlNames(metadataObject.childXmlNames),
			inFolder: metadataObject.inFolder ?? false,
			metaFile: metadataObject.metaFile ?? false,
		}))
		.sort((left, right) => left.label.localeCompare(right.label));
}

function toMetadataComponentSummary(
	record: unknown,
	defaultType: string,
): MetadataComponentSummary | undefined {
	if (!isObjectRecord(record)) {
		return undefined;
	}

	const fullName = readStringField(record, "fullName");
	if (!fullName) {
		return undefined;
	}

	return {
		fullName,
		type: readStringField(record, "type") ?? defaultType,
		id: readStringField(record, "id"),
		fileName: readStringField(record, "fileName"),
		folder: readStringField(record, "folder") ?? deriveFolder(fullName),
		parentName: readStringField(record, "parentName") ?? deriveParentName(fullName),
		namespacePrefix: readStringField(record, "namespacePrefix"),
		manageableState: readStringField(record, "manageableState"),
		label: readStringField(record, "label"),
		developerName: readStringField(record, "developerName"),
		createdByName: readStringField(record, "createdByName"),
		createdDate: readStringField(record, "createdDate"),
		lastModifiedByName: readStringField(record, "lastModifiedByName"),
		lastModifiedDate: readStringField(record, "lastModifiedDate"),
		raw: record,
	};
}

function matchesMetadataComponentSearch(
	component: MetadataComponentSummary,
	normalizedSearch: string | undefined,
): boolean {
	if (!normalizedSearch) {
		return true;
	}

	return [
		component.fullName,
		component.label,
		component.developerName,
		component.fileName,
		component.folder,
		component.parentName,
		component.namespacePrefix,
	]
		.filter((value): value is string => value !== undefined)
		.some((value) => value.toLowerCase().includes(normalizedSearch));
}

function deriveFolder(fullName: string): string | undefined {
	const slashIndex = fullName.indexOf("/");
	return slashIndex > 0 ? fullName.slice(0, slashIndex) : undefined;
}

function deriveParentName(fullName: string): string | undefined {
	const dotIndex = fullName.indexOf(".");
	return dotIndex > 0 ? fullName.slice(0, dotIndex) : undefined;
}

function compareMetadataComponents(
	left: MetadataComponentSummary,
	right: MetadataComponentSummary,
) {
	const leftTimestamp = toTimestamp(left.lastModifiedDate);
	const rightTimestamp = toTimestamp(right.lastModifiedDate);

	if (leftTimestamp !== rightTimestamp) {
		return rightTimestamp - leftTimestamp;
	}

	return left.fullName.localeCompare(right.fullName);
}

function toTimestamp(value: string | undefined) {
	if (!value) {
		return Number.NEGATIVE_INFINITY;
	}

	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function readStringField(record: unknown, fieldName: keyof SalesforceFileProperties) {
	if (!isObjectRecord(record)) {
		return undefined;
	}

	const value = record[fieldName];
	return typeof value === "string" && value.trim() ? value : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeZipEntryPath(entryPath: string) {
	const sanitized = entryPath.replaceAll("\\", "/");
	if (sanitized.startsWith("/") || sanitized.includes("\0")) {
		return false;
	}
	if (sanitized.split("/").some((segment) => segment === "..")) {
		return false;
	}
	const normalized = path.posix.normalize(sanitized);
	if (normalized.startsWith("../") || normalized === "..") {
		return false;
	}
	return !normalized.split("/").some((segment) => segment === "..");
}

function toArray(value: unknown): unknown[] {
	if (Array.isArray(value)) {
		return value;
	}

	return value === undefined || value === null ? [] : [value];
}

function hasXmlName(
	metadataObject: SalesforceMetadataObject,
): metadataObject is SalesforceMetadataObject & { xmlName: string } {
	return typeof metadataObject.xmlName === "string" && metadataObject.xmlName !== "";
}

function toChildXmlNames(childXmlNames: string | string[] | undefined): string[] {
	if (childXmlNames === undefined) {
		return [];
	}

	return Array.isArray(childXmlNames) ? childXmlNames : [childXmlNames];
}

function toTypeLabel(xmlName: string): string {
	return xmlName.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function normalizeXmlForDiff(value: string) {
	return value.replace(/\r\n/g, "\n").trim();
}

function resolveDiffState(
	sourceResponse: GetComponentSourceResponse,
	targetResponse: GetComponentSourceResponse,
): DiffComponentState {
	if (sourceResponse.error) {
		if (isLikelyMissingComponentError(sourceResponse.error.message)) {
			return "MissingInSource";
		}
		if (sourceResponse.error.scope === "component-source") {
			return "Error";
		}
		return "MissingInSource";
	}
	if (targetResponse.error) {
		if (isLikelyMissingComponentError(targetResponse.error.message)) {
			return "MissingInTarget";
		}
		if (targetResponse.error.scope === "component-source") {
			return "Error";
		}
		return "MissingInTarget";
	}
	if (sourceResponse.source === undefined) {
		return "MissingInSource";
	}
	if (targetResponse.source === undefined) {
		return "MissingInTarget";
	}
	return normalizeXmlForDiff(sourceResponse.source) === normalizeXmlForDiff(targetResponse.source)
		? "Same"
		: "Changed";
}

function isLikelyMissingComponentError(message: string) {
	const normalized = message.toLowerCase();
	return normalized.includes("not found") || normalized.includes("does not exist");
}
