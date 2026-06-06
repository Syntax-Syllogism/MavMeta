const STRING_SECRET_PATTERNS: RegExp[] = [
	/\b00D[A-Za-z0-9!._]{10,200}\b/g,
	/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
	/\bBearer\s+\S{20,}\b/gi,
];

const SECRET_KEY_PATTERN =
	/(accesstoken|access_token|access-token|refreshtoken|refresh_token|refresh-token|sessionid|session_id|session-id|sessiontoken|session_token|session-token|clientsecret|client_secret|client-secret|consumersecret|consumer_secret|consumer-secret)/i;

export function installRedactingConsole(): void {
	const targets: Array<"log" | "info" | "warn" | "error"> = ["log", "info", "warn", "error"];
	for (const method of targets) {
		const original = console[method].bind(console);
		console[method] = (...args: unknown[]) => {
			original(...args.map((arg) => redactClientSecrets(arg)));
		};
	}
}

function redactClientSecrets<T>(input: T): T {
	if (typeof input === "string") {
		return redactClientString(input) as T;
	}
	if (Array.isArray(input)) {
		return input.map((entry) => redactClientSecrets(entry)) as T;
	}
	if (input && typeof input === "object") {
		const output: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
			if (SECRET_KEY_PATTERN.test(key)) {
				output[key] = "[REDACTED]";
				continue;
			}
			output[key] = redactClientSecrets(value);
		}
		return output as T;
	}
	return input;
}

function redactClientString(input: string): string {
	let redacted = input;
	for (const pattern of STRING_SECRET_PATTERNS) {
		redacted = redacted.replace(pattern, "[REDACTED]");
	}
	return redacted;
}
