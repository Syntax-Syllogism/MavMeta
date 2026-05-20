import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RestExplorer from "./RestExplorer.svelte";
import { backendClient } from "../backend/backend-client";
import type { OrgSummary } from "../../shared/org";

vi.mock("../backend/backend-client", () => ({
	backendClient: {
		executeRestRequest: vi.fn(),
	},
}));

const mockedClient = vi.mocked(backendClient);

const productionOrg: OrgSummary = {
	alias: "my-prod",
	username: "user@prod.example.com",
	environment: "production",
	isDefault: true,
	authStatus: "connected",
};

const sandboxOrg: OrgSummary = {
	alias: "my-sandbox",
	username: "user@sandbox.example.com",
	environment: "sandbox",
	isDefault: false,
	authStatus: "connected",
};

const successResponse = {
	status: 200,
	headers: { "content-type": "application/json" },
	body: { MaxBatchSize: 200 },
	isJson: true,
	durationMs: 42,
};

describe("RestExplorer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows empty state when no active org", () => {
		render(RestExplorer, { activeOrg: undefined, apiVersion: "62.0" });

		expect(screen.getByText(/select an active org/i)).toBeTruthy();
		expect(screen.queryByRole("button", { name: /send/i })).toBeNull();
	});

	it("renders request form when org is active", () => {
		render(RestExplorer, { activeOrg: sandboxOrg, apiVersion: "62.0" });

		expect(screen.getByRole("button", { name: /send/i })).toBeTruthy();
		expect(screen.getByRole("combobox", { name: /http method/i })).toBeTruthy();
		expect(screen.getByLabelText(/request path/i)).toBeTruthy();
	});

	it("displays REST Requests in header", () => {
		render(RestExplorer, { activeOrg: sandboxOrg, apiVersion: "62.0" });

		expect(screen.getByText("REST Requests")).toBeTruthy();
	});

	it("pre-fills path with api version", () => {
		render(RestExplorer, { activeOrg: sandboxOrg, apiVersion: "62.0" });

		const pathInput = screen.getByLabelText<HTMLInputElement>(/request path/i);
		expect(pathInput.value).toContain("v62.0");
	});

	it("sends GET request without showing confirmation", async () => {
		mockedClient.executeRestRequest.mockResolvedValue(successResponse);
		render(RestExplorer, { activeOrg: sandboxOrg, apiVersion: "62.0" });

		const pathInput = screen.getByLabelText(/request path/i);
		fireEvent.input(pathInput, { target: { value: "/services/data/v62.0/limits" } });

		fireEvent.click(screen.getByRole("button", { name: /send/i }));

		await waitFor(() => {
			expect(mockedClient.executeRestRequest).toHaveBeenCalledWith(
				expect.objectContaining({ method: "GET", path: "/services/data/v62.0/limits" }),
			);
		});
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("shows confirmation modal for POST on sandbox org", async () => {
		render(RestExplorer, { activeOrg: sandboxOrg, apiVersion: "62.0" });

		const methodSelect = screen.getByRole("combobox", { name: /http method/i });
		fireEvent.change(methodSelect, { target: { value: "POST" } });

		fireEvent.click(screen.getByRole("button", { name: /send/i }));

		await waitFor(() => {
			expect(screen.getByRole("dialog")).toBeTruthy();
		});
		expect(mockedClient.executeRestRequest).not.toHaveBeenCalled();
	});

	it("shows typed confirmation for POST on production org", async () => {
		render(RestExplorer, { activeOrg: productionOrg, apiVersion: "62.0" });

		const methodSelect = screen.getByRole("combobox", { name: /http method/i });
		fireEvent.change(methodSelect, { target: { value: "POST" } });

		fireEvent.click(screen.getByRole("button", { name: /send/i }));

		await waitFor(() => {
			expect(screen.getByText(/production org/i)).toBeTruthy();
			expect(screen.getByText(/type the org name/i)).toBeTruthy();
		});
	});

	it("disables submit in production confirmation until phrase matches", async () => {
		render(RestExplorer, { activeOrg: productionOrg, apiVersion: "62.0" });

		const methodSelect = screen.getByRole("combobox", { name: /http method/i });
		fireEvent.change(methodSelect, { target: { value: "DELETE" } });
		fireEvent.click(screen.getByRole("button", { name: /send/i }));

		await waitFor(() => screen.getByRole("dialog"));

		const sendButton = screen.getByRole<HTMLButtonElement>("button", { name: /send delete/i });
		expect(sendButton.disabled).toBe(true);

		const confirmInput = screen.getByPlaceholderText("my-prod");
		fireEvent.input(confirmInput, { target: { value: "my-prod" } });

		await waitFor(() => {
			expect(screen.getByRole<HTMLButtonElement>("button", { name: /send delete/i }).disabled).toBe(false);
		});
	});

	it("sends request after non-production confirmation", async () => {
		mockedClient.executeRestRequest.mockResolvedValue(successResponse);
		render(RestExplorer, { activeOrg: sandboxOrg, apiVersion: "62.0" });

		const methodSelect = screen.getByRole("combobox", { name: /http method/i });
		fireEvent.change(methodSelect, { target: { value: "POST" } });
		fireEvent.click(screen.getByRole("button", { name: /send/i }));

		await waitFor(() => screen.getByRole("dialog"));
		fireEvent.click(screen.getByRole("button", { name: /send post/i }));

		await waitFor(() => {
			expect(mockedClient.executeRestRequest).toHaveBeenCalledWith(
				expect.objectContaining({ method: "POST", username: sandboxOrg.username }),
			);
		});
	});

	it("renders JSON response after successful request", async () => {
		mockedClient.executeRestRequest.mockResolvedValue(successResponse);
		render(RestExplorer, { activeOrg: sandboxOrg, apiVersion: "62.0" });

		fireEvent.click(screen.getByRole("button", { name: /send/i }));

		await waitFor(() => {
			expect(screen.getByLabelText(/response/i)).toBeTruthy();
			expect(screen.getByLabelText(/status 200/i)).toBeTruthy();
		});
	});

	it("shows error without clearing the form on failure", async () => {
		mockedClient.executeRestRequest.mockRejectedValue(new Error("Network error"));
		render(RestExplorer, { activeOrg: sandboxOrg, apiVersion: "62.0" });

		const pathInput = screen.getByLabelText<HTMLInputElement>(/request path/i);
		fireEvent.input(pathInput, { target: { value: "/services/data/v62.0/limits" } });
		fireEvent.click(screen.getByRole("button", { name: /send/i }));

		await waitFor(() => {
			expect(screen.getByRole("alert")).toBeTruthy();
			expect(screen.getByText(/network error/i)).toBeTruthy();
		});

		const pathAfterError = screen.getByLabelText<HTMLInputElement>(/request path/i);
		expect(pathAfterError.value).toBe("/services/data/v62.0/limits");
	});

	it("adds entry to history after successful request", async () => {
		mockedClient.executeRestRequest.mockResolvedValue(successResponse);
		render(RestExplorer, { activeOrg: sandboxOrg, apiVersion: "62.0" });

		fireEvent.click(screen.getByRole("button", { name: /send/i }));

		await waitFor(() => {
			expect(screen.getByLabelText(/request history/i)).toBeTruthy();
		});
	});

	it("restores method and path when history entry is clicked", async () => {
		mockedClient.executeRestRequest.mockResolvedValue(successResponse);
		render(RestExplorer, { activeOrg: sandboxOrg, apiVersion: "62.0" });

		const pathInput = screen.getByLabelText<HTMLInputElement>(/request path/i);
		fireEvent.input(pathInput, { target: { value: "/services/data/v62.0/limits" } });
		fireEvent.click(screen.getByRole("button", { name: /send/i }));

		await waitFor(() => screen.getByLabelText(/request history/i));

		fireEvent.input(pathInput, { target: { value: "/services/data/v62.0/sobjects" } });

		const historyButton = screen.getByRole("button", { name: /\/services\/data\/v62\.0\/limits/i });
		fireEvent.click(historyButton);

		expect(
			screen.getByLabelText<HTMLInputElement>(/request path/i).value,
		).toBe("/services/data/v62.0/limits");
	});

	it("deletes a single history entry with no confirmation", async () => {
		mockedClient.executeRestRequest.mockResolvedValue(successResponse);
		render(RestExplorer, { activeOrg: sandboxOrg, apiVersion: "62.0" });

		fireEvent.click(screen.getByRole("button", { name: /send/i }));

		await waitFor(() => {
			expect(screen.getByLabelText(/request history/i)).toBeTruthy();
		});

		fireEvent.click(screen.getByRole("button", { name: /delete history entry/i }));

		expect(screen.queryByLabelText(/request history/i)).toBeNull();
	});
});
