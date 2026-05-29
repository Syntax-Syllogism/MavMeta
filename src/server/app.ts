import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import fastifyStatic from "@fastify/static";
import Fastify from "fastify";

import { DeployService, type DeployServiceApi } from "./deploy-service";
import { ApiError } from "./api-error";
import { LwcService, type LwcServiceApi } from "./lwc-service";
import { MetadataService, type MetadataServiceApi } from "./metadata-service";
import { ObjectExplorerService, type ObjectExplorerServiceApi } from "./object-explorer-service";
import { FieldAccessService, type FieldAccessServiceApi } from "./field-access-service";
import { OrgService, type OrgServiceApi } from "./org-service";
import { RestService, type RestServiceApi } from "./rest-service";
import { SoqlService, type SoqlServiceApi } from "./soql-service";
import { ScratchOrgService, type ScratchOrgServiceApi } from "./scratch-org-service";
import { validateMetadataName } from "./metadata-name";
import { redactSecrets } from "./redact-secrets";
import type { CrossOrgDiffRequest, GetComponentSourceRequest } from "../shared/metadata";
import type { RestExecuteRequest } from "../shared/rest";
import type { DeployLwcBundleRequest } from "../shared/lwc";
import type {
	BulkQueryResultRequest,
	BulkQueryStatusRequest,
	DescribeGlobalRequest,
	DescribeObjectRequest,
	RunQueryRequest,
	SoqlApiType,
	StartBulkQueryRequest,
	ValidateQueryRequest,
} from "../shared/soql";
import type { FieldAccessRequest } from "../shared/field-access";

type ErrorPayload = {
	code: string;
	message: string;
};

type CreateAppOptions = {
	orgService?: OrgServiceApi;
	metadataService?: MetadataServiceApi;
	objectExplorerService?: ObjectExplorerServiceApi;
	fieldAccessService?: FieldAccessServiceApi;
	deployService?: DeployServiceApi;
	restService?: RestServiceApi;
	soqlService?: SoqlServiceApi;
	scratchOrgService?: ScratchOrgServiceApi;
	lwcService?: LwcServiceApi;
	serveStatic?: boolean;
	staticRootDir?: string;
	hostAllowlist?: string[];
	originAllowlist?: string[];
	sessionToken?: string;
	allowDevSessionBootstrap?: boolean;
};

const SECURITY_HEADERS: Record<string, string> = {
	"content-security-policy":
		"default-src 'self'; connect-src 'self' https://*.salesforce.com https://*.force.com https://*.lightning.force.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
	"x-content-type-options": "nosniff",
	"x-frame-options": "DENY",
	"referrer-policy": "no-referrer",
	"permissions-policy": "geolocation=(), microphone=(), camera=(), payment=()",
	"cross-origin-opener-policy": "same-origin",
	"cross-origin-resource-policy": "same-origin",
};

