import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import type { OrgSummary } from "../../shared/org";
import OrgDirectory from "./OrgDirectory.svelte";

describe("OrgDirectory", () => {
	const connectedOrg: OrgSummary = {
		username: "user@example.com",
		alias: "my-org",
		environment: "production",
		isDefault: true,
		authStatus: "connected",
	};

	const sandboxOrg: OrgSummary = {
		username: "sandbox@example.com",
		alias: "sandbox-org",
		environment: "sandbox",
		isDefault: false,
		authStatus: "connected",
	};

	const defaultProps = {
		orgs: [connectedOrg, sandboxOrg],
		activeOrg: connectedOrg,
		isLoadingOrgs: false,
		authLoginUrl: "https://login.salesforce.com",
		authAlias: "",
		isAuthorizing: false,
		activeAction: undefined,
		onRefreshOrgs: vi.fn(),
		onAuthOrg: vi.fn(),
		onOpenOrg: vi.fn(),
		onSetActiveOrg: vi.fn(),
		onRefreshOrgStatus: vi.fn(),
		onReauthOrg: vi.fn(),
		onStartAliasEdit: vi.fn(),
		onStartScratchDelete: vi.fn(),
		onLogoutOrg: vi.fn(),
	};

	it("allows only one open action menu at a time", async () => {
		const { container } = render(OrgDirectory, defaultProps);

		const summaries = container.querySelectorAll("details summary");
		const firstMenuButton = summaries[0];
		const secondMenuButton = summaries[1];

		await fireEvent.click(firstMenuButton);
		expect(firstMenuButton.parentElement?.hasAttribute("open")).toBe(true);

		await fireEvent.click(secondMenuButton);
		await waitFor(() => {
			expect(firstMenuButton.parentElement?.hasAttribute("open")).toBe(false);
		});
		expect(secondMenuButton.parentElement?.hasAttribute("open")).toBe(true);
	});

	it("keeps full org identity values available on truncated links", async () => {
		const longOrg: OrgSummary = {
			...connectedOrg,
			alias: "very-long-alias-that-needs-to-be-truncated",
			username: "very-long-username-that-needs-to-be-truncated@example.com",
		};

		render(OrgDirectory, {
			...defaultProps,
			orgs: [longOrg],
			activeOrg: longOrg,
		});

		const aliasButton = await screen.findByRole("button", {
			name: longOrg.alias,
		});
		const usernameButton = screen.getByRole("button", {
			name: longOrg.username,
		});

		expect(aliasButton.getAttribute("title")).toBe(longOrg.alias);
		expect(usernameButton.getAttribute("title")).toBe(longOrg.username);
		expect(aliasButton.classList.contains("org-link")).toBe(true);
		expect(usernameButton.classList.contains("username-link")).toBe(true);
	});

	it("reauthorizes an org from the row actions menu", async () => {
		const { container } = render(OrgDirectory, defaultProps);

		const firstMenuSummary = container.querySelector("details summary");
		if (!firstMenuSummary) throw new Error("Missing actions menu");
		await fireEvent.click(firstMenuSummary);
		const reauthButtons = screen.getAllByRole("button", { name: "Reauthorize" });
		await fireEvent.click(reauthButtons[0]);

		expect(defaultProps.onReauthOrg).toHaveBeenCalledWith(connectedOrg);
	});

	it("shows trial expiration and falls back to n/a when not scratch", async () => {
		const scratchOrg: OrgSummary = {
			username: "scratch@example.com",
			alias: "scratch-org",
			environment: "scratch",
			trialExpirationDate: "2026-06-01T00:00:00.000Z",
			isDefault: false,
			authStatus: "connected",
		};
		render(OrgDirectory, {
			...defaultProps,
			orgs: [connectedOrg, scratchOrg],
			activeOrg: connectedOrg,
		});

		expect(await screen.findByText("Trial Expiration")).toBeTruthy();
		expect(screen.getAllByText("n/a").length).toBeGreaterThan(0);
		expect(
			screen.getByText(new Date("2026-06-01T00:00:00.000Z").toLocaleDateString()),
		).toBeTruthy();
	});
});
