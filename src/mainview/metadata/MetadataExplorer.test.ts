import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import type { MetadataComponentSummary, MetadataTypeSummary } from "../../shared/metadata";
import MetadataExplorer from "./MetadataExplorer.svelte";
import { buildMetadataComponentGroups } from "./metadata-view-model";

describe("MetadataExplorer", () => {
	const activeOrg = { username: "user@example.com", alias: "my-org" };
	const apexClassType: MetadataTypeSummary = {
		xmlName: "ApexClass",
		label: "Apex Class",
		directoryName: "classes",
		childXmlNames: [],
		inFolder: false,
		metaFile: false,
	};
	const reportType: MetadataTypeSummary = {
		xmlName: "Report",
		label: "Report",
		directoryName: "reports",
		childXmlNames: [],
		inFolder: true,
		metaFile: false,
	};

	const components: MetadataComponentSummary[] = [
		{
			fullName: "AccountController",
			type: "ApexClass",
			lastModifiedByName: "Ada Admin",
			lastModifiedDate: "2026-05-01T00:00:00.000Z",
		},
		{
			fullName: "pkg__ManagedController",
			type: "ApexClass",
			lastModifiedByName: "Managed Package",
			lastModifiedDate: "2026-05-02T00:00:00.000Z",
		},
	];

	const defaultProps = {
		activeOrg,
		isLoadingMetadataTypes: false,
		onLoadMetadataTypes: vi.fn(),
		metadataTypeFilter: "",
		metadataApiVersion: "58.0",
		metadataTypes: [apexClassType, reportType],
		visibleMetadataTypes: [apexClassType, reportType],
		selectedMetadataTypeXmlName: "ApexClass",
		metadataComponents: components,
		onListMetadataComponents: vi.fn(),
		isLoadingMetadataComponents: false,
		selectedMetadataComponent: components[0],
		isMetadataInspectorExpanded: true,
		metadataComponentSearch: "",
		metadataComponentErrors: [],
		shouldGroupMetadataComponents: false,
		metadataComponentGroups: buildMetadataComponentGroups(components, []),
		onToggleMetadataGroup: vi.fn(),
		onIsComponentStaged: vi.fn().mockReturnValue(false),
		onToggleStagedItem: vi.fn(),
		selectedMetadataComponentFullName: components[0].fullName,
		onSelectMetadataComponent: vi.fn(),
		filteredMetadataComponents: components,
		metadataComponentTargetType: "ApexClass",
		metadataTargetUsername: "user@example.com",
		isLoadingComponentSource: false,
		componentSource: undefined,
		componentSourceError: undefined,
		isXmlSectionOpen: false,
		onLoadComponentSource: vi.fn(),
		onCancelMetadataListing: vi.fn(),
	};

	it("shows grouped component sections for foldered metadata types", async () => {
		const reportComponents: MetadataComponentSummary[] = [
			{
				fullName: "Sales/ByMonth",
				type: "Report",
				folder: "Sales",
				lastModifiedByName: "Ada Admin",
				lastModifiedDate: "2026-05-01T00:00:00.000Z",
			},
		];

		const onToggleMetadataGroup = vi.fn();

		render(MetadataExplorer, {
			...defaultProps,
			selectedMetadataTypeXmlName: "Report",
			metadataComponents: reportComponents,
			filteredMetadataComponents: reportComponents,
			shouldGroupMetadataComponents: true,
			metadataComponentGroups: buildMetadataComponentGroups(reportComponents, []),
			onToggleMetadataGroup,
		});

		const salesToggle = (await screen.findAllByRole("button", { name: /Sales/ })).find((button) =>
			button.classList.contains("group-toggle"),
		);
		if (!salesToggle) throw new Error("Sales group toggle not found");
		
		// Groups are collapsed by default in this test setup
		expect(screen.queryByRole("button", { name: "ByMonth" })).toBeNull();

		// Expand
		await fireEvent.click(salesToggle);
		expect(onToggleMetadataGroup).toHaveBeenCalledWith("Sales");
	});

	it("toggles the component inspector details", async () => {
		const { rerender } = render(MetadataExplorer, defaultProps);

		// Inspector is expanded by default in props
		expect(screen.getByText("Developer Name")).toBeTruthy();

		// Toggle via prop change (simulating App state change)
		await rerender({ isMetadataInspectorExpanded: false });
		expect(screen.queryByText("Developer Name")).toBeNull();

		// Toggle back
		await rerender({ isMetadataInspectorExpanded: true });
		expect(screen.getByText("Developer Name")).toBeTruthy();
	});

	it("keeps full inspector header details visible when folded", async () => {
		const { rerender } = render(MetadataExplorer, defaultProps);

		await rerender({ isMetadataInspectorExpanded: false });
		const inspector = screen.getByLabelText("Component details");
		expect(within(inspector).getByText("ApexClass")).toBeTruthy();
		expect(within(inspector).getByRole("heading", { name: "AccountController" })).toBeTruthy();
		expect(within(inspector).getByRole("button", { name: "Refresh" })).toBeTruthy();
		expect(screen.queryByText("Developer Name")).toBeNull();
	});

	it("uses explorer pane wrappers and toggles expanded layout class", async () => {
		const { container, rerender } = render(MetadataExplorer, defaultProps);
		const explorer = container.querySelector(".component-explorer");
		if (!explorer) throw new Error("component explorer not found");

		expect(container.querySelector(".explorer-inspector-pane")).toBeTruthy();
		expect(container.querySelector(".explorer-list-pane")).toBeTruthy();
		expect(explorer.classList.contains("inspector-expanded")).toBe(true);

		await rerender({ isMetadataInspectorExpanded: false });
		expect(explorer.classList.contains("inspector-expanded")).toBe(false);
	});

	it("loads View Source lazily when expanded", async () => {
		const onLoadComponentSource = vi.fn();
		render(MetadataExplorer, {
			...defaultProps,
			onLoadComponentSource,
		});

		const xmlDisclosure = screen.getByText("View Source").closest("details");
		if (!xmlDisclosure) throw new Error("XML disclosure not found");

		// Expand to trigger load
		xmlDisclosure.open = true;
		await fireEvent(xmlDisclosure, new Event("toggle"));

		expect(onLoadComponentSource).toHaveBeenCalled();
	});

	it("shows error state when XML loading fails", async () => {
		render(MetadataExplorer, {
			...defaultProps,
			isXmlSectionOpen: true,
			componentSourceError: "Failed to fetch source",
		});

		const xmlDisclosure = screen.getByText("View Source").closest("details");
		if (!xmlDisclosure) throw new Error("XML disclosure not found");

		expect(within(xmlDisclosure).getByText("Failed to fetch source")).toBeTruthy();
	});

	it("shows loading spinner while XML is loading", async () => {
		render(MetadataExplorer, {
			...defaultProps,
			isXmlSectionOpen: true,
			isLoadingComponentSource: true,
		});

		const xmlDisclosure = screen.getByText("View Source").closest("details");
		if (!xmlDisclosure) throw new Error("XML disclosure not found");

		expect(within(xmlDisclosure).getByText("Loading component source...")).toBeTruthy();
		expect(xmlDisclosure.querySelector(".spinner")).toBeTruthy();
	});

	it("renders XML source when available", async () => {
		const source = '<?xml version="1.0"?><ApexClass>AccountController</ApexClass>';
		render(MetadataExplorer, {
			...defaultProps,
			isXmlSectionOpen: true,
			componentSource: source,
		});

		const xmlDisclosure = screen.getByText("View Source").closest("details");
		if (!xmlDisclosure) throw new Error("XML disclosure not found");

		expect(within(xmlDisclosure).getByText(/AccountController/)).toBeTruthy();
	});

	it("updates XML state when selected component changes while open", async () => {
		const onLoadComponentSource = vi.fn();
		const { rerender } = render(MetadataExplorer, {
			...defaultProps,
			isXmlSectionOpen: true,
			onLoadComponentSource,
		});

		// Change selected component
		await rerender({
			selectedMetadataComponent: components[1],
			selectedMetadataComponentFullName: components[1].fullName,
			componentSource: undefined, // Reset source as App would
		});

		expect(onLoadComponentSource).toHaveBeenCalled();
	});

	it("automatically loads new XML when switching components if section is already open", async () => {
		const onLoadComponentSource = vi.fn();
		const { rerender } = render(MetadataExplorer, {
			...defaultProps,
			isXmlSectionOpen: true,
			onLoadComponentSource,
		});

		// Let's re-trigger it.
		await rerender({
			selectedMetadataComponent: components[1],
			selectedMetadataComponentFullName: components[1].fullName,
		});

		expect(onLoadComponentSource).toHaveBeenCalled();
	});

	it("cancels component listing when Escape is pressed while loading", async () => {
		const onCancelMetadataListing = vi.fn();
		render(MetadataExplorer, {
			...defaultProps,
			isLoadingMetadataComponents: true,
			onCancelMetadataListing,
		});

		await fireEvent.keyDown(window, { key: "Escape" });
		expect(onCancelMetadataListing).toHaveBeenCalled();
	});

	it("does not cancel when Escape is pressed while not loading", async () => {
		const onCancelMetadataListing = vi.fn();
		render(MetadataExplorer, {
			...defaultProps,
			isLoadingMetadataComponents: false,
			onCancelMetadataListing,
		});

		await fireEvent.keyDown(window, { key: "Escape" });
		expect(onCancelMetadataListing).not.toHaveBeenCalled();
	});
});
