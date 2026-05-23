import { Org } from "@salesforce/core";

import {
	OBJECT_CHILD_METADATA_TYPES,
	type ChildMetadataItem,
	type ListObjectChildrenRequest,
	type ListObjectChildrenResponse,
	type ListObjectsRequest,
	type ListObjectsResponse,
	type ObjectSummary,
	type ObjectType,
} from "../shared/object-explorer";

type SalesforceListMetadataQuery = {
	type: string;
	folder?: string;
};

type JsforceConnection = {
	getApiVersion(): string;
	metadata: {
		list(queries: SalesforceListMetadataQuery[], apiVersion: string): Promise<unknown>;
	};
};

type SalesforceFileProperties = {
	fullName?: string;
	type?: string;
	label?: string;
	namespacePrefix?: string;
	manageableState?: string;
	lastModifiedByName?: string;
	lastModifiedDate?: string;
};

export type ObjectExplorerServiceApi = {
	listObjects(request: ListObjectsRequest): Promise<ListObjectsResponse>;
	listObjectChildren(request: ListObjectChildrenRequest): Promise<ListObjectChildrenResponse>;
};

export class ObjectExplorerService implements ObjectExplorerServiceApi {
	async listObjects(request: ListObjectsRequest): Promise<ListObjectsResponse> {
		const connection = await this.getConnection(request.target.username);
		const apiVersion = connection.getApiVersion();
		const records = toArray(await connection.metadata.list([{ type: "CustomObject" }], apiVersion));

		const objects: ObjectSummary[] = records
			.map(toObjectSummary)
			.filter((obj): obj is ObjectSummary => obj !== undefined)
			.sort((left, right) => left.label.localeCompare(right.label));

		return { target: request.target, objects };
	}

	async listObjectChildren(
		request: ListObjectChildrenRequest,
	): Promise<ListObjectChildrenResponse> {
		const connection = await this.getConnection(request.target.username);
		const apiVersion = connection.getApiVersion();

		const results = await Promise.allSettled(
			OBJECT_CHILD_METADATA_TYPES.map(async (childType) => {
				const records = toArray(
					await connection.metadata.list(
						[{ type: childType, folder: request.objectApiName }],
						apiVersion,
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

	private async getConnection(username: string): Promise<JsforceConnection> {
		const org = await Org.create({ aliasOrUsername: username });
		return org.getConnection() as JsforceConnection;
	}
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

function deriveChildApiName(fullName: string): string {
	const dotIndex = fullName.indexOf(".");
	return dotIndex >= 0 ? fullName.slice(dotIndex + 1) : fullName;
}

function deriveParentFromFullName(fullName: string): string | undefined {
	const dotIndex = fullName.indexOf(".");
	return dotIndex > 0 ? fullName.slice(0, dotIndex) : undefined;
}

function deriveObjectType(apiName: string): ObjectType {
	if (apiName.endsWith("__mdt")) return "customMetadata";
	if (apiName.endsWith("__e")) return "platformEvent";
	if (apiName.endsWith("__c")) return "custom";
	return "standard";
}

function toObjectLabel(apiName: string): string {
	return apiName
		.replace(/__c$/, "")
		.replace(/__e$/, "")
		.replace(/__mdt$/, "")
		.replace(/_/g, " ")
		.trim();
}

function readStringField(
	record: Record<string, unknown>,
	fieldName: keyof SalesforceFileProperties,
): string | undefined {
	const value = record[fieldName];
	return typeof value === "string" && value.trim() ? value : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toArray(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	return value === undefined || value === null ? [] : [value];
}