export function createApp(options: CreateAppOptions = {}) {
	const app = Fastify({
		logger: true,
	});
	const orgService = options.orgService ?? new OrgService();
	const metadataService = options.metadataService ?? new MetadataService();
	const objectExplorerService = options.objectExplorerService ?? new ObjectExplorerService();
	const fieldAccessService = options.fieldAccessService ?? new FieldAccessService();
	const deployService = options.deployService ?? new DeployService();
	const restService = options.restService ?? new RestService();
	const soqlService = options.soqlService ?? new SoqlService();
	const scratchOrgService = options.scratchOrgService ?? new ScratchOrgService();
	const lwcService = options.lwcService ?? new LwcService();
	const sessionToken = options.sessionToken ?? randomBytes(32).toString("hex");
	const allowDevSessionBootstrap = options.allowDevSessionBootstrap === true;
	const configuredHostAllowlist = new Set(
		options.hostAllowlist?.map((host) => host.toLowerCase()) ?? [],
	);
	const configuredOriginAllowlist = new Set(options.originAllowlist ?? []);
	const tokenBuffer = Buffer.from(sessionToken, "utf8");

	app.addHook("onRequest", async (request, reply) => {
		if (request.url.startsWith("/api/")) {
			const allowedMethods = new Set(["GET", "POST", "OPTIONS"]);
			if (!allowedMethods.has(request.method)) {
				reply.code(405).send({
					code: "METHOD_NOT_ALLOWED",
					message: "HTTP method is not allowed for API routes.",
				});
				return;
			}
		}

		const hostHeader = request.headers.host?.toLowerCase();
		const allowedHosts = getAllowedHosts(app, configuredHostAllowlist);
		if (!hostHeader || !allowedHosts.has(hostHeader)) {
			reply.code(403).send({ code: "INVALID_HOST", message: "Host header is not allowed." });
			return;
		}

		const originHeader = request.headers.origin;
		const allowedOrigins = getAllowedOrigins(app, configuredOriginAllowlist);
		if (originHeader && !allowedOrigins.has(originHeader)) {
			reply.code(403).send({ code: "INVALID_ORIGIN", message: "Origin is not allowed." });
			return;
		}

		if (!request.url.startsWith("/api/")) {
			return;
		}
		if (allowDevSessionBootstrap && request.method === "GET" && request.url === "/api/session") {
			// CSRF defense for dev bootstrap:
			// browser clients must send a custom header, which triggers CORS preflight,
			// and when Origin is present it must be allowlisted.
			// Some dev proxy paths do not forward Origin for same-origin GET bootstrap calls.
			if (originHeader && !allowedOrigins.has(originHeader)) {
				reply.code(403).send({ code: "INVALID_ORIGIN", message: "Origin is not allowed." });
				return;
			}
			return;
		}

		if (!hasMatchingSessionToken(request.headers["x-mavmeta-session"], tokenBuffer)) {
			reply
				.code(401)
				.send({ code: "INVALID_SESSION", message: "Invalid or missing session token." });
			return;
		}
	});

	app.addHook("onSend", async (request, reply, payload) => {
		reply.header("vary", "Origin");
		for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
			reply.header(key, value);
		}

		const originHeader = request.headers.origin;
		const allowedOrigins = getAllowedOrigins(app, configuredOriginAllowlist);
		if (originHeader && allowedOrigins.has(originHeader)) {
			reply.header("access-control-allow-origin", originHeader);
			reply.header("access-control-allow-headers", "content-type, x-mavmeta-session");
			reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
		}

		return payload;
	});

	app.options("/api/*", async (request, reply) => {
		const originHeader = request.headers.origin;
		const allowedOrigins = getAllowedOrigins(app, configuredOriginAllowlist);
		if (originHeader && allowedOrigins.has(originHeader)) {
			reply.header("access-control-allow-origin", originHeader);
			reply.header("access-control-allow-headers", "content-type, x-mavmeta-session");
			reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
		}
		reply.code(204).send();
	});

	if (allowDevSessionBootstrap) {
		app.get("/api/session", async (request, reply) => {
			const bootstrapHeader = request.headers["x-mavmeta-bootstrap"];
			if (bootstrapHeader !== "1") {
				reply.code(400).send({
					code: "INVALID_BOOTSTRAP",
					message: "Missing required bootstrap header.",
				});
				return;
			}
			reply.send({ token: sessionToken });
		});
	}

	app.setErrorHandler((error, request, reply) => {
		const statusCode =
			error instanceof ApiError
				? error.statusCode
				: Number.isInteger((error as { statusCode?: number }).statusCode)
					? ((error as { statusCode: number }).statusCode ?? 500)
					: 500;
		const payload: ErrorPayload = {
			code: error instanceof ApiError ? error.code : "INTERNAL_ERROR",
			message:
				error instanceof Error ? redactSecrets(error.message) : "Unexpected backend failure.",
		};

		if (statusCode >= 500) {
			const safeErrorMessage =
				error instanceof Error ? redactSecrets(error.message) : "Unexpected backend failure.";
			request.log.error({ err: { message: safeErrorMessage } }, "Internal server error");
		}

		reply.status(statusCode).send(payload);
	});

	app.get("/api/health", async () => ({ status: "ok" }));
	app.get("/api/orgs", async () => orgService.listOrgs());

	app.post("/api/orgs/active", async (request) => {
		const target = readOrgTarget(request.body);
		return orgService.setActiveOrg(target);
	});
	app.post("/api/orgs/auth", async (request) =>
		orgService.authOrg(readAuthOrgRequest(request.body)),
	);
	app.post("/api/orgs/reauth", async (request) =>
		orgService.reauthOrg(readOrgTarget(request.body)),
	);
	app.post("/api/orgs/open", async (request) => orgService.openOrg(readOrgTarget(request.body)));
	app.post("/api/orgs/logout", async (request) =>
		orgService.logoutOrg(readOrgTarget(request.body)),
	);
	app.post("/api/orgs/alias", async (request) =>
		orgService.setAlias(readSetAliasRequest(request.body)),
	);
	app.post("/api/orgs/refresh", async (request) =>
		orgService.refreshOrgStatus(readOrgTarget(request.body)),
	);
	app.post("/api/orgs/delete-scratch", async (request) =>
		orgService.deleteScratchOrg(readOrgTarget(request.body)),
	);

	app.post("/api/metadata/types", async (request) =>
		metadataService.listMetadataTypes(readListMetadataTypesRequest(request.body)),
	);
	app.post("/api/metadata/components", async (request) =>
		metadataService.listMetadataComponents(readListMetadataComponentsRequest(request.body)),
	);
	app.post("/api/metadata/component-source", async (request) =>
		metadataService.getComponentSource(readGetComponentSourceRequest(request.body)),
	);
	app.post("/api/metadata/diff", async (request) =>
		metadataService.getCrossOrgComponentDiff(readCrossOrgDiffRequest(request.body)),
	);

	app.post("/api/objects/list", async (request) =>
		objectExplorerService.listObjects(readOrgTargetRequest(request.body)),
	);
	app.post("/api/objects/list-page", async (request) =>
		objectExplorerService.listObjectsPage(readListObjectsPageRequest(request.body)),
	);
	app.post("/api/objects/children", async (request) =>
		objectExplorerService.listObjectChildren(readListObjectChildrenRequest(request.body)),
	);
	app.post("/api/fields/access", async (request) =>
		fieldAccessService.resolve(readFieldAccessRequest(request.body)),
	);

	app.post("/api/deploy/start", async (request) =>
		deployService.startDestructiveDeploy(readStartDestructiveDeployRequest(request.body)),
	);
	app.post("/api/deploy/status", async (request) =>
		deployService.getDestructiveDeployStatus(
			readDestructiveDeployStatusRequest(request.body).operationId,
		),
	);
	app.post("/api/deploy/cancel", async (request) =>
		deployService.cancelDestructiveDeploy(
			readDestructiveDeployStatusRequest(request.body).operationId,
		),
	);
	app.post("/api/deploy/cross-org/start", async (request) =>
		deployService.startCrossOrgDeploy(readStartCrossOrgDeployRequest(request.body)),
	);
	app.post("/api/deploy/cross-org/status", async (request) =>
		deployService.getCrossOrgDeployStatus(
			readDestructiveDeployStatusRequest(request.body).operationId,
		),
	);
	app.post("/api/deploy/cross-org/cancel", async (request) =>
		deployService.cancelCrossOrgDeploy(
			readDestructiveDeployStatusRequest(request.body).operationId,
		),
	);

	app.post("/api/rest/execute", async (request) =>
		restService.executeRequest(readRestExecuteRequest(request.body)),
	);
	app.post("/api/soql/describe-global", async (request) =>
		soqlService.describeGlobal(readSoqlDescribeGlobalRequest(request.body)),
	);
	app.post("/api/soql/describe-object", async (request) =>
		soqlService.describeObject(readSoqlDescribeObjectRequest(request.body)),
	);
	app.post("/api/soql/validate", async (request) =>
		soqlService.validateQuery(readSoqlValidateRequest(request.body)),
	);
	app.post("/api/soql/run", async (request) =>
		soqlService.runQuery(readSoqlRunRequest(request.body)),
	);
	app.post("/api/soql/bulk/start", async (request) =>
		soqlService.startBulkQuery(readSoqlBulkStartRequest(request.body)),
	);
	app.post("/api/soql/bulk/status", async (request) =>
		soqlService.getBulkQueryStatus(readSoqlBulkStatusRequest(request.body)),
	);
	app.get("/api/soql/bulk/result", async (request, reply) => {
		const csv = await soqlService.getBulkQueryResult(readSoqlBulkResultRequest(request.query));
		return reply.type("text/csv; charset=utf-8").send(csv);
	});

	app.post("/api/lwc/bundles/list", async (request) =>
		lwcService.listBundles(readLwcListBundlesRequest(request.body)),
	);
	app.post("/api/lwc/bundles/get", async (request) =>
		lwcService.getBundle(readLwcGetBundleRequest(request.body)),
	);
	app.post("/api/lwc/bundles/deploy", async (request) =>
		lwcService.deployBundle(readLwcDeployBundleRequest(request.body)),
	);

	app.post("/api/orgs/create-scratch/start", async (request) =>
		scratchOrgService.startCreate(readStartScratchOrgCreateRequest(request.body)),
	);
	app.post("/api/orgs/create-scratch/status", async (request) => {
		const { operationId } = readOperationIdRequest(request.body);
		return scratchOrgService.getStatus(operationId);
	});
	app.get("/api/orgs/snapshots", async (request) =>
		scratchOrgService.listSnapshots(readDevHubUsernameFromQuery(request.query)),
	);

	if (options.serveStatic) {
		const staticRoot = options.staticRootDir ?? resolve(process.cwd(), "dist");
		if (existsSync(staticRoot)) {
			const staticIndexHtml = injectSessionMetaIntoHtml(
				readFileSync(resolve(staticRoot, "index.html"), "utf8"),
				sessionToken,
			);
			void app.register(fastifyStatic, {
				root: staticRoot,
				prefix: "/",
				wildcard: false,
				index: false,
			});
			app.get("/*", async (request, reply) => {
				const requestedPath = request.params as { "*": string };
				if (requestedPath["*"].startsWith("api/")) {
					throw new ApiError(404, "NOT_FOUND", "Route not found.");
				}
				return reply.type("text/html; charset=utf-8").send(staticIndexHtml);
			});
		} else {
			app.log.warn(`Static root "${staticRoot}" does not exist.`);
		}
	}

	return app;
}

