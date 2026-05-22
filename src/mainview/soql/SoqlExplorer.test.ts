import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SoqlExplorer from "./SoqlExplorer.svelte";
import { backendClient } from "../backend/backend-client";

vi.mock("../backend/backend-client", () => ({
  backendClient: {
    soqlDescribeGlobal: vi.fn(),
    soqlDescribeObject: vi.fn(),
    soqlValidate: vi.fn(),
    soqlRun: vi.fn(),
    soqlBulkStart: vi.fn(),
    soqlBulkStatus: vi.fn(),
    soqlBulkResult: vi.fn(),
  },
}));

const mockedClient = vi.mocked(backendClient);

const sandboxOrg = {
  alias: "sandbox",
  username: "sandbox@example.com",
  environment: "sandbox",
  isDefault: true,
  authStatus: "connected",
};

const prodOrg = {
  alias: "prod",
  username: "prod@example.com",
  environment: "production",
  isDefault: true,
  authStatus: "connected",
};

describe("SoqlExplorer", () => {
  async function selectSObject(value: string) {
    const input = screen.getByLabelText("SObject") as HTMLInputElement;
    await fireEvent.input(input, { target: { value } });
    await fireEvent.keyDown(input, { key: "Enter" });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockedClient.soqlDescribeGlobal.mockResolvedValue({
      sobjects: [{ apiName: "Account", label: "Account", custom: false, queryable: true }],
    });
    mockedClient.soqlDescribeObject.mockResolvedValue({
      sobject: "Account",
      fields: [
        { apiName: "Id", label: "Id", type: "id", nillable: false, filterable: true, sortable: true },
        { apiName: "Name", label: "Name", type: "string", nillable: false, filterable: true, sortable: true },
        { apiName: "Phone", label: "Phone", type: "phone", nillable: true, filterable: true, sortable: true },
        { apiName: "Industry", label: "Industry", type: "picklist", nillable: true, filterable: true, sortable: true, picklistValues: ["Tech", "Finance"] },
      ],
    });
    mockedClient.soqlValidate.mockResolvedValue({ valid: true });
    mockedClient.soqlRun.mockResolvedValue({ records: [{ Id: "001" }], totalSize: 1, done: true });
    mockedClient.soqlBulkStart.mockResolvedValue({ jobId: "750xx000000001AAA" });
    mockedClient.soqlBulkStatus.mockResolvedValue({ jobId: "750xx000000001AAA", state: "JobComplete" });
    mockedClient.soqlBulkResult.mockResolvedValue("Id,Name\n001,Acme\n");
  });

  it("does not auto-validate before object selection", async () => {
    render(SoqlExplorer, { activeOrg: sandboxOrg });
    await waitFor(() => expect(mockedClient.soqlDescribeGlobal).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "+ Add filter" }).getAttribute("disabled")).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1300);
    expect(mockedClient.soqlValidate).not.toHaveBeenCalled();
  });

  it("loads fields and auto-runs preview for sandbox after selection", async () => {
    render(SoqlExplorer, { activeOrg: sandboxOrg });
    await waitFor(() => expect(mockedClient.soqlDescribeGlobal).toHaveBeenCalled());

    await selectSObject("Account");
    await waitFor(() => expect(mockedClient.soqlDescribeObject).toHaveBeenCalled());

    await vi.advanceTimersByTimeAsync(1300);
    await waitFor(() => expect(mockedClient.soqlValidate).toHaveBeenCalled());
    await waitFor(() => expect(mockedClient.soqlRun).toHaveBeenCalled());
  });

  it("shows run preview button for production and does not auto-run", async () => {
    render(SoqlExplorer, { activeOrg: prodOrg });
    await waitFor(() => expect(mockedClient.soqlDescribeGlobal).toHaveBeenCalled());

    await selectSObject("Account");
    await vi.advanceTimersByTimeAsync(1300);

    await waitFor(() => expect(mockedClient.soqlValidate).toHaveBeenCalled());
    expect(mockedClient.soqlRun).not.toHaveBeenCalled();

    const runButton = screen.getByRole("button", { name: "Run preview" });
    await fireEvent.click(runButton);
    await waitFor(() => expect(mockedClient.soqlRun).toHaveBeenCalledTimes(1));
  });

  it("guards full interactive run for very large result sets", async () => {
    mockedClient.soqlRun.mockResolvedValueOnce({
      records: [{ Id: "001" }],
      totalSize: 15000,
      done: false,
      nextRecordsUrl: "/next",
    });
    render(SoqlExplorer, { activeOrg: sandboxOrg });
    await waitFor(() => expect(mockedClient.soqlDescribeGlobal).toHaveBeenCalled());
    await selectSObject("Account");

    await fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => {
      expect(screen.getByText(/Use CSV\/JSON export for large result sets/i)).toBeTruthy();
    });
  });

  it("uses one-way builder to raw mode with reset control", async () => {
    render(SoqlExplorer, { activeOrg: sandboxOrg });
    await waitFor(() => expect(mockedClient.soqlDescribeGlobal).toHaveBeenCalled());
    await selectSObject("Account");
    await waitFor(() => expect(mockedClient.soqlDescribeObject).toHaveBeenCalled());

    await fireEvent.click(screen.getByRole("button", { name: "Edit as raw SOQL" }));
    expect(screen.getByText("RAW")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset to builder" })).toBeTruthy();

    await fireEvent.click(screen.getByRole("button", { name: "Reset to builder" }));
    expect(screen.getByRole("button", { name: "Edit as raw SOQL" })).toBeTruthy();
  });

  it("renders structured validation error with location", async () => {
    mockedClient.soqlValidate.mockResolvedValueOnce({
      valid: false,
      message: "MALFORMED_QUERY: unexpected token at line 1 at column 24",
    });
    render(SoqlExplorer, { activeOrg: sandboxOrg });
    await waitFor(() => expect(mockedClient.soqlDescribeGlobal).toHaveBeenCalled());
    await selectSObject("Account");
    await waitFor(() => expect(mockedClient.soqlDescribeObject).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(1300);
    await waitFor(() => expect(screen.getByText("Line 1, Column 24")).toBeTruthy());
    expect(screen.getByText(/MALFORMED_QUERY/)).toBeTruthy();
  });

  it("shows tooling-specific large-result guidance for interactive run", async () => {
    mockedClient.soqlRun.mockResolvedValueOnce({
      records: [{ Id: "001" }],
      totalSize: 15000,
      done: false,
      nextRecordsUrl: "/next",
    });
    render(SoqlExplorer, { activeOrg: sandboxOrg });
    await waitFor(() => expect(mockedClient.soqlDescribeGlobal).toHaveBeenCalled());
    await fireEvent.click(screen.getByRole("button", { name: "Tooling" }));
    await selectSObject("Account");
    await fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => {
      expect(screen.getByText(/Tooling query returned 15000 rows/i)).toBeTruthy();
    });
  });

  it("applies default LIMIT for tooling run when query has no limit", async () => {
    mockedClient.soqlRun.mockResolvedValueOnce({
      records: [{ Id: "001" }],
      totalSize: 1,
      done: true,
    });
    render(SoqlExplorer, { activeOrg: sandboxOrg });
    await waitFor(() => expect(mockedClient.soqlDescribeGlobal).toHaveBeenCalled());
    await fireEvent.click(screen.getByRole("button", { name: "Tooling" }));
    await selectSObject("Account");
    await fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => {
      expect(mockedClient.soqlRun).toHaveBeenCalledWith(
        expect.objectContaining({
          api: "tooling",
          soql: "SELECT Id FROM Account LIMIT 2000",
        }),
      );
    });
  });

  it("builds filter/order/limit query from builder controls", async () => {
    render(SoqlExplorer, { activeOrg: sandboxOrg });
    await waitFor(() => expect(mockedClient.soqlDescribeGlobal).toHaveBeenCalled());
    await selectSObject("Account");
    await waitFor(() => expect(mockedClient.soqlDescribeObject).toHaveBeenCalled());

    await fireEvent.click(screen.getByRole("button", { name: "+ Add filter" }));
    await fireEvent.change(screen.getByLabelText("Filter field 1"), { target: { value: "Name" } });
    await fireEvent.change(screen.getByLabelText("Filter operator 1"), { target: { value: "LIKE" } });
    await fireEvent.input(screen.getByLabelText("Filter value 1"), { target: { value: "Acme%" } });
    await fireEvent.change(screen.getByLabelText("Order by field"), { target: { value: "Name" } });
    await fireEvent.change(screen.getByLabelText("Order direction"), { target: { value: "DESC" } });
    await fireEvent.input(screen.getByLabelText("Row limit"), { target: { value: "10" } });

    await fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => {
      expect(mockedClient.soqlRun).toHaveBeenCalledWith(
        expect.objectContaining({
          soql: "SELECT Id FROM Account WHERE Name LIKE 'Acme%' ORDER BY Name DESC LIMIT 10",
        }),
      );
    });
  });

  it("quotes phone filter values from builder", async () => {
    render(SoqlExplorer, { activeOrg: sandboxOrg });
    await waitFor(() => expect(mockedClient.soqlDescribeGlobal).toHaveBeenCalled());
    await selectSObject("Account");
    await waitFor(() => expect(mockedClient.soqlDescribeObject).toHaveBeenCalled());

    await fireEvent.click(screen.getByRole("button", { name: "+ Add filter" }));
    await fireEvent.change(screen.getByLabelText("Filter field 1"), { target: { value: "Phone" } });
    await fireEvent.change(screen.getByLabelText("Filter operator 1"), { target: { value: "LIKE" } });
    await fireEvent.input(screen.getByLabelText("Filter value 1"), { target: { value: "123" } });
    await fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(mockedClient.soqlRun).toHaveBeenCalledWith(
        expect.objectContaining({
          soql: "SELECT Id FROM Account WHERE Phone LIKE '123'",
        }),
      );
    });
  });

  it("builds picklist IN filters from multi-select values", async () => {
    render(SoqlExplorer, { activeOrg: sandboxOrg });
    await waitFor(() => expect(mockedClient.soqlDescribeGlobal).toHaveBeenCalled());
    await selectSObject("Account");
    await waitFor(() => expect(mockedClient.soqlDescribeObject).toHaveBeenCalled());

    await fireEvent.click(screen.getByRole("button", { name: "+ Add filter" }));
    await fireEvent.change(screen.getByLabelText("Filter field 1"), { target: { value: "Industry" } });
    await fireEvent.change(screen.getByLabelText("Filter operator 1"), { target: { value: "IN" } });

    const input = screen.getByLabelText("Filter value 1") as HTMLSelectElement;
    input.options[0].selected = true;
    input.options[1].selected = true;
    await fireEvent.change(input);

    await fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => {
      expect(mockedClient.soqlRun).toHaveBeenCalledWith(
        expect.objectContaining({
          soql: "SELECT Id FROM Account WHERE Industry IN ('Tech','Finance')",
        }),
      );
    });
  });

  it("clears filter state when sobject is cleared and refreshed", async () => {
    render(SoqlExplorer, { activeOrg: sandboxOrg });
    await waitFor(() => expect(mockedClient.soqlDescribeGlobal).toHaveBeenCalled());
    await selectSObject("Account");
    await waitFor(() => expect(mockedClient.soqlDescribeObject).toHaveBeenCalled());

    await fireEvent.click(screen.getByRole("button", { name: "+ Add filter" }));
    await fireEvent.change(screen.getByLabelText("Filter field 1"), { target: { value: "Phone" } });
    await fireEvent.input(screen.getByLabelText("Row limit"), { target: { value: "25" } });

    const input = screen.getByLabelText("SObject") as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "" } });
    expect(screen.queryByLabelText("Filter field 1")).toBeNull();

    await selectSObject("Account");
    await waitFor(() => {
      const rowLimit = screen.getByLabelText("Row limit") as HTMLInputElement;
      expect(rowLimit.value).toBe("");
    });
    expect(screen.queryByLabelText("Filter field 1")).toBeNull();
  });
});
