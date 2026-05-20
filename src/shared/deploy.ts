import type { OrgEnvironment, OrgTarget } from "./org";

export type HitListComponentInput = {
	metadataType: string;
	fullName: string;
};

export type DestructiveDeployMode = "validate" | "deploy";

export type StartDestructiveDeployRequest = {
	target: OrgTarget;
	mode: DestructiveDeployMode;
	components: HitListComponentInput[];
};

export type StartDestructiveDeployResponse = {
	operationId: string;
};

export type DestructiveDeployStatusRequest = {
	operationId: string;
};

export type DeploySkippedComponent = HitListComponentInput & {
	reason: string;
};

export type DeployFailedComponent = HitListComponentInput & {
	problem: string;
};

export type DestructiveDeployResult = {
	target: OrgTarget;
	mode: DestructiveDeployMode;
	environment: OrgEnvironment;
	success: boolean;
	state: "Succeeded" | "PartiallySucceeded" | "Failed" | "Canceled";
	message: string;
	skipped: DeploySkippedComponent[];
	failed: DeployFailedComponent[];
	rawResult?: Record<string, unknown>;
};

export type DestructiveDeployStatusResponse = {
	operationId: string;
	status: "pending" | "running" | "succeeded" | "failed" | "canceled";
	percentComplete: number;
	message: string;
	deployState?: string;
	componentsProcessed?: number;
	componentsTotal?: number;
	result?: DestructiveDeployResult;
};

export type CancelDestructiveDeployRequest = {
	operationId: string;
};

export type CancelDestructiveDeployResponse = {
	operationId: string;
	canceled: boolean;
	message: string;
};

export type CancelDeployResponse = {
	operationId: string;
	canceled: boolean;
	message: string;
};

export type CrossOrgDeployMode = "validate" | "deploy";

export type StartCrossOrgDeployRequest = {
	source: OrgTarget;
	target: OrgTarget;
	mode: CrossOrgDeployMode;
	components: HitListComponentInput[];
};

export type StartCrossOrgDeployResponse = {
	operationId: string;
};

export type CrossOrgDeployStatusRequest = {
	operationId: string;
};

export type CrossOrgDeployResult = {
	source: OrgTarget;
	target: OrgTarget;
	mode: CrossOrgDeployMode;
	environment: OrgEnvironment;
	success: boolean;
	state: "Succeeded" | "PartiallySucceeded" | "Failed" | "Canceled";
	message: string;
	skipped: DeploySkippedComponent[];
	failed: DeployFailedComponent[];
	rawResult?: Record<string, unknown>;
};

export type CrossOrgDeployStatusResponse = {
	operationId: string;
	status: "pending" | "running" | "succeeded" | "failed" | "canceled";
	percentComplete: number;
	message: string;
	deployState?: string;
	componentsProcessed?: number;
	componentsTotal?: number;
	result?: CrossOrgDeployResult;
};

export type CancelCrossOrgDeployRequest = {
	operationId: string;
};

export type CancelCrossOrgDeployResponse = {
	operationId: string;
	canceled: boolean;
	message: string;
};