function hasMatchingSessionToken(
	requestToken: string | string[] | undefined,
	sessionTokenBuffer: Buffer,
): boolean {
	if (typeof requestToken !== "string") {
		return false;
	}
	const requestBuffer = Buffer.from(requestToken, "utf8");
	if (requestBuffer.length !== sessionTokenBuffer.length) {
		return false;
	}
	return timingSafeEqual(requestBuffer, sessionTokenBuffer);
}

function getAllowedHosts(app: ReturnType<typeof Fastify>, configured: Set<string>): Set<string> {
	const address = app.server.address();
	const allowed = new Set(configured);
	if (address && typeof address !== "string") {
		allowed.add(`127.0.0.1:${address.port}`);
		allowed.add(`localhost:${address.port}`);
	}
	return allowed;
}

function getAllowedOrigins(app: ReturnType<typeof Fastify>, configured: Set<string>): Set<string> {
	const address = app.server.address();
	const allowed = new Set(configured);
	if (address && typeof address !== "string") {
		allowed.add(`http://127.0.0.1:${address.port}`);
		allowed.add(`http://localhost:${address.port}`);
	}
	return allowed;
}

function injectSessionMetaIntoHtml(indexHtml: string, sessionToken: string): string {
	if (indexHtml.includes('name="MavMeta-session"')) {
		return indexHtml;
	}
	if (!indexHtml.includes("</head>")) {
		throw new Error("Static index.html is missing </head>; cannot inject session meta.");
	}
	const metaTag = `<meta name="MavMeta-session" content="${sessionToken}">`;
	return indexHtml.replace("</head>", `  ${metaTag}\n  </head>`);
}

