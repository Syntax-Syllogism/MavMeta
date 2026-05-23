import { describe, expect, it } from "vitest";

import {
	buildPackageXml,
	dedupeSavedMetadataItems,
	parsePackageXml,
	parseSavedMetadataShoppingListsPayload,
	serializeSavedMetadataShoppingLists,
} from "./saved-shopping-lists";

describe("saved-shopping-lists", () => {
	it("round-trips saved list payload and dedupes items", () => {
		const serialized = serializeSavedMetadataShoppingLists([
			{
				id: "list-1",
				name: "Core smoke",
				createdAt: "2026-05-19T00:00:00.000Z",
				updatedAt: "2026-05-19T00:00:00.000Z",
				items: [
					{ metadataType: "ApexClass", fullName: "AccountController" },
					{ metadataType: "apexclass", fullName: "accountcontroller" },
				],
			},
		]);

		const lists = parseSavedMetadataShoppingListsPayload(serialized);
		expect(lists).toHaveLength(1);
		expect(lists[0]?.items).toEqual([{ metadataType: "ApexClass", fullName: "AccountController" }]);
	});

	it("drops payloads with unsupported version", () => {
		const lists = parseSavedMetadataShoppingListsPayload(
			JSON.stringify({ version: 999, lists: [] }),
		);
		expect(lists).toEqual([]);
	});

	it("exports package.xml grouped and sorted", () => {
		const xml = buildPackageXml([
			{ metadataType: "CustomObject", fullName: "Zeta__c" },
			{ metadataType: "ApexClass", fullName: "BClass" },
			{ metadataType: "ApexClass", fullName: "AClass" },
		]);

		expect(xml.indexOf("<name>ApexClass</name>")).toBeLessThan(
			xml.indexOf("<name>CustomObject</name>"),
		);
		expect(xml.indexOf("<members>AClass</members>")).toBeLessThan(
			xml.indexOf("<members>BClass</members>"),
		);
		expect(xml).toContain("<version>");
	});

	it("imports package.xml and dedupes case-insensitively", () => {
		const items = parsePackageXml(`<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <types>
    <members>AccountController</members>
    <members>accountcontroller</members>
    <name>ApexClass</name>
  </types>
  <types>
    <members>Widget__c</members>
    <name>CustomObject</name>
  </types>
  <version>62.0</version>
</Package>`);

		expect(items).toEqual([
			{ metadataType: "ApexClass", fullName: "AccountController" },
			{ metadataType: "CustomObject", fullName: "Widget__c" },
		]);
	});

	it("returns first case-insensitive entries when deduping", () => {
		expect(
			dedupeSavedMetadataItems([
				{ metadataType: "ApexClass", fullName: "Test" },
				{ metadataType: "apexclass", fullName: "test" },
			]),
		).toEqual([{ metadataType: "ApexClass", fullName: "Test" }]);
	});

	it("throws friendly error for malformed package.xml", () => {
		expect(() => parsePackageXml("<Package></Package>")).toThrow(
			"Could not find metadata <types> entries in package.xml.",
		);
	});
});
