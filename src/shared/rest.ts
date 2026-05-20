export type RestMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type RestExecuteRequest = {
	username: string;
	method: RestMethod;
	path: string;
	headers?: Record<string, string>;
	body?: string;
};

export type RestExecuteResponse = {
	status: number;
	headers: Record<string, string>;
	body: unknown;
	isJson: boolean;
	durationMs: number;
};