function readObjectBody(body: unknown): Record<string, unknown> {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		throw new ApiError(400, "INVALID_BODY", "Request body must be an object.");
	}
	return body as Record<string, unknown>;
}

function readStringField(
	body: Record<string, unknown>,
	fieldName: string,
	options: { required?: boolean } = {},
): string | undefined {
	const value = body[fieldName];

	if (value === undefined || value === null) {
		if (options.required) {
			throw new ApiError(400, "INVALID_REQUEST", `Missing required field "${fieldName}".`);
		}
		return undefined;
	}

	if (typeof value !== "string" || !value.trim()) {
		throw new ApiError(400, "INVALID_REQUEST", `Field "${fieldName}" must be a non-empty string.`);
	}

	return value.trim();
}

function readOptionalStringField(
	body: Record<string, unknown>,
	fieldName: string,
): string | undefined {
	const value = body[fieldName];

	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new ApiError(400, "INVALID_REQUEST", `Field "${fieldName}" must be a string.`);
	}
	return value.trim() || undefined;
}

function readOrgTarget(body: unknown): { username: string; startPath?: string } {
	const objectBody = readObjectBody(body);
	const startPath = readStringField(objectBody, "startPath");
	if (startPath && !startPath.startsWith("/")) {
		throw new ApiError(400, "INVALID_REQUEST", 'Field "startPath" must start with "/".');
	}
	return {
		username: readStringField(objectBody, "username", { required: true }) as string,
		startPath,
	};
}

