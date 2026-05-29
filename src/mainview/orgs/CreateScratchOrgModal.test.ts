import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

import CreateScratchOrgModal from "./CreateScratchOrgModal.svelte";
import type { OrgSummary } from "../../shared/org";

const backendMocks = vi.hoisted(() => ({
	startScratchOrgCreate: vi.fn(),
	getScratchOrgCreateStatus: vi.fn(),
	listScratchOrgSnapshots: vi.fn(),
}));

vi.mock("../backend/backend-client", () => ({
	backendClient: {
		startScratchOrgCreate: backendMocks.startScratchOrgCreate,
		getScratchOrgCreateStatus: backendMocks.getScratchOrgCreateStatus,
		listScratchOrgSnapshots: backendMocks.listScratchOrgSnapshots,
	},
}));

function makeOrg(overrides: Partial<OrgSummary> = {}): OrgSummary {
	return {
		username: "hub@example.com",
		environment: "dev-hub",
		isDefault: false,
		authStatus: "connected",
		alias: "my-hub",
		...overrides,
	};
}

const devHubOrg = makeOrg({
	username: "hub@example.com",
	alias: "my-hub",
	environment: "dev-hub",
});
const sandboxOrg = makeOrg({
	username: "sandbox@example.com",
	alias: "sandbox",
	environment: "sandbox",
});

