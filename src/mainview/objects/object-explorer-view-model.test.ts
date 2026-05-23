import { describe, expect, it } from "vitest";

import type { ChildMetadataItem, ObjectSummary } from "../../shared/object-explorer";
import {
	childItemToComponentSummary,
	formatChildLabel,
	getCategoryLabel,
	getObjectBadge,
	getObjectTypeLabel,
	matchesObjectSearch,
	parseChildFullName,
} from "./object-explorer-view-model";

describe("object explorer view model", () => {
	const accountObj: ObjectSummary = {
		apiName: "Account",
		label: "Account",
		objectType: "standard",
	};

	const customObj: ObjectSummary = {
		apiName: "Legacy_Tracker__c",
		label: "Legacy Tracker",
		objectType: "custom",
		namespacePrefix: "myns",
	};

	const cmdtObj: ObjectSummary = {
		apiName: "Feature_Flag__mdt",
		label: "Feature Flag",
		objectType: "customMetadata",
	};

	const eventObj: ObjectSummary = {
		apiName: "Order_Placed__e",
		label: "Order Placed",
		objectType: "platformEvent",
	};

	const settingObj: ObjectSummary = {
		apiName: "My_Setting__c",
		label: "My Setting",
		objectType: "customSetting",
	};

	describe("matchesObjectSearch", () => {
		it("returns true for empty search", () => {
			expect(matchesObjectSearch(accountObj, "")).toBe(true);
			expect(matchesObjectSearch(accountObj, "   ")).toBe(true);
		});

		it("matches against apiName case-insensitively", () => {
			expect(matchesObjectSearch(accountObj, "account")).toBe(true);
			expect(matchesObjectSearch(accountObj, "ACCOUNT")).toBe(true);
			expect(matchesObjectSearch(accountObj, "acc")).toBe(true);
		});

		it("matches against label", () => {
			expect(matchesObjectSearch(customObj, "legacy")).toBe(true);
			expect(matchesObjectSearch(customObj, "tracker")).toBe(true);
		});

		it("matches against namespacePrefix", () => {
			expect(matchesObjectSearch(customObj, "myns")).toBe(true);
		});

		it("matches custom metadata types and platform events", () => {
			expect(matchesObjectSearch(cmdtObj, "feature")).toBe(true);
			expect(matchesObjectSearch(cmdtObj, "__mdt")).toBe(true);
			expect(matchesObjectSearch(eventObj, "order")).toBe(true);
			expect(matchesObjectSearch(eventObj, "__e")).toBe(true);
		});

		it("returns false when no field matches", () => {
			expect(matchesObjectSearch(accountObj, "opportunity")).toBe(false);
		});
	});

	describe("parseChildFullName", () => {
		it("parses qualified full names", () => {
			expect(parseChildFullName("Account.Legacy_Code__c")).toEqual({
				parentObject: "Account",
				childApiName: "Legacy_Code__c",
			});
			expect(parseChildFullName("Account.Require_Active_Status")).toEqual({
				parentObject: "Account",
				childApiName: "Require_Active_Status",
			});
		});

		it("parses custom metadata type field names", () => {
			expect(parseChildFullName("Feature_Flag__mdt.Is_Enabled__c")).toEqual({
				parentObject: "Feature_Flag__mdt",
				childApiName: "Is_Enabled__c",
			});
		});

		it("parses platform event field names", () => {
			expect(parseChildFullName("Order_Placed__e.Order_Id__c")).toEqual({
				parentObject: "Order_Placed__e",
				childApiName: "Order_Id__c",
			});
		});

		it("returns undefined for unqualified names", () => {
			expect(parseChildFullName("Account")).toBeUndefined();
			expect(parseChildFullName(".NoParent")).toBeUndefined();
		});
	});

	describe("getCategoryLabel", () => {
		it("returns human-readable labels for known types", () => {
			expect(getCategoryLabel("CustomField")).toBe("Fields & Relationships");
			expect(getCategoryLabel("ValidationRule")).toBe("Validation Rules");
			expect(getCategoryLabel("RecordType")).toBe("Record Types");
			expect(getCategoryLabel("FieldSet")).toBe("Field Sets");
		});

		it("falls back to the metadata type name for unknown types", () => {
			expect(getCategoryLabel("SomeUnknownType")).toBe("SomeUnknownType");
		});
	});

	describe("getObjectTypeLabel", () => {
		it("returns correct label for each object type", () => {
			expect(getObjectTypeLabel(accountObj)).toBe("Standard Object");
			expect(getObjectTypeLabel(customObj)).toBe("Custom Object");
			expect(getObjectTypeLabel(cmdtObj)).toBe("Custom Metadata Type");
			expect(getObjectTypeLabel(eventObj)).toBe("Platform Event");
			expect(getObjectTypeLabel(settingObj)).toBe("Custom Setting");
		});
	});

	describe("getObjectBadge", () => {
		it("returns namespace prefix when present", () => {
			expect(getObjectBadge(customObj)).toBe("myns");
		});

		it("returns type label when no namespace", () => {
			expect(getObjectBadge(accountObj)).toBe("Standard Object");
			expect(getObjectBadge(cmdtObj)).toBe("Custom Metadata Type");
			expect(getObjectBadge(eventObj)).toBe("Platform Event");
		});
	});

	describe("childItemToComponentSummary", () => {
		const item: ChildMetadataItem = {
			fullName: "Account.Legacy_Code__c",
			childApiName: "Legacy_Code__c",
			parentObject: "Account",
			metadataType: "CustomField",
			label: "Legacy Code",
			manageableState: "unmanaged",
			lastModifiedByName: "Jane Doe",
			lastModifiedDate: "2026-01-01T00:00:00.000Z",
		};

		it("maps child item to MetadataComponentSummary shape", () => {
			const summary = childItemToComponentSummary(item);
			expect(summary.fullName).toBe("Account.Legacy_Code__c");
			expect(summary.type).toBe("CustomField");
			expect(summary.label).toBe("Legacy Code");
			expect(summary.parentName).toBe("Account");
			expect(summary.developerName).toBe("Legacy_Code__c");
			expect(summary.manageableState).toBe("unmanaged");
			expect(summary.lastModifiedByName).toBe("Jane Doe");
			expect(summary.lastModifiedDate).toBe("2026-01-01T00:00:00.000Z");
		});
	});

	describe("formatChildLabel", () => {
		it("strips custom field suffix and replaces underscores", () => {
			expect(formatChildLabel("Legacy_Code__c")).toBe("Legacy Code");
			expect(formatChildLabel("Is_Enabled__c")).toBe("Is Enabled");
		});

		it("strips other suffixes", () => {
			expect(formatChildLabel("Related_Object__r")).toBe("Related Object");
		});

		it("returns the name unchanged when no underscores or suffix", () => {
			expect(formatChildLabel("ShippingAddress")).toBe("ShippingAddress");
		});
	});

	describe("staged item identity", () => {
		it("preserves qualified fullName and concrete metadataType for staging", () => {
			const fieldItem: ChildMetadataItem = {
				fullName: "Account.Legacy_Code__c",
				childApiName: "Legacy_Code__c",
				parentObject: "Account",
				metadataType: "CustomField",
			};
			const ruleItem: ChildMetadataItem = {
				fullName: "Account.Require_Active_Status",
				childApiName: "Require_Active_Status",
				parentObject: "Account",
				metadataType: "ValidationRule",
			};
			const cmdtFieldItem: ChildMetadataItem = {
				fullName: "Feature_Flag__mdt.Is_Enabled__c",
				childApiName: "Is_Enabled__c",
				parentObject: "Feature_Flag__mdt",
				metadataType: "CustomField",
			};

			expect(childItemToComponentSummary(fieldItem).fullName).toBe("Account.Legacy_Code__c");
			expect(childItemToComponentSummary(fieldItem).type).toBe("CustomField");
			expect(childItemToComponentSummary(ruleItem).type).toBe("ValidationRule");
			expect(childItemToComponentSummary(cmdtFieldItem).fullName).toBe(
				"Feature_Flag__mdt.Is_Enabled__c",
			);
			expect(childItemToComponentSummary(cmdtFieldItem).parentName).toBe("Feature_Flag__mdt");
		});
	});
});