function readAuthOrgRequest(body: unknown): { loginUrl: string; alias?: string } {
	const objectBody = readObjectBody(body);
	return {
		loginUrl: readStringField(objectBody, "loginUrl", { required: true }) ?? "",
		alias: readStringField(objectBody, "alias"),
	};
}

function readSetAliasRequest(body: unknown): {
	target: { username: string };
	alias: string;
} {
	const objectBody = readObjectBody(body);
	const targetValue = objectBody.target;
	const targetBody = readObjectBody(targetValue);

	return {
		target: {
			username: readStringField(targetBody, "username", {
				required: true,
			}) as string,
		},
		alias: readStringField(objectBody, "alias", { required: true }) as string,
	};
}

function readListMetadataTypesRequest(body: unknown): {
	target: { username: string };
} {
	const objectBody = readObjectBody(body);
	const targetBody = readObjectBody(objectBody.target);
	return {
		target: {
			username: readStringField(targetBody, "username", {
				required: true,
			}) as string,
		},
	};
}

function readListMetadataComponentsRequest(body: unknown): {
	target: { username: string };
	metadataType: string;
	folder?: string;
	search?: string;
} {
	const objectBody = readObjectBody(body);
	const targetBody = readObjectBody(objectBody.target);

	return {
		target: {
			username: readStringField(targetBody, "username", {
				required: true,
			}) as string,
		},
		metadataType: readStringField(objectBody, "metadataType", { required: true }) ?? "",
		folder: readStringField(objectBody, "folder"),
		search: readStringField(objectBody, "search"),
	};
}

function readStartDestructiveDeployRequest(body: unknown): {
	target: { username: string };
	mode: "validate" | "deploy";
	components: Array<{ metadataType: string; fullName: string }>;
} {
	const objectBody = readObjectBody(body);
	const targetBody = readObjectBody(objectBody.target);
	const mode = readStringField(objectBody, "mode", {
		required: true,
	}) as string;
	if (mode !== "validate" && mode !== "deploy") {
		throw new ApiError(400, "INVALID_REQUEST", 'Field "mode" must be "validate" or "deploy".');
	}

	const componentsValue = objectBody.components;
	if (!Array.isArray(componentsValue)) {
		throw new ApiError(400, "INVALID_REQUEST", 'Field "components" must be an array.');
	}

	const components = componentsValue.map((component, index) => {
		const componentBody = readObjectBody(component);
		const metadataType = readStringField(componentBody, "metadataType", {
			required: true,
		});
		const fullName = readStringField(componentBody, "fullName", {
			required: true,
		});

		if (!metadataType || !fullName) {
			throw new ApiError(
				400,
				"INVALID_REQUEST",
				`Component at index ${index} is missing metadataType or fullName.`,
			);
		}
		if (!validateMetadataName(fullName)) {
			throw new ApiError(
				400,
				"INVALID_REQUEST",
				`Component at index ${index} has invalid fullName.`,
			);
		}

		return {
			metadataType,
			fullName,
		};
	});

	return {
		target: {
			username: readStringField(targetBody, "username", {
				required: true,
			}) as string,
		},
		mode,
		components,
	};
}

function readDestructiveDeployStatusRequest(body: unknown): { operationId: string } {
	const objectBody = readObjectBody(body);
	return {
		operationId: readStringField(objectBody, "operationId", {
			required: true,
		}) as string,
	};
}

