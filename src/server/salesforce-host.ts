import { ApiError } from "./api-error";

const ALLOWED_SALESFORCE_HOST_SUFFIXES = [
	".salesforce.com",
	".force.com",
	".lightning.force.com",
	".salesforce-setup.com",
	".cloudforce.com",
];

export function assertSalesforceHost(rawUrl: string): void {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		throw new ApiError(
			400,
			"INVALID_SALESFORCE_HOST",
			"Salesforce instance URL is invalid.",
		);
	}

	if (parsed.protocol !== "https:") {
		throw new ApiError(
			400,
			"INVALID_SALESFORCE_HOST",
			"Salesforce instance URL must use HTTPS.",
		);
	}

	const hostname = parsed.hostname.toLowerCase();
	const isAllowed = ALLOWED_SALESFORCE_HOST_SUFFIXES.some(
		(suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
	);
	if (!isAllowed) {
		throw new ApiError(
			400,
			"INVALID_SALESFORCE_HOST",
			"Salesforce instance URL host is not allowed.",
		);
	}
}
