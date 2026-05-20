import { describe, expect, it } from "vitest";

import type { MetadataComponentSummary, MetadataTypeSummary } from "../../shared/metadata";
import {
	buildMetadataComponentGroups,
	formatMetadataDetailValue,
	getGroupedComponentDisplayName,
	getMetadataComponentGroupName,
	matchesMetadataComponentSearch,
	matchesMetadataTypeFilter,
} from "./metadata-view-model";

describe("metadata view model", () => {
	const apexClassType: MetadataTypeSummary = {
		xmlName: "ApexClass",
		label: "Apex Class",
		directoryName: "classes",
		suffix: "cls",
		childXmlNames: [],
		inFolder: false,
		metaFile: false,
	};

	it("matches metadata type filters against visible identity fields", () => {
		expect(matchesMetadataTypeFilter(apexClassType, " apex ")).toBe(true);
		expect(matchesMetadataTypeFilter(apexClassType, "classes")).toBe(true);
		expect(matchesMetadataTypeFilter(apexClassType, "cls")).toBe(true);
		expect(matchesMetadataTypeFilter(apexClassType, "flow")).toBe(false);
	});

	it("matches component search against names, folders, parents, and namespaces", () => {
		const component: MetadataComponentSummary = {
			fullName: "Admin/AccountDashboard",
			type: "Dashboard",
			fileName: "dashboards/Admin/AccountDashboard.dashboard",
			folder: "Admin",
			namespacePrefix: "pkg",
			parentName: "Executive",
			label: "Account Dashboard",
			developerName: "AccountDashboard",
		};

		expect(matchesMetadataComponentSearch(component, "executive")).toBe(true);
		expect(matchesMetadataComponentSearch(component, "pkg")).toBe(true);
		expect(matchesMetadataComponentSearch(component, "accountdashboard")).toBe(true);
		expect(matchesMetadataComponentSearch(component, "missing")).toBe(false);
	});

	it("groups foldered components by group name and sorts newest first inside each group", () => {
		const older: MetadataComponentSummary = {
			fullName: "Admin/OlderDashboard",
			type: "Dashboard",
			folder: "Admin",
			lastModifiedDate: "2026-05-01T00:00:00.000Z",
		};
		const newer: MetadataComponentSummary = {
			fullName: "Admin/NewerDashboard",
			type: "Dashboard",
			folder: "Admin",
			lastModifiedDate: "2026-05-02T00:00:00.000Z",
		};
		const report: MetadataComponentSummary = {
			fullName: "Sales/Pipeline",
			type: "Report",
			folder: "Sales",
		};

		const groups = buildMetadataComponentGroups([older, report, newer], ["Admin"]);

		expect(groups.map((group) => group.name)).toEqual(["Admin", "Sales"]);
		expect(groups[0]?.isExpanded).toBe(true);
		expect(groups[0]?.components.map((component) => component.fullName)).toEqual([
			"Admin/NewerDashboard",
			"Admin/OlderDashboard",
		]);
	});

	it("formats metadata detail and grouped display fallbacks", () => {
		const component: MetadataComponentSummary = {
			fullName: "Admin/ImportantReport",
			type: "Report",
			folder: "Admin",
		};

		expect(getMetadataComponentGroupName(component)).toBe("Admin");
		expect(getGroupedComponentDisplayName(component, "Admin")).toBe("ImportantReport");
		expect(formatMetadataDetailValue("  ")).toBe("n/a");
		expect(formatMetadataDetailValue("Ada")).toBe("Ada");
	});
});