function readStartCrossOrgDeployRequest(body: unknown): {
	source: { username: string };
	target: { username: string };
	mode: "validate" | "deploy";
	components: Array<{ metadataType: string; fullName: string }>;
} {
	const objectBody = readObjectBody(body);
	const sourceBody = readObjectBody(objectBody.source);
	const targetBody = readObjectBody(objectBody.target);
	const mode = readStringField(objectBody, "mode", { required: true }) as string;
	if (mode !== "validate" && mode !== "deploy") {
		throw new ApiError(400, "INVALID_REQUEST", 'Field "mode" must be "validate" or "deploy".');
	}
	const componentsValue = objectBody.components;
	if (!Array.isArray(componentsValue)) {
		throw new ApiError(400, "INVALID_REQUEST", 'Field "components" must be an array.');
	}
	const components = componentsValue.map((component, index) => {
		const componentBody = readObjectBody(component);
		const metadataType = readStringField(componentBody, "metadataType", {
			required: true,
		});
		const fullName = readStringField(componentBody, "fullName", { required: true });
		if (!metadataType || !fullName) {
			throw new ApiError(
				400,
				"INVALID_REQUEST",
				`Component at index ${index} is missing metadataType or fullName.`,
			);
		}
		if (!validateMetadataName(fullName)) {
			throw new ApiError(
				400,
				"INVALID_REQUEST",
				`Component at index ${index} has invalid fullName.`,
			);
		}
		return { metadataType, fullName };
	});

	return {
		source: {
			username: readStringField(sourceBody, "username", { required: true }) as string,
		},
		target: {
			username: readStringField(targetBody, "username", { required: true }) as string,
		},
		mode,
		components,
	};
}

function readRestExecuteRequest(body: unknown): RestExecuteRequest {
	const objectBody = readObjectBody(body);
	const username = readStringField(objectBody, "username", { required: true }) as string;
	const methodRaw = readStringField(objectBody, "method", { required: true }) as string;
	const path = readStringField(objectBody, "path", { required: true }) as string;

	if (!["GET", "POST", "PATCH", "DELETE"].includes(methodRaw)) {
		throw new ApiError(
			400,
			"INVALID_REQUEST",
			'Field "method" must be GET, POST, PATCH, or DELETE.',
		);
	}

	const method = methodRaw as RestExecuteRequest["method"];
	const bodyText = readStringField(objectBody, "body");

	const headersValue = objectBody.headers;
	let headers: Record<string, string> | undefined;
	if (headersValue !== undefined && headersValue !== null) {
		if (typeof headersValue !== "object" || Array.isArray(headersValue)) {
			throw new ApiError(400, "INVALID_REQUEST", 'Field "headers" must be an object.');
		}
		headers = headersValue as Record<string, string>;
	}

	return { username, method, path, headers, body: bodyText };
}

function readSoqlApi(body: Record<string, unknown>): SoqlApiType {
	const api = readStringField(body, "api", { required: true });
	if (api !== "rest" && api !== "tooling") {
		throw new ApiError(400, "INVALID_REQUEST", 'Field "api" must be "rest" or "tooling".');
	}
	return api;
}

function readSoqlDescribeGlobalRequest(body: unknown): DescribeGlobalRequest {
	const objectBody = readObjectBody(body);
	return {
		username: readStringField(objectBody, "username", { required: true }) as string,
		api: readSoqlApi(objectBody),
	};
}

function readSoqlDescribeObjectRequest(body: unknown): DescribeObjectRequest {
	const objectBody = readObjectBody(body);
	return {
		username: readStringField(objectBody, "username", { required: true }) as string,
		api: readSoqlApi(objectBody),
		sobject: readStringField(objectBody, "sobject", { required: true }) as string,
	};
}

function readSoqlValidateRequest(body: unknown): ValidateQueryRequest {
	const objectBody = readObjectBody(body);
	return {
		username: readStringField(objectBody, "username", { required: true }) as string,
		api: readSoqlApi(objectBody),
		soql: readStringField(objectBody, "soql", { required: true }) as string,
	};
}

