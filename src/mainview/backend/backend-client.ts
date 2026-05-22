import type {
	DeployLwcBundleRequest,
	DeployLwcBundleResponse,
	GetLwcBundleRequest,
	GetLwcBundleResponse,
	ListLwcBundlesRequest,
	ListLwcBundlesResponse,
} from "../../shared/lwc";
import type {
	CrossOrgDiffRequest,
	CrossOrgDiffResponse,
	ListMetadataComponentsRequest,
	ListMetadataComponentsResponse,
	ListMetadataTypesRequest,
	ListMetadataTypesResponse,
	GetComponentSourceRequest,
	GetComponentSourceResponse,
} from "../../shared/metadata";
import type {
	ListObjectsRequest,
	ListObjectsResponse,
	ListObjectChildrenRequest,
	ListObjectChildrenResponse,
} from "../../shared/object-explorer";
import type {
	CancelCrossOrgDeployRequest,
	CancelCrossOrgDeployResponse,
	CancelDestructiveDeployRequest,
	CancelDestructiveDeployResponse,
	CrossOrgDeployStatusRequest,
	CrossOrgDeployStatusResponse,
	DestructiveDeployStatusRequest,
	DestructiveDeployStatusResponse,
	StartCrossOrgDeployRequest,
	StartCrossOrgDeployResponse,
	StartDestructiveDeployRequest,
	StartDestructiveDeployResponse,
} from "../../shared/deploy";
import type {
	AuthOrgRequest,
	OrgActionResponse,
	OrgListResponse,
	OrgTarget,
	SetAliasRequest,
} from "../../shared/org";
import type { RestExecuteRequest, RestExecuteResponse } from "../../shared/rest";
import type {
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
} from "../../shared/soql";
import type {
	ListSnapshotsResponse,
	ScratchOrgCreateStatusRequest,
	ScratchOrgCreateStatusResponse,
	StartScratchOrgCreateRequest,
	StartScratchOrgCreateResponse,
} from "../../shared/scratch-org";

const JSON_HEADERS = {
	"content-type": "application/json",
};

type HttpMethod = "GET" | "POST";

let sessionToken: string | undefined;
let sessionTokenPromise: Promise<string> | undefined;

