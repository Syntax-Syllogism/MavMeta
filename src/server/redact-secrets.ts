const STRING_SECRET_PATTERNS: RegExp[] = [
	/\b00D[A-Za-z0-9!._]{10,200}\b/g,
	/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
	/\bBearer\s+\S{20,}\b/gi,
	/\bAuthorization\s*:\s*["']?Bearer\s+\S{20,}["']?/gi,
];

const SECRET_KEY_PATTERN =
	/(accesstoken|access_token|access-token|refreshtoken|refresh_token|refresh-token|sessionid|session_id|session-id|sessiontoken|session_token|session-token|clientsecret|client_secret|client-secret|consumersecret|consumer_secret|consumer-secret)/i;

export function redactSecrets<T>(input: T): T {
	if (typeof input === "string") {
		return redactString(input) as T;
	}

	if (Array.isArray(input)) {
		return input.map((entry) => redactSecrets(entry)) as T;
	}

	if (input && typeof input === "object") {
		const redactedRecord: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
			if (SECRET_KEY_PATTERN.test(key)) {
				redactedRecord[key] = "[REDACTED]";
				continue;
			}
			redactedRecord[key] = redactSecrets(value);
		}
		return redactedRecord as T;
	}

	return input;
}

function redactString(input: string): string {
	let redacted = input;
	for (const pattern of STRING_SECRET_PATTERNS) {
		redacted = redacted.replace(pattern, "[REDACTED]");
	}
	redacted = redacted.replace(
		/\b(access[_-]?token|refresh[_-]?token|session[_-]?token|sessionid|client[_-]?secret|consumer[_-]?secret)\s*[:=]\s*["']?([^"'\s]+)["']?/gi,
		"$1=[REDACTED]",
	);
	return redacted;
}
