import { ApiError } from "./api-error";
import { assertSalesforceHost } from "./salesforce-host";

export type ToolingQueryResponse = {
	records: Array<Record<string, unknown>>;
	totalSize: number;
	done: boolean;
	nextRecordsUrl?: string;
};

export type ToolingQueryConnection = {
	instanceUrl: string;
	accessToken?: string;
	getApiVersion(): string;
};

export async function runToolingQuery(
	connection: ToolingQueryConnection,
	soql: string,
	fetcher: typeof fetch,
	timeoutMs = 15_000,
): Promise<ToolingQueryResponse> {
	assertSalesforceHost(connection.instanceUrl);
	if (!connection.accessToken?.trim()) {
		throw new ApiError(401, "INVALID_SESSION", "Salesforce access token is missing.");
	}

	const encoded = encodeURIComponent(soql);
	const version = connection.getApiVersion();
	const timeoutSignal = AbortSignal.timeout(timeoutMs);

	try {
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
		return (await response.json()) as ToolingQueryResponse;
	} catch (error) {
		if (isAbortError(error)) {
			throw new ApiError(504, "TOOLING_QUERY_TIMEOUT", "Tooling query took too long.");
		}
		throw error;
	}
}

function isAbortError(error: unknown): boolean {
	return (
		error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")
	);
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