function readSoqlRunRequest(body: unknown): RunQueryRequest {
	const objectBody = readObjectBody(body);
	const previewLimitRaw = objectBody.previewLimit;
	let previewLimit: number | undefined;
	if (previewLimitRaw !== undefined) {
		if (
			typeof previewLimitRaw !== "number" ||
			!Number.isInteger(previewLimitRaw) ||
			previewLimitRaw <= 0
		) {
			throw new ApiError(
				400,
				"INVALID_REQUEST",
				'Field "previewLimit" must be a positive integer when provided.',
			);
		}
		previewLimit = previewLimitRaw;
	}
	const includeAllPagesRaw = objectBody.includeAllPages;
	let includeAllPages: boolean | undefined;
	if (includeAllPagesRaw !== undefined) {
		if (typeof includeAllPagesRaw !== "boolean") {
			throw new ApiError(
				400,
				"INVALID_REQUEST",
				'Field "includeAllPages" must be a boolean when provided.',
			);
		}
		includeAllPages = includeAllPagesRaw;
	}
	const nextRecordsUrl = readStringField(objectBody, "nextRecordsUrl");
	if (nextRecordsUrl !== undefined && !nextRecordsUrl.startsWith("/")) {
		throw new ApiError(400, "INVALID_REQUEST", 'Field "nextRecordsUrl" must start with "/".');
	}
	return {
		username: readStringField(objectBody, "username", { required: true }) as string,
		api: readSoqlApi(objectBody),
		soql: readStringField(objectBody, "soql", { required: true }) as string,
		previewLimit,
		includeAllPages,
		nextRecordsUrl,
	};
}

function readSoqlBulkStartRequest(body: unknown): StartBulkQueryRequest {
	const objectBody = readObjectBody(body);
	return {
		username: readStringField(objectBody, "username", { required: true }) as string,
		soql: readStringField(objectBody, "soql", { required: true }) as string,
	};
}

function readSoqlBulkStatusRequest(body: unknown): BulkQueryStatusRequest {
	const objectBody = readObjectBody(body);
	return {
		username: readStringField(objectBody, "username", { required: true }) as string,
		jobId: readStringField(objectBody, "jobId", { required: true }) as string,
	};
}

function readSoqlBulkResultRequest(query: unknown): BulkQueryResultRequest {
	const queryBody = readObjectBody(query);
	return {
		username: readStringField(queryBody, "username", { required: true }) as string,
		jobId: readStringField(queryBody, "jobId", { required: true }) as string,
	};
}

function readStartScratchOrgCreateRequest(body: unknown) {
	const objectBody = readObjectBody(body);
	const devHubUsername = readStringField(objectBody, "devHubUsername", {
		required: true,
	}) as string;
	const alias = readStringField(objectBody, "alias");
	const durationDaysRaw = objectBody.durationDays;

	if (typeof durationDaysRaw !== "number" || !Number.isInteger(durationDaysRaw)) {
		throw new ApiError(400, "INVALID_REQUEST", 'Field "durationDays" must be an integer.');
	}

	const definitionValue = objectBody.definition;
	if (
		typeof definitionValue !== "object" ||
		definitionValue === null ||
		Array.isArray(definitionValue)
	) {
		throw new ApiError(400, "INVALID_REQUEST", 'Field "definition" must be an object.');
	}

	return {
		devHubUsername,
		definition: definitionValue as Record<string, unknown>,
		alias,
		durationDays: durationDaysRaw,
	};
}

function readOperationIdRequest(body: unknown): { operationId: string } {
	const objectBody = readObjectBody(body);
	return {
		operationId: readStringField(objectBody, "operationId", { required: true }) as string,
	};
}

function readDevHubUsernameFromQuery(query: unknown): string {
	const queryBody = readObjectBody(query);
	return readStringField(queryBody, "devHub", { required: true }) as string;
}

function readGetComponentSourceRequest(body: unknown): GetComponentSourceRequest {
	const objectBody = readObjectBody(body);
	const targetBody = readObjectBody(objectBody.target);

	return {
		target: {
			username: readStringField(targetBody, "username", {
				required: true,
			}) as string,
		},
		metadataType: readStringField(objectBody, "metadataType", { required: true }) as string,
		fullName: readStringField(objectBody, "fullName", { required: true }) as string,
		fileName: readStringField(objectBody, "fileName"),
		folder: readStringField(objectBody, "folder"),
	};
}

function readOrgTargetRequest(body: unknown): { target: { username: string } } {
	const objectBody = readObjectBody(body);
	const targetBody = readObjectBody(objectBody.target);
	return {
		target: {
			username: readStringField(targetBody, "username", { required: true }) as string,
		},
	};
}

