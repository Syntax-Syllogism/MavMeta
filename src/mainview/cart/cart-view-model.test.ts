import { describe, expect, it } from "vitest";

import type { MetadataComponentSummary } from "../../shared/metadata";
import type { OrgSummary } from "../../shared/org";
import {
	buildStagedItemGroups,
	countStagedItemsByMetadataType,
	deriveSingleSourceOrgUsername,
	formatItemCount,
	getCartTitle,
	hasCompareXml,
	hasMixedSourceOrgs,
	listEligibleTargetOrgs,
	buildCompareDiffLines,
	toStagedItemId,
	type StagedItem,
} from "./cart-view-model";

describe("cart view model", () => {
	const component: MetadataComponentSummary = {
		fullName: "AccountController",
		type: "ApexClass",
	};

	it("builds stable staged item IDs using case-insensitive full names", () => {
		expect(toStagedItemId("user@example.com", "ApexClass", "AccountController")).toBe(
			"user@example.com::ApexClass::accountcontroller",
		);
	});

	it("groups staged items by metadata type and sorts groups and items by name", () => {
		const stagedItems: StagedItem[] = [
			{
				id: "2",
				orgUsername: "user@example.com",
				metadataType: "CustomObject",
				fullName: "Opportunity",
				component,
			},
			{
				id: "3",
				orgUsername: "user@example.com",
				metadataType: "ApexClass",
				fullName: "ZetaController",
				component,
			},
			{
				id: "1",
				orgUsername: "user@example.com",
				metadataType: "ApexClass",
				fullName: "AccountController",
				component,
			},
		];

		const groups = buildStagedItemGroups(stagedItems);

		expect(groups.map((group) => group.metadataType)).toEqual([
			"ApexClass",
			"CustomObject",
		]);
		expect(groups[0]?.items.map((item) => item.fullName)).toEqual([
			"AccountController",
			"ZetaController",
		]);
		expect(countStagedItemsByMetadataType(stagedItems)).toEqual([
			{ metadataType: "ApexClass", count: 2 },
			{ metadataType: "CustomObject", count: 1 },
		]);
	});

	it("formats cart labels from counts and workflow steps", () => {
		expect(formatItemCount(1)).toBe("1 item");
		expect(formatItemCount(2)).toBe("2 items");
		expect(getCartTitle("list")).toBe("Staged Items");
		expect(getCartTitle("actions")).toBe("Select Action");
		expect(getCartTitle("confirm")).toBe("Final Confirmation");
		expect(getCartTitle("result")).toBe("Result");
	});

	it("derives a single fixed source org and detects mixed-source carts", () => {
		const singleSource: StagedItem[] = [
			{
				id: "1",
				orgUsername: "source@example.com",
				metadataType: "ApexClass",
				fullName: "AccountController",
				component,
			},
			{
				id: "2",
				orgUsername: "source@example.com",
				metadataType: "CustomObject",
				fullName: "Opportunity",
				component,
			},
		];
		const mixedSource: StagedItem[] = [
			...singleSource,
			{
				id: "3",
				orgUsername: "other@example.com",
				metadataType: "ApexClass",
				fullName: "ZetaController",
				component,
			},
		];

		expect(deriveSingleSourceOrgUsername(singleSource)).toBe("source@example.com");
		expect(deriveSingleSourceOrgUsername(mixedSource)).toBeUndefined();
		expect(hasMixedSourceOrgs(singleSource)).toBe(false);
		expect(hasMixedSourceOrgs(mixedSource)).toBe(true);
		expect(hasMixedSourceOrgs([singleSource[0] as StagedItem])).toBe(false);
	});

	it("filters target org options to authenticated orgs excluding source org", () => {
		const orgs: OrgSummary[] = [
			{
				username: "source@example.com",
				environment: "sandbox",
				isDefault: false,
				authStatus: "connected",
			},
			{
				username: "target@example.com",
				environment: "sandbox",
				isDefault: false,
				authStatus: "connected",
			},
			{
				username: "expired@example.com",
				environment: "sandbox",
				isDefault: false,
				authStatus: "expired",
			},
		];

		expect(
			listEligibleTargetOrgs(orgs, "source@example.com").map((org) => org.username),
		).toEqual(["target@example.com"]);
	});

	it("detects compare xml content", () => {
		expect(hasCompareXml(undefined)).toBe(false);
		expect(hasCompareXml("   ")).toBe(false);
		expect(hasCompareXml("<tag/>")).toBe(true);
	});

	it("returns empty array when both sides are empty", () => {
		expect(buildCompareDiffLines(undefined, undefined)).toEqual([]);
		expect(buildCompareDiffLines("  ", "  ")).toEqual([]);
	});

	it("builds context rows for identical content", () => {
		const rows = buildCompareDiffLines("a\nb", "a\nb");
		expect(rows).toEqual([
			{ kind: "context", sourceLineNum: 1, targetLineNum: 1, sourceLine: "a", targetLine: "a" },
			{ kind: "context", sourceLineNum: 2, targetLineNum: 2, sourceLine: "b", targetLine: "b" },
		]);
	});

	it("pairs adjacent remove+add as change rows via LCS diff", () => {
		// LCS of ["a","b"] vs ["a","c","d"] is ["a"]
		// edit: context "a", remove "b", add "c", add "d"
		// pairing: context, change(b→c), orphan add "d"
		const rows = buildCompareDiffLines("a\nb", "a\nc\nd");
		expect(rows).toEqual([
			{ kind: "context", sourceLineNum: 1, targetLineNum: 1, sourceLine: "a", targetLine: "a" },
			{ kind: "change", sourceLineNum: 2, targetLineNum: 2, sourceLine: "b", targetLine: "c" },
			{ kind: "add", targetLineNum: 3, targetLine: "d" },
		]);
	});

	it("produces remove rows for source-only content", () => {
		const rows = buildCompareDiffLines("a\nb", undefined);
		expect(rows).toEqual([
			{ kind: "remove", sourceLineNum: 1, sourceLine: "a" },
			{ kind: "remove", sourceLineNum: 2, sourceLine: "b" },
		]);
	});

	it("produces add rows for target-only content", () => {
		const rows = buildCompareDiffLines(undefined, "x\ny");
		expect(rows).toEqual([
			{ kind: "add", targetLineNum: 1, targetLine: "x" },
			{ kind: "add", targetLineNum: 2, targetLine: "y" },
		]);
	});
});
