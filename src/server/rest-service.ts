import { Org } from "@salesforce/core";

import { ApiError } from "./api-error";
import { assertSalesforceHost } from "./salesforce-host";
import type { RestExecuteRequest, RestExecuteResponse } from "../shared/rest";

type RestConnection = {
	instanceUrl: string;
	accessToken: string | undefined;
};

type RestServiceOptions = {
	connectionFactory?: (username: string) => Promise<RestConnection>;
	fetcher?: typeof fetch;
};

export type RestServiceApi = {
	executeRequest(request: RestExecuteRequest): Promise<RestExecuteResponse>;
};

export class RestService implements RestServiceApi {
	private readonly connectionFactory: (username: string) => Promise<RestConnection>;
	private readonly fetcher: typeof fetch;

	constructor(options: RestServiceOptions = {}) {
		this.connectionFactory = options.connectionFactory ?? createConnection;
		this.fetcher = options.fetcher ?? fetch;
	}

	async executeRequest(request: RestExecuteRequest): Promise<RestExecuteResponse> {
		if (!request.path.startsWith("/services/")) {
			throw new ApiError(400, "INVALID_PATH", 'Path must start with "/services/".');
		}

		const connection = await this.connectionFactory(request.username);
		assertSalesforceHost(connection.instanceUrl);
		const url = `${connection.instanceUrl}${request.path}`;

		const headers: Record<string, string> = {
			Authorization: `Bearer ${connection.accessToken ?? ""}`,
			"Content-Type": "application/json",
			Accept: "application/json",
			...request.headers,
		};

		const start = Date.now();
		const response = await this.fetcher(url, {
			method: request.method,
			headers,
			body: request.body,
		});
		const durationMs = Date.now() - start;

		const text = await response.text();
		const contentType = response.headers.get("content-type") ?? "";

		let body: unknown;
		let isJson = false;
		if (contentType.includes("application/json")) {
			try {
				body = JSON.parse(text) as unknown;
				isJson = true;
			} catch {
				body = text;
			}
		} else {
			body = text;
		}

		const responseHeaders: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			responseHeaders[key] = value;
		});

		return { status: response.status, headers: responseHeaders, body, isJson, durationMs };
	}
}

async function createConnection(username: string): Promise<RestConnection> {
	const org = await Org.create({ aliasOrUsername: username });
	return org.getConnection() as unknown as RestConnection;
}
