import {
	AuthInfo,
	AuthRemover,
	Org,
	WebOAuthServer,
	type OrgAuthorization,
} from "@salesforce/core";

import type {
	AuthOrgRequest,
	OrgActionResponse,
	OrgListResponse,
	OrgSummary,
	OrgTarget,
	SetAliasRequest,
} from "../shared/org";
import { ActiveOrgStore, type ActiveOrgStoreApi } from "./active-org-store";
import { ApiError } from "./api-error";
import { openInSystemBrowser } from "./system-browser";

export type OrgServiceApi = {
	listOrgs(): Promise<OrgListResponse>;
	setActiveOrg(target: OrgTarget): Promise<OrgActionResponse>;
	authOrg(request: AuthOrgRequest): Promise<OrgActionResponse>;
	reauthOrg(target: OrgTarget): Promise<OrgActionResponse>;
	openOrg(target: OrgTarget): Promise<OrgActionResponse>;
	logoutOrg(target: OrgTarget): Promise<OrgActionResponse>;
	setAlias(request: SetAliasRequest): Promise<OrgActionResponse>;
	refreshOrgStatus(target: OrgTarget): Promise<OrgActionResponse>;
	deleteScratchOrg(target: OrgTarget): Promise<OrgActionResponse>;
};

export class OrgService implements OrgServiceApi {
	private oauthInFlight = false;
	private readonly trialExpirationCache = new Map<
		string,
		{
			value: string | undefined;
			expiresAt: number;
		}
	>();
	private readonly trialExpirationInflight = new Map<string, Promise<string | undefined>>();
	private readonly trialExpirationCacheTtlMs: number;

	constructor(
		private readonly activeOrgStore: ActiveOrgStoreApi = new ActiveOrgStore(),
		options?: { trialExpirationCacheTtlMs?: number },
	) {
		this.trialExpirationCacheTtlMs = options?.trialExpirationCacheTtlMs ?? 5 * 60 * 1000;
	}

	async listOrgs(): Promise<OrgListResponse> {
		const authorizations = await AuthInfo.listAllAuthorizations();
		const orgs = (
			await Promise.all(authorizations.map((authorization) => this.toOrgSummary(authorization)))
		).sort((left, right) =>
			(left.alias ?? left.username).localeCompare(right.alias ?? right.username),
		);
		const activeUsername = this.resolveActiveUsername(orgs);
		const activeOrg = activeUsername
			? orgs.find((org) => org.username === activeUsername)
			: undefined;

		return {
			orgs,
			activeOrg,
		};
	}

	async setActiveOrg(target: OrgTarget): Promise<OrgActionResponse> {
		const authInfo = await AuthInfo.create({ username: target.username });
		const username = authInfo.getUsername();
		this.activeOrgStore.setActiveUsername(username);

		return {
			org: await this.getOrg(username),
			message: `${username} is now active in MavMeta.`,
		};
	}

	async authOrg(request: AuthOrgRequest): Promise<OrgActionResponse> {
		return this.runOauth({
			loginUrl: request.loginUrl,
			alias: request.alias,
		});
	}

	async reauthOrg(target: OrgTarget): Promise<OrgActionResponse> {
		const existingAuth = await AuthInfo.create({ username: target.username });
		const fields = existingAuth.getFields();
		return this.runOauth({
			loginUrl: fields.loginUrl ?? fields.instanceUrl,
			usernameHint: target.username,
			alias: fields.alias,
		});
	}

	async openOrg(target: OrgTarget): Promise<OrgActionResponse> {
		const org = await Org.create({ aliasOrUsername: target.username });
		const frontDoorUrl = await org.getFrontDoorUrl();
		const urlToOpen = withStartPath(frontDoorUrl, target.startPath);
		await openInSystemBrowser(urlToOpen);

		return {
			org: await this.getOrg(target.username),
			message: `${target.username} opened in your browser.`,
		};
	}

	async logoutOrg(target: OrgTarget): Promise<OrgActionResponse> {
		const remover = await AuthRemover.create();
		await remover.removeAuth(target.username);

		if (this.activeOrgStore.getActiveUsername() === target.username) {
			this.activeOrgStore.clear();
		}

		return {
			message: `${target.username} was removed from local Salesforce auth.`,
		};
	}

	async setAlias(request: SetAliasRequest): Promise<OrgActionResponse> {
		const authInfo = await AuthInfo.create({ username: request.target.username });
		await authInfo.setAlias(request.alias);

		return {
			org: await this.getOrg(request.target.username),
			message: `Alias "${request.alias}" set for ${request.target.username}.`,
		};
	}

	async refreshOrgStatus(target: OrgTarget): Promise<OrgActionResponse> {
		const org = await Org.create({ aliasOrUsername: target.username });
		await org.refreshAuth();
		await org.updateLocalInformation();

		return {
			org: await this.getOrg(target.username),
			message: `${target.username} auth status refreshed.`,
		};
	}

	async deleteScratchOrg(target: OrgTarget): Promise<OrgActionResponse> {
		const org = await Org.create({ aliasOrUsername: target.username });
		const isScratch = await org.determineIfScratch();

		if (!isScratch) {
			throw new Error(`Only scratch orgs can be deleted. ${target.username} is not a scratch org.`);
		}

		try {
			await org.delete();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!message.includes("expired or deleted")) {
				throw error;
			}
		}

		if (this.activeOrgStore.getActiveUsername() === target.username) {
			this.activeOrgStore.clear();
		}