function renderModal(
	props: {
		orgs?: OrgSummary[];
		onClose?: () => void;
		onComplete?: (username: string) => void | Promise<void>;
		onSetActive?: (username: string) => void | Promise<void>;
	} = {},
) {
	return render(CreateScratchOrgModal, {
		orgs: props.orgs ?? [devHubOrg],
		onClose: props.onClose ?? vi.fn(),
		onComplete: props.onComplete ?? vi.fn(),
		onSetActive: props.onSetActive ?? vi.fn(),
	});
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

beforeEach(() => {
	backendMocks.listScratchOrgSnapshots.mockResolvedValue({
		eligibility: "enabled",
		snapshots: [
			{
				id: "snap-1",
				snapshotName: "baseline",
				status: "Active",
				createdDate: "2026-05-01T00:00:00.000Z",
				expirationDate: "2099-06-01T00:00:00.000Z",
				description: "Baseline snapshot",
			},
		],
	});
});

describe("CreateScratchOrgModal", () => {
	describe("step navigation", () => {
		it("starts on the Dev Hub step", () => {
			const { getByText } = renderModal();
			expect(getByText("Dev Hub")).toBeTruthy();
		});

		it("Next button is disabled when no dev hub is selected", () => {
			const { getByRole } = renderModal();
			const nextButton = getByRole("button", { name: "Next" }) as HTMLButtonElement;
			expect(nextButton.disabled).toBe(true);
		});

		it("advances to Settings step after selecting a dev hub and clicking Next", async () => {
			const { getByText, getByRole } = renderModal();

			fireEvent.click(getByText("my-hub"));
			await waitFor(() => {
				const nextButton = getByRole("button", { name: "Next" }) as HTMLButtonElement;
				expect(nextButton.disabled).toBe(false);
			});
			fireEvent.click(getByRole("button", { name: "Next" }));

			await waitFor(() => {
				expect(getByText(/Creation Method/)).toBeTruthy();
			});
		});

		it("navigates back from Settings to Dev Hub", async () => {
			const { getByText, getByRole } = renderModal();

			fireEvent.click(getByText("my-hub"));
			fireEvent.click(getByRole("button", { name: "Next" }));

			await waitFor(() => getByText(/Creation Method/));
			fireEvent.click(getByRole("button", { name: "Back" }));

			await waitFor(() => {
				expect(getByText("Detected Dev Hubs")).toBeTruthy();
			});
		});

		it("advances from Settings to Definition step", async () => {
			const { getByText, getByRole } = renderModal();

			fireEvent.click(getByText("my-hub"));
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Creation Method/));
			fireEvent.click(getByRole("button", { name: "Next" }));

			await waitFor(() => {
				expect(getByText(/Scratch Definition/)).toBeTruthy();
			});
		});

		it("navigates back from Definition to Settings", async () => {
			const { getByText, getByRole } = renderModal();

			fireEvent.click(getByText("my-hub"));
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Creation Method/));
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Scratch Definition/));
			fireEvent.click(getByRole("button", { name: "Back" }));

			await waitFor(() => {
				expect(getByText(/Creation Method/)).toBeTruthy();
			});
		});
	});

	describe("Create button disabled state", () => {
		async function reachDefinitionStep() {
			const result = renderModal();
			const { getByText, getByRole } = result;
			fireEvent.click(getByText("my-hub"));
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Creation Method/));
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Scratch Definition/));
			return result;
		}

		it("Create button is enabled with valid JSON", async () => {
			const { getByRole } = await reachDefinitionStep();
			const createButton = getByRole("button", { name: "Create Scratch Org" }) as HTMLButtonElement;
			expect(createButton.disabled).toBe(false);
		});

		it("Create button is disabled when JSON is invalid", async () => {
			const { getByRole, getByLabelText } = await reachDefinitionStep();
			const textarea = getByLabelText("Scratch org definition JSON");
			fireEvent.input(textarea, { target: { value: "{ invalid json }" } });

			await waitFor(() => {
				const createButton = getByRole("button", {
					name: "Create Scratch Org",
				}) as HTMLButtonElement;
				expect(createButton.disabled).toBe(true);
			});
		});

		it("shows error text when JSON is invalid", async () => {
			const { getByLabelText, container } = await reachDefinitionStep();
			const textarea = getByLabelText("Scratch org definition JSON");
			fireEvent.input(textarea, { target: { value: "not json" } });

			await waitFor(() => {
				const errorSpan = container.querySelector(".error-text");
				expect(errorSpan).toBeTruthy();
				expect(errorSpan?.textContent?.length).toBeGreaterThan(0);
			});
		});

		it("Create button re-enables when JSON is corrected", async () => {
			const { getByRole, getByLabelText } = await reachDefinitionStep();
			const textarea = getByLabelText("Scratch org definition JSON");

			fireEvent.input(textarea, { target: { value: "{ bad }" } });
			await waitFor(() =>
				expect(
					(getByRole("button", { name: "Create Scratch Org" }) as HTMLButtonElement).disabled,
				).toBe(true),
			);

			fireEvent.input(textarea, { target: { value: '{ "edition": "Developer" }' } });
			await waitFor(() =>
				expect(
					(getByRole("button", { name: "Create Scratch Org" }) as HTMLButtonElement).disabled,
				).toBe(false),
			);
		});
	});

	describe("successful creation", () => {
		beforeEach(() => {
			vi.useFakeTimers();
			backendMocks.startScratchOrgCreate.mockResolvedValue({ operationId: "op-123" });
			backendMocks.getScratchOrgCreateStatus.mockResolvedValue({
				operationId: "op-123",
				status: "succeeded",
				message: "Scratch org test@scratch.com created successfully.",
				username: "test@scratch.com",
				warnings: [],
			});
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		async function reachCreateAndStart() {
			const callbacks = {
				onClose: vi.fn(),
				onComplete: vi.fn(),
				onSetActive: vi.fn(),
			};
			const result = render(CreateScratchOrgModal, {
				orgs: [devHubOrg],
				...callbacks,
			});
			const { getByText, getByRole } = result;

			fireEvent.click(getByText("my-hub"));
			await waitFor(() =>
				expect((getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false),
			);
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Creation Method/));
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByRole("button", { name: "Create Scratch Org" }));
			fireEvent.click(getByRole("button", { name: "Create Scratch Org" }));
			await tick();

			return { ...result, ...callbacks };
		}

		async function advancePollCycle() {
			await vi.runAllTimersAsync();
			await tick();
		}

		it("shows creation progress after clicking Create", async () => {
			const { container } = await reachCreateAndStart();

			await waitFor(() => {
				expect(container.querySelector(".create-progress")).toBeTruthy();
			});
		});

		it("shows success result with created username after polling", async () => {
			const { getByText } = await reachCreateAndStart();

			await advancePollCycle();

			await waitFor(() => {
				expect(getByText("test@scratch.com")).toBeTruthy();
			});
		});

		it("offers Set as Active Org button after success", async () => {
			const { getByRole } = await reachCreateAndStart();

			await advancePollCycle();

			await waitFor(() => {
				expect(getByRole("button", { name: "Set as Active Org" })).toBeTruthy();
			});
		});

		it("calls onSetActive when Set as Active Org is clicked", async () => {
			const { getByRole, onSetActive } = await reachCreateAndStart();

			await advancePollCycle();
			await waitFor(() => getByRole("button", { name: "Set as Active Org" }));
			fireEvent.click(getByRole("button", { name: "Set as Active Org" }));

			await waitFor(() => {
				expect(onSetActive).toHaveBeenCalledWith("test@scratch.com");
			});
		});

		it("calls onComplete when Done is clicked after success", async () => {
			const { getByRole, onComplete } = await reachCreateAndStart();

			await advancePollCycle();
			await waitFor(() => getByRole("button", { name: "Done" }));
			fireEvent.click(getByRole("button", { name: "Done" }));

			await waitFor(() => {
				expect(onComplete).toHaveBeenCalledWith("test@scratch.com");
			});
		});
	});

	describe("failed creation", () => {
		beforeEach(() => {
			vi.useFakeTimers();
			backendMocks.startScratchOrgCreate.mockResolvedValue({ operationId: "op-fail" });
			backendMocks.getScratchOrgCreateStatus.mockResolvedValue({
				operationId: "op-fail",
				status: "failed",
				message: "Org creation limit reached.",
			});
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		async function reachFailedCreate() {
			const callbacks = {
				onClose: vi.fn(),
				onComplete: vi.fn(),
				onSetActive: vi.fn(),
			};
			const result = render(CreateScratchOrgModal, {
				orgs: [devHubOrg],
				...callbacks,
			});
			const { getByText, getByRole } = result;

			fireEvent.click(getByText("my-hub"));
			await waitFor(() =>
				expect((getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false),
			);
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Creation Method/));
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByRole("button", { name: "Create Scratch Org" }));
			fireEvent.click(getByRole("button", { name: "Create Scratch Org" }));
			await tick();
			await vi.runAllTimersAsync();
			await tick();

			return { ...result, ...callbacks };
		}

		it("shows error message after failed creation", async () => {
			const { getByText } = await reachFailedCreate();

			await waitFor(() => {
				expect(getByText("Org creation limit reached.")).toBeTruthy();
			});
		});

		it("preserves wizard inputs by offering Back to Definition after failure", async () => {
			const { getByRole } = await reachFailedCreate();

			await waitFor(() => {
				expect(getByRole("button", { name: "Back to Definition" })).toBeTruthy();
			});
		});

		it("returns to definition step from Back to Definition button", async () => {
			const { getByRole, getByText } = await reachFailedCreate();

			await waitFor(() => getByRole("button", { name: "Back to Definition" }));
			fireEvent.click(getByRole("button", { name: "Back to Definition" }));

			await waitFor(() => {
				expect(getByText(/Scratch Definition/)).toBeTruthy();
			});
		});
	});

	describe("dev hub display", () => {
		it("shows detected dev hubs separately from other orgs", () => {
			const { getByText } = renderModal({ orgs: [devHubOrg, sandboxOrg] });
			expect(getByText("Detected Dev Hubs")).toBeTruthy();
			expect(getByText(/Dev Hub status unknown/)).toBeTruthy();
		});

		it("shows only dev hub section when no uncertain orgs present", () => {
			const { getByText, queryByText } = renderModal({ orgs: [devHubOrg] });
			expect(getByText("Detected Dev Hubs")).toBeTruthy();
			expect(queryByText(/Dev Hub status unknown/)).toBeNull();
		});

		it("shows empty hint when no orgs are available", () => {
			const { getByText } = renderModal({ orgs: [] });
			expect(getByText(/No authenticated orgs found/)).toBeTruthy();
		});

		it("calls onClose when Cancel is clicked", () => {
			const onClose = vi.fn();
			const { getByRole } = renderModal({ onClose });
			fireEvent.click(getByRole("button", { name: "Cancel" }));
			expect(onClose).toHaveBeenCalled();
		});
	});

	describe("features default (Part B)", () => {
		async function reachSettingsStep() {
			const result = renderModal();
			const { getByText, getByRole } = result;
			fireEvent.click(getByText("my-hub"));
			await waitFor(() =>
				expect((getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false),
			);
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Creation Method/));
			return result;
		}

		it("features list is empty by default on Minimal template", async () => {
			const { container } = await reachSettingsStep();
			const tagList = container.querySelector(".tag-list");
			expect(tagList).toBeNull();
		});

		it("minimal template produces no features key in Step 4 JSON", async () => {
			const { getByText, getByRole, getByLabelText } = await reachSettingsStep();
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Scratch Definition/));
			const textarea = getByLabelText("Scratch org definition JSON") as HTMLTextAreaElement;
			const parsed = JSON.parse(textarea.value) as Record<string, unknown>;
			expect(parsed.features).toBeUndefined();
		});
	});

	describe("settings group picker (Part A)", () => {
		async function reachSettingsStep() {
			const result = renderModal();
			const { getByText, getByRole } = result;
			fireEvent.click(getByText("my-hub"));
			await waitFor(() =>
				expect((getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false),
			);
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Creation Method/));
			return result;
		}

		function clickSettingsAdd(getAllByRole: ReturnType<typeof renderModal>["getAllByRole"]) {
			// Two "Add" buttons on Step 2: first for Features, second for Settings
			const addButtons = getAllByRole("button", { name: "Add" });
			fireEvent.click(addButtons[addButtons.length - 1]);
		}

		it("adding a curated group reveals its sub-key checkboxes", async () => {
			const { container, getAllByRole, getByPlaceholderText } = await reachSettingsStep();
			const settingInput = getByPlaceholderText(/LightningExperienceSettings/);
			fireEvent.input(settingInput, { target: { value: "LightningExperienceSettings" } });
			clickSettingsAdd(getAllByRole);

			await waitFor(() => {
				expect(container.querySelector(".settings-group-card")).toBeTruthy();
				const checkboxes = container.querySelectorAll(".settings-subkeys input[type=checkbox]");
				expect(checkboxes.length).toBeGreaterThan(0);
			});
		});

		it("curated group sub-keys appear in Step 4 JSON after navigating forward", async () => {
			const {
				container,
				getAllByRole,
				getByText,
				getByRole,
				getByLabelText,
				getByPlaceholderText,
			} = await reachSettingsStep();
			const settingInput = getByPlaceholderText(/LightningExperienceSettings/);
			fireEvent.input(settingInput, { target: { value: "LightningExperienceSettings" } });
			clickSettingsAdd(getAllByRole);
			await waitFor(() => container.querySelector(".settings-group-card"));

			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Scratch Definition/));

			const textarea = getByLabelText("Scratch org definition JSON") as HTMLTextAreaElement;
			const parsed = JSON.parse(textarea.value) as Record<string, unknown>;
			const settingsObj = parsed.settings as Record<string, unknown>;
			expect(settingsObj).toBeDefined();
			expect(settingsObj.lightningExperienceSettings).toBeDefined();
		});

		it("free-text group not in curated list is accepted but produces no sub-keys in JSON", async () => {
			const {
				container,
				getAllByRole,
				getByText,
				getByRole,
				getByLabelText,
				getByPlaceholderText,
			} = await reachSettingsStep();
			const settingInput = getByPlaceholderText(/LightningExperienceSettings/);
			fireEvent.input(settingInput, { target: { value: "SomeUnknownSettings" } });
			clickSettingsAdd(getAllByRole);
			await waitFor(() => container.querySelector(".settings-group-hint"));

			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Scratch Definition/));

			const textarea = getByLabelText("Scratch org definition JSON") as HTMLTextAreaElement;
			const parsed = JSON.parse(textarea.value) as Record<string, unknown>;
			expect(parsed.settings).toBeUndefined();
		});
	});

	describe("Step 3→4 JSON staleness (Part C)", () => {
		async function reachDefinitionStep() {
			const result = renderModal();
			const { getByText, getByRole } = result;
			fireEvent.click(getByText("my-hub"));
			await waitFor(() =>
				expect((getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false),
			);
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Creation Method/));
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Scratch Definition/));
			return result;
		}

		it("shows regenerated notice on first entry to Step 4", async () => {
			const { container } = await reachDefinitionStep();
			await waitFor(() => {
				expect(container.querySelector(".wizard-notice")).toBeTruthy();
			});
		});

		it("regenerated notice clears after editing the JSON textarea", async () => {
			const { container, getByLabelText } = await reachDefinitionStep();
			await waitFor(() => container.querySelector(".wizard-notice"));

			const textarea = getByLabelText("Scratch org definition JSON");
			fireEvent.input(textarea, { target: { value: '{ "edition": "Developer" }' } });

			await waitFor(() => {
				expect(container.querySelector(".wizard-notice")).toBeNull();
			});
		});

		it("preserves user edits in Step 4 when Step 3 is not changed between visits", async () => {
			const { getByLabelText, getByRole, getByText } = await reachDefinitionStep();

			const textarea = getByLabelText("Scratch org definition JSON");
			fireEvent.input(textarea, {
				target: { value: '{ "edition": "Enterprise", "custom": true }' },
			});

			fireEvent.click(getByRole("button", { name: "Back" }));
			await waitFor(() => getByText(/Creation Method/));
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Scratch Definition/));

			const textareaAfter = getByLabelText("Scratch org definition JSON") as HTMLTextAreaElement;
			const parsed = JSON.parse(textareaAfter.value) as Record<string, unknown>;
			expect(parsed.custom).toBe(true);
		});

		it("rebuilds JSON and discards user edits when Step 3 changes between visits", async () => {
			const { getByLabelText, getByRole, getByText } = await reachDefinitionStep();

			const textarea = getByLabelText("Scratch org definition JSON");
			fireEvent.input(textarea, {
				target: { value: '{ "edition": "Enterprise", "custom": true }' },
			});

			fireEvent.click(getByRole("button", { name: "Back" }));
			await waitFor(() => getByText(/Creation Method/));

			const orgNameInput = getByRole("textbox", { name: /Org Name/i }) as HTMLInputElement;
			fireEvent.input(orgNameInput, { target: { value: "Changed Org" } });

			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Scratch Definition/));

			const textareaAfter = getByLabelText("Scratch org definition JSON") as HTMLTextAreaElement;
			const parsed = JSON.parse(textareaAfter.value) as Record<string, unknown>;
			expect(parsed.custom).toBeUndefined();
			expect(parsed.orgName).toBe("Changed Org");
		});

		it("shows regenerated notice after Step 3 changes rebuild", async () => {
			const { container, getByLabelText, getByRole, getByText } = await reachDefinitionStep();
			await waitFor(() => container.querySelector(".wizard-notice"));

			const textarea = getByLabelText("Scratch org definition JSON");
			fireEvent.input(textarea, { target: { value: '{ "edition": "Enterprise" }' } });
			await waitFor(() => expect(container.querySelector(".wizard-notice")).toBeNull());

			fireEvent.click(getByRole("button", { name: "Back" }));
			await waitFor(() => getByText(/Creation Method/));

			const orgNameInput = getByRole("textbox", { name: /Org Name/i }) as HTMLInputElement;
			fireEvent.input(orgNameInput, { target: { value: "RebuildOrg" } });

			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Scratch Definition/));

			await waitFor(() => {
				expect(container.querySelector(".wizard-notice")).toBeTruthy();
			});
		});

		it("re-prefills snapshot JSON after switching modes in settings", async () => {
			const { getByRole, getByText, getByLabelText } = await reachDefinitionStep();
			fireEvent.click(getByRole("button", { name: "Back" }));
			await waitFor(() => getByText(/Creation Method/));
			fireEvent.click(getByRole("button", { name: "Org Snapshot (Fast)" }));
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Scratch Definition/));

			const textarea = getByLabelText("Scratch org definition JSON") as HTMLTextAreaElement;
			const parsed = JSON.parse(textarea.value) as Record<string, unknown>;
			expect(parsed.snapshot).toBe("baseline");
			expect(parsed.edition).toBeUndefined();
		});
	});

	describe("progress bar and footer chrome (Part D)", () => {
		it("renders step markers with correct complete/active/upcoming states", async () => {
			const { container, getByText, getByRole } = renderModal();

			const stepMarkers = () => container.querySelectorAll(".step-marker");
			expect(stepMarkers().length).toBe(4);

			const listItems = () => container.querySelectorAll(".cart-stepper li");

			expect(listItems()[0].classList.contains("active")).toBe(true);
			expect(listItems()[0].classList.contains("complete")).toBe(false);

			fireEvent.click(getByText("my-hub"));
			await waitFor(() =>
				expect((getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false),
			);
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Creation Method/));

			expect(listItems()[0].classList.contains("complete")).toBe(true);
			expect(listItems()[1].classList.contains("active")).toBe(true);
		});

		it("footer shows Cancel on Step 1 and Back on subsequent steps", async () => {
			const { getByRole, getByText } = renderModal();
			expect(getByRole("button", { name: "Cancel" })).toBeTruthy();

			fireEvent.click(getByText("my-hub"));
			await waitFor(() =>
				expect((getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false),
			);
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Creation Method/));

			expect(getByRole("button", { name: "Back" })).toBeTruthy();
		});

		it("footer shows Next on Steps 1-2 and Create Scratch Org on Step 3", async () => {
			const { getByRole, getByText } = renderModal();
			expect(getByRole("button", { name: "Next" })).toBeTruthy();

			fireEvent.click(getByText("my-hub"));
			await waitFor(() =>
				expect((getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false),
			);
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Creation Method/));
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Scratch Definition/));

			expect(getByRole("button", { name: "Create Scratch Org" })).toBeTruthy();
		});

		it("header displays step subtitle with current step info", async () => {
			const { container } = renderModal();
			const subtitle = container.querySelector(".cart-title-row p");
			expect(subtitle?.textContent).toMatch(/STEP 1 OF 4/);
			expect(subtitle?.textContent).toMatch(/DEV HUB/);
		});

		it("result step renders large icon and success heading after creation", async () => {
			vi.useFakeTimers();
			backendMocks.startScratchOrgCreate.mockResolvedValue({ operationId: "op-d" });
			backendMocks.getScratchOrgCreateStatus.mockResolvedValue({
				operationId: "op-d",
				status: "succeeded",
				message: "Done",
				username: "res@scratch.com",
				warnings: [],
			});

			const { container, getByText, getByRole } = renderModal();
			fireEvent.click(getByText("my-hub"));
			await waitFor(() =>
				expect((getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false),
			);
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Creation Method/));
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByRole("button", { name: "Create Scratch Org" }));
			fireEvent.click(getByRole("button", { name: "Create Scratch Org" }));
			await tick();
			await vi.runAllTimersAsync();
			await tick();

			await waitFor(() => {
				expect(container.querySelector(".result-icon-large")).toBeTruthy();
				expect(container.querySelector(".deployment-result-summary.success")).toBeTruthy();
			});

			vi.useRealTimers();
		});

		it("result step renders failure state on error", async () => {
			vi.useFakeTimers();
			backendMocks.startScratchOrgCreate.mockResolvedValue({ operationId: "op-f" });
			backendMocks.getScratchOrgCreateStatus.mockResolvedValue({
				operationId: "op-f",
				status: "failed",
				message: "Limit reached.",
			});

			const { container, getByText, getByRole } = renderModal();
			fireEvent.click(getByText("my-hub"));
			await waitFor(() =>
				expect((getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false),
			);
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Creation Method/));
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByRole("button", { name: "Create Scratch Org" }));
			fireEvent.click(getByRole("button", { name: "Create Scratch Org" }));
			await tick();
			await vi.runAllTimersAsync();
			await tick();

			await waitFor(() => {
				expect(container.querySelector(".deployment-result-summary.failed")).toBeTruthy();
			});

			vi.useRealTimers();
		});
	});

	describe("snapshot mode", () => {
		async function reachSettingsStep() {
			const result = renderModal();
			const { getByText, getByRole } = result;
			fireEvent.click(getByText("my-hub"));
			await waitFor(() =>
				expect((getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false),
			);
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => getByText(/Creation Method/));
			return result;
		}

		it("disables snapshot mode with not-enabled tooltip", async () => {
			backendMocks.listScratchOrgSnapshots.mockResolvedValueOnce({
				eligibility: "not-enabled",
				snapshots: [],
			});
			const { getByRole } = await reachSettingsStep();
			const button = getByRole("button", { name: "Org Snapshot (Fast)" }) as HTMLButtonElement;
			expect(button.disabled).toBe(true);
			expect(button.title).toContain("Snapshots are not enabled on this Dev Hub");
		});

		it("disables snapshot mode with empty-state tooltip", async () => {
			backendMocks.listScratchOrgSnapshots.mockResolvedValueOnce({
				eligibility: "enabled",
				snapshots: [],
			});
			const { getByRole } = await reachSettingsStep();
			const button = getByRole("button", { name: "Org Snapshot (Fast)" }) as HTMLButtonElement;
			expect(button.disabled).toBe(true);
			expect(button.title).toContain("No snapshots available for this Dev Hub");
		});

		it("disables snapshot mode with failure tooltip when snapshot fetch fails", async () => {
			backendMocks.listScratchOrgSnapshots.mockRejectedValueOnce(
				new Error("Tooling API unreachable"),
			);
			const { getByRole } = await reachSettingsStep();
			const button = getByRole("button", { name: "Org Snapshot (Fast)" }) as HTMLButtonElement;
			expect(button.disabled).toBe(true);
			expect(button.title).toContain("Tooling API unreachable");
		});

		it("hides standard fields and shows snapshot cards in snapshot mode", async () => {
			const { getByRole, queryByText, getByText } = await reachSettingsStep();
			fireEvent.click(getByRole("button", { name: "Org Snapshot (Fast)" }));
			await waitFor(() => {
				expect(getByText("baseline")).toBeTruthy();
			});
			expect(queryByText("Template")).toBeNull();
			expect(queryByText("Settings")).toBeNull();
		});

		it("shows snapshot advisory banner in definition step", async () => {
			const { getByRole, getByText } = await reachSettingsStep();
			fireEvent.click(getByRole("button", { name: "Org Snapshot (Fast)" }));
			fireEvent.click(getByRole("button", { name: "Next" }));
			await waitFor(() => {
				expect(
					getByText(
						(content) =>
							content.includes("Snapshot mode") &&
							content.includes("advanced edits not recommended"),
					),
				).toBeTruthy();
			});
		});

		it("shows warning glyph for snapshots expiring within 14 days", async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-05-20T12:00:00.000Z"));
			backendMocks.listScratchOrgSnapshots.mockResolvedValueOnce({
				eligibility: "enabled",
				snapshots: [
					{
						id: "snap-near",
						snapshotName: "near-expiry",
						status: "Active",
						createdDate: "2026-05-01T00:00:00.000Z",
						expirationDate: "2026-05-25T00:00:00.000Z",
					},
				],
			});
			const { getByRole, getByText } = await reachSettingsStep();
			fireEvent.click(getByRole("button", { name: "Org Snapshot (Fast)" }));
			await vi.runAllTimersAsync();
			await tick();
			expect(getByText(/5d/)).toBeTruthy();
			vi.useRealTimers();
		});
	});
});