function readListObjectsPageRequest(body: unknown): {
	target: { username: string };
	cursor?: string;
	search?: string;
	limit?: number;
} {
	const objectBody = readObjectBody(body);
	const targetBody = readObjectBody(objectBody.target);
	const limitRaw = objectBody.limit;
	let limit: number | undefined;
	if (limitRaw !== undefined) {
		if (
			typeof limitRaw !== "number" ||
			!Number.isInteger(limitRaw) ||
			limitRaw <= 0 ||
			limitRaw > 200
		) {
			throw new ApiError(
				400,
				"INVALID_REQUEST",
				'Field "limit" must be an integer between 1 and 200.',
			);
		}
		limit = limitRaw;
	}

	return {
		target: {
			username: readStringField(targetBody, "username", { required: true }) as string,
		},
		cursor: readOptionalStringField(objectBody, "cursor"),
		search: readOptionalStringField(objectBody, "search"),
		limit,
	};
}

function readCrossOrgDiffRequest(body: unknown): CrossOrgDiffRequest {
	const objectBody = readObjectBody(body);
	const sourceBody = readObjectBody(objectBody.source);
	const targetBody = readObjectBody(objectBody.target);
	const componentsRaw = objectBody.components;

	if (!Array.isArray(componentsRaw)) {
		throw new ApiError(400, "INVALID_REQUEST", 'Field "components" must be an array.');
	}

	return {
		source: {
			username: readStringField(sourceBody, "username", { required: true }) as string,
		},
		target: {
			username: readStringField(targetBody, "username", { required: true }) as string,
		},
		components: componentsRaw.map((component) => {
			const componentBody = readObjectBody(component);
			return {
				metadataType: readStringField(componentBody, "metadataType", { required: true }) as string,
				fullName: readStringField(componentBody, "fullName", { required: true }) as string,
				fileName: readStringField(componentBody, "fileName"),
				folder: readStringField(componentBody, "folder"),
			};
		}),
	};
}

function readListObjectChildrenRequest(body: unknown): {
	target: { username: string };
	objectApiName: string;
} {
	const objectBody = readObjectBody(body);
	const targetBody = readObjectBody(objectBody.target);
	return {
		target: {
			username: readStringField(targetBody, "username", { required: true }) as string,
		},
		objectApiName: readStringField(objectBody, "objectApiName", { required: true }) as string,
	};
}

function readFieldAccessRequest(body: unknown): FieldAccessRequest {
	const objectBody = readObjectBody(body);
	const targetBody = readObjectBody(objectBody.target);
	return {
		target: {
			username: readStringField(targetBody, "username", { required: true }) as string,
		},
		sobjectType: readStringField(objectBody, "sobjectType", { required: true }) as string,
		fieldFullName: readStringField(objectBody, "fieldFullName", { required: true }) as string,
	};
}

function readLwcListBundlesRequest(body: unknown): { orgUsername: string } {
	const objectBody = readObjectBody(body);
	return {
		orgUsername: readStringField(objectBody, "orgUsername", { required: true }) as string,
	};
}

function readLwcGetBundleRequest(body: unknown): { orgUsername: string; bundleId: string } {
	const objectBody = readObjectBody(body);
	return {
		orgUsername: readStringField(objectBody, "orgUsername", { required: true }) as string,
		bundleId: readStringField(objectBody, "bundleId", { required: true }) as string,
	};
}

function readLwcDeployBundleRequest(body: unknown): DeployLwcBundleRequest {
	const objectBody = readObjectBody(body);
	const orgUsername = readStringField(objectBody, "orgUsername", { required: true }) as string;
	const bundleId = readStringField(objectBody, "bundleId", { required: true }) as string;
	const expectedLastModifiedDate = readStringField(objectBody, "expectedLastModifiedDate", {
		required: true,
	}) as string;
	const forceRaw = objectBody.force;
	const force = forceRaw === true;

	const filesRaw = objectBody.files;
	if (!Array.isArray(filesRaw)) {
		throw new ApiError(400, "INVALID_REQUEST", 'Field "files" must be an array.');
	}
	const files = filesRaw.map((item, index) => {
		const fileBody = readObjectBody(item);
		const path = readStringField(fileBody, "path", { required: true });
		if (!path) {
			throw new ApiError(400, "INVALID_REQUEST", `files[${index}] is missing path.`);
		}
		const sourceRaw = fileBody.source;
		if (typeof sourceRaw !== "string") {
			throw new ApiError(400, "INVALID_REQUEST", `files[${index}].source must be a string.`);
		}
		return { path, source: sourceRaw };
	});

	return { orgUsername, bundleId, files, expectedLastModifiedDate, force };
}