async function requestJson<TResponse>(
	method: HttpMethod,
	path: string,
	body?: unknown,
): Promise<TResponse> {
	const token = await readSessionTokenOrFetch();
	const response = await fetch(path, {
		method,
		headers: {
			...JSON_HEADERS,
			"x-mavmeta-session": token,
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});

	if (!response.ok) {
		const error = await parseError(response);
		throw new Error(error);
	}

	return (await response.json()) as TResponse;
}

async function requestText(
	method: HttpMethod,
	path: string,
): Promise<string> {
	const token = await readSessionTokenOrFetch();
	const response = await fetch(path, {
		method,
		headers: {
			"x-mavmeta-session": token,
		},
	});

	if (!response.ok) {
		const error = await parseError(response);
		throw new Error(error);
	}

	return response.text();
}

async function parseError(response: Response): Promise<string> {
	try {
		const payload = (await response.json()) as { message?: string };
		return payload.message ?? `Request failed (${response.status}).`;
	} catch {
		return `Request failed (${response.status}).`;
	}
}

async function readSessionTokenOrFetch(): Promise<string> {
	if (sessionToken) {
		return sessionToken;
	}
	const metaToken = readSessionTokenFromMeta();
	if (metaToken) {
		sessionToken = metaToken;
		return metaToken;
	}
	if (!sessionTokenPromise) {
		sessionTokenPromise = fetchSessionTokenForDevBootstrap().finally(() => {
			sessionTokenPromise = undefined;
		});
	}
	return sessionTokenPromise;
}

function readSessionTokenFromMeta(): string | undefined {
	const meta = document.querySelector('meta[name="MavMeta-session"]');
	return meta?.getAttribute("content")?.trim() || undefined;
}

async function fetchSessionTokenForDevBootstrap(): Promise<string> {
	const response = await fetch("/api/session", {
		method: "GET",
		headers: {
			"x-mavmeta-bootstrap": "1",
		},
	});
	if (!response.ok) {
		throw new Error(
			'Missing required session token meta tag "MavMeta-session". Start MavMeta via the backend entrypoint (for example `npm run dev:local` or `npm run serve:local`).',
		);
	}
	const payload = (await response.json()) as { token?: string };
	const token = payload.token?.trim();
	if (!token) {
		throw new Error("Session bootstrap failed: backend returned an empty token.");
	}
	sessionToken = token;
	return token;
}

export const backendClient = {
	listOrgs: () => requestJson<OrgListResponse>("GET", "/api/orgs"),
	setActiveOrg: (target: OrgTarget) =>
		requestJson<OrgActionResponse>("POST", "/api/orgs/active", target),
	authOrg: (request: AuthOrgRequest) =>
		requestJson<OrgActionResponse>("POST", "/api/orgs/auth", request),
	reauthOrg: (target: OrgTarget) =>
		requestJson<OrgActionResponse>("POST", "/api/orgs/reauth", target),
	openOrg: (target: OrgTarget) =>
		requestJson<OrgActionResponse>("POST", "/api/orgs/open", target),
	logoutOrg: (target: OrgTarget) =>
		requestJson<OrgActionResponse>("POST", "/api/orgs/logout", target),
	setAlias: (request: SetAliasRequest) =>
		requestJson<OrgActionResponse>("POST", "/api/orgs/alias", request),
	refreshOrgStatus: (target: OrgTarget) =>
		requestJson<OrgActionResponse>("POST", "/api/orgs/refresh", target),
	deleteScratchOrg: (target: OrgTarget) =>
		requestJson<OrgActionResponse>("POST", "/api/orgs/delete-scratch", target),
	listMetadataTypes: (request: ListMetadataTypesRequest) =>
		requestJson<ListMetadataTypesResponse>("POST", "/api/metadata/types", request),
	listMetadataComponents: (request: ListMetadataComponentsRequest) =>
		requestJson<ListMetadataComponentsResponse>("POST", "/api/metadata/components", request),
	getComponentSource: (request: GetComponentSourceRequest) =>
		requestJson<GetComponentSourceResponse>("POST", "/api/metadata/component-source", request),
	getCrossOrgDiff: (request: CrossOrgDiffRequest) =>
		requestJson<CrossOrgDiffResponse>("POST", "/api/metadata/diff", request),
	startDestructiveDeploy: (request: StartDestructiveDeployRequest) =>
		requestJson<StartDestructiveDeployResponse>("POST", "/api/deploy/start", request),
	getDestructiveDeployStatus: (request: DestructiveDeployStatusRequest) =>
		requestJson<DestructiveDeployStatusResponse>("POST", "/api/deploy/status", request),
	cancelDestructiveDeploy: (request: CancelDestructiveDeployRequest) =>
		requestJson<CancelDestructiveDeployResponse>("POST", "/api/deploy/cancel", request),
	startCrossOrgDeploy: (request: StartCrossOrgDeployRequest) =>
		requestJson<StartCrossOrgDeployResponse>("POST", "/api/deploy/cross-org/start", request),
	getCrossOrgDeployStatus: (request: CrossOrgDeployStatusRequest) =>
		requestJson<CrossOrgDeployStatusResponse>("POST", "/api/deploy/cross-org/status", request),
	cancelCrossOrgDeploy: (request: CancelCrossOrgDeployRequest) =>
		requestJson<CancelCrossOrgDeployResponse>("POST", "/api/deploy/cross-org/cancel", request),
	executeRestRequest: (request: RestExecuteRequest) =>
		requestJson<RestExecuteResponse>("POST", "/api/rest/execute", request),
	soqlDescribeGlobal: (request: DescribeGlobalRequest) =>
		requestJson<DescribeGlobalResponse>("POST", "/api/soql/describe-global", request),
	soqlDescribeObject: (request: DescribeObjectRequest) =>
		requestJson<DescribeObjectResponse>("POST", "/api/soql/describe-object", request),
	soqlValidate: (request: ValidateQueryRequest) =>
		requestJson<ValidateQueryResponse>("POST", "/api/soql/validate", request),
	soqlRun: (request: RunQueryRequest) =>
		requestJson<RunQueryResponse>("POST", "/api/soql/run", request),
	soqlBulkStart: (request: StartBulkQueryRequest) =>
		requestJson<StartBulkQueryResponse>("POST", "/api/soql/bulk/start", request),
	soqlBulkStatus: (request: BulkQueryStatusRequest) =>
		requestJson<BulkQueryStatusResponse>("POST", "/api/soql/bulk/status", request),
	soqlBulkResult: (username: string, jobId: string) =>
		requestText("GET", `/api/soql/bulk/result?username=${encodeURIComponent(username)}&jobId=${encodeURIComponent(jobId)}`),
	startScratchOrgCreate: (request: StartScratchOrgCreateRequest) =>
		requestJson<StartScratchOrgCreateResponse>("POST", "/api/orgs/create-scratch/start", request),
	getScratchOrgCreateStatus: (request: ScratchOrgCreateStatusRequest) =>
		requestJson<ScratchOrgCreateStatusResponse>("POST", "/api/orgs/create-scratch/status", request),
	listScratchOrgSnapshots: (devHubUsername: string) =>
		requestJson<ListSnapshotsResponse>("GET", `/api/orgs/snapshots?devHub=${encodeURIComponent(devHubUsername)}`),
	listObjects: (request: ListObjectsRequest) =>
		requestJson<ListObjectsResponse>("POST", "/api/objects/list", request),
	listObjectChildren: (request: ListObjectChildrenRequest) =>
		requestJson<ListObjectChildrenResponse>("POST", "/api/objects/children", request),
	listLwcBundles: (request: ListLwcBundlesRequest) =>
		requestJson<ListLwcBundlesResponse>("POST", "/api/lwc/bundles/list", request),
	getLwcBundle: (request: GetLwcBundleRequest) =>
		requestJson<GetLwcBundleResponse>("POST", "/api/lwc/bundles/get", request),
	deployLwcBundle: (request: DeployLwcBundleRequest) =>
		requestJson<DeployLwcBundleResponse>("POST", "/api/lwc/bundles/deploy", request),
	announceReady: async () => {},
};
