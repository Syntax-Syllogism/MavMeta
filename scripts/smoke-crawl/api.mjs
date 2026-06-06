// @ts-nocheck
const HEALTH_TIMEOUT_MS = 5000;

export async function assertAppReachable(appUrl) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

	try {
		const response = await fetch(`${appUrl}/`, {
			method: "GET",
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`Received HTTP ${response.status}.`);
		}
	} catch (error) {
		throw new Error(
			`Could not reach ${appUrl}. Start the app first (for example: npm run dev:local). ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	} finally {
		clearTimeout(timeout);
	}
}

export async function fetchSessionToken(appUrl) {
	const response = await fetch(`${appUrl}/api/session`, {
		method: "GET",
		headers: {
			"x-mavmeta-bootstrap": "1",
		},
	});

	if (!response.ok) {
		throw new Error(
			`Session bootstrap failed (${response.status}) at ${appUrl}/api/session. Make sure MavMeta is running via npm run dev:local.`,
		);
	}

	const payload = await response.json();
	const token = payload?.token?.trim();
	if (!token) {
		throw new Error("Session bootstrap failed: backend returned an empty session token.");
	}
	return token;
}

export async function listOrgs({ appUrl, sessionToken }) {
	return requestJson({
		appUrl,
		sessionToken,
		method: "GET",
		pathname: "/api/orgs",
	});
}

export async function setActiveOrg({ appUrl, sessionToken, username }) {
	return requestJson({
		appUrl,
		sessionToken,
		method: "POST",
		pathname: "/api/orgs/active",
		body: { username },
	});
}

export async function resolveOrgContext({ appUrl, sessionToken, orgOverride }) {
	const orgList = await listOrgs({ appUrl, sessionToken });
	const orgs = Array.isArray(orgList?.orgs) ? orgList.orgs : [];
	if (orgs.length === 0) {
		throw new Error("No authenticated orgs were found. Authenticate an org in MavMeta before crawling.");
	}

	if (!orgOverride) {
		const activeOrg = orgList.activeOrg ?? orgs[0];
		if (!activeOrg?.username) {
			throw new Error("Could not resolve the active org from /api/orgs.");
		}
		return {
			orgAlias: activeOrg.alias ?? null,
			orgUsername: activeOrg.username,
		};
	}

	const match = orgs.find((org) => org.alias === orgOverride || org.username === orgOverride);
	if (!match) {
		throw new Error(
			`Org "${orgOverride}" was not found in local auth. Pass a valid alias/username or omit --org.`,
		);
	}

	await setActiveOrg({ appUrl, sessionToken, username: match.username });

	return {
		orgAlias: match.alias ?? null,
		orgUsername: match.username,
	};
}

export async function apiRequest({ appUrl, sessionToken, method, pathname, body }) {
	return requestJson({ appUrl, sessionToken, method, pathname, body });
}

async function requestJson({ appUrl, sessionToken, method, pathname, body }) {
	const response = await fetch(`${appUrl}${pathname}`, {
		method,
		headers: {
			"x-mavmeta-session": sessionToken,
			"content-type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});

	if (!response.ok) {
		let message = `Request failed (${response.status})`;
		try {
			const payload = await response.json();
			if (payload?.message) {
				message = payload.message;
			}
		} catch {
			// keep fallback message
		}
		throw new Error(message);
	}

	return response.json();
}