		return {
			message: `Scratch org ${target.username} was deleted.`,
		};
	}

	private async getOrg(username: string): Promise<OrgSummary> {
		const response = await this.listOrgs();
		const org = response.orgs.find((candidate) => candidate.username === username);

		if (!org) {
			throw new Error(`No Salesforce auth found for ${username}.`);
		}

		return org;
	}

	private async runOauth(options: {
		loginUrl?: string;
		usernameHint?: string;
		alias?: string;
	}): Promise<OrgActionResponse> {
		if (this.oauthInFlight) {
			throw new ApiError(
				409,
				"AUTH_IN_PROGRESS",
				"An org authorization is already in progress. Finish the browser login or wait for it to time out before starting another.",
			);
		}

		this.oauthInFlight = true;

		try {
			const oauthServer = await WebOAuthServer.create({
				oauthConfig: {
					loginUrl: normalizeLoginUrl(options.loginUrl ?? ""),
				},
			});

			await oauthServer.start();
			await openInSystemBrowser(oauthServer.getAuthorizationUrl());

			const authInfo = await oauthServer.authorizeAndSave();
			if (options.alias?.trim()) {
				await authInfo.setAlias(options.alias.trim());
			}

			const username = authInfo.getUsername();
			this.activeOrgStore.setActiveUsername(username);

			const messagePrefix = options.usernameHint
				? `${options.usernameHint} reauthorized as ${username}`
				: `${username} authenticated`;

			return {
				org: await this.getOrg(username),
				message: `${messagePrefix}.`,
			};
		} catch (error) {
			throw toAuthApiError(error);
		} finally {
			this.oauthInFlight = false;
		}
	}

	private resolveActiveUsername(orgs: OrgSummary[]): string | undefined {
		const activeUsername = this.activeOrgStore.getActiveUsername();
		if (activeUsername && orgs.some((org) => org.username === activeUsername)) {
			return activeUsername;
		}

		if (activeUsername) {
			this.activeOrgStore.clear();
		}

		const defaultOrg = orgs.find((org) => org.isDefault);
		if (defaultOrg) {
			this.activeOrgStore.setActiveUsername(defaultOrg.username);
			return defaultOrg.username;
		}

		return orgs[0]?.username;
	}

	private async toOrgSummary(authorization: OrgAuthorization): Promise<OrgSummary> {
		if (!authorization.isScratchOrg) {
			return toOrgSummary(authorization);
		}
		const trialExpirationDate = await this.lookupTrialExpirationDate(authorization.username);
		return toOrgSummary(authorization, trialExpirationDate);
	}

	private async lookupTrialExpirationDate(username: string): Promise<string | undefined> {
		const now = Date.now();
		const cached = this.trialExpirationCache.get(username);
		if (cached && cached.expiresAt > now) {
			return cached.value;
		}

		const inflight = this.trialExpirationInflight.get(username);
		if (inflight) {
			return inflight;
		}

		const fetchPromise = (async () => {
			try {
				const org = await Org.create({ aliasOrUsername: username });
				const connection = org.getConnection();
				const response = await (connection.query(
					"SELECT TrialExpirationDate FROM Organization",
				) as unknown as Promise<{
					records?: Array<{ TrialExpirationDate?: string | null }>;
				}>);
				const value = response.records?.[0]?.TrialExpirationDate;
				const normalized = typeof value === "string" && value.trim() ? value : undefined;
				this.trialExpirationCache.set(username, {
					value: normalized,
					expiresAt: Date.now() + this.trialExpirationCacheTtlMs,
				});
				return normalized;
			} catch {
				this.trialExpirationCache.set(username, {
					value: undefined,
					expiresAt: Date.now() + this.trialExpirationCacheTtlMs,
				});
				return undefined;
			} finally {
				this.trialExpirationInflight.delete(username);
			}
		})();

		this.trialExpirationInflight.set(username, fetchPromise);

		return fetchPromise;
	}
}

function toOrgSummary(authorization: OrgAuthorization, trialExpirationDate?: string): OrgSummary {
	return {
		alias: authorization.aliases?.[0] ?? undefined,
		username: authorization.username,
		orgId: authorization.orgId,
		instanceUrl: authorization.instanceUrl,
		...(trialExpirationDate ? { trialExpirationDate } : {}),
		environment: authorization.isScratchOrg
			? "scratch"
			: authorization.isSandbox
				? "sandbox"
				: authorization.isDevHub
					? "developer"
					: "production",
		isDefault:
			authorization.configs?.includes("target-org") === true ||
			authorization.configs?.includes("defaultusername") === true,
		authStatus:
			authorization.isExpired === true
				? "expired"
				: authorization.isExpired === false
					? "connected"
					: "unknown",
	};
}

function normalizeLoginUrl(loginUrl: string): string {
	const trimmedLoginUrl = loginUrl.trim();
	if (!trimmedLoginUrl) {
		return "https://login.salesforce.com";
	}
	if (trimmedLoginUrl.startsWith("http://") || trimmedLoginUrl.startsWith("https://")) {
		return trimmedLoginUrl;
	}

	return `https://${trimmedLoginUrl}`;
}

function toAuthApiError(error: unknown): unknown {
	if (error instanceof ApiError) {
		return error;
	}
	if (isOauthPortInUseError(error)) {
		return new ApiError(
			409,
			"AUTH_PORT_IN_USE",
			"Salesforce OAuth could not start because localhost port 1717 is already in use. Close any other Salesforce CLI auth window/process using that port, then try Auth Org again.",
		);
	}
	return error;
}

function isOauthPortInUseError(error: unknown): boolean {
	return (
		error instanceof Error &&
		error.message.includes("Cannot start the OAuth redirect server on port 1717")
	);
}

function withStartPath(frontDoorUrl: string, startPath?: string): string {
	if (!startPath) return frontDoorUrl;
	const trimmedPath = startPath.trim();
	if (!trimmedPath.startsWith("/")) return frontDoorUrl;
	const url = new URL(frontDoorUrl);
	url.searchParams.set("retURL", trimmedPath);
	return url.toString();
}
