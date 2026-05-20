import { describe, expect, it } from "vitest";

import {
	buildScratchOrgDefinition,
	generateAlias,
	validateDefinitionJson,
	validateDurationDays,
	type ScratchOrgWizardSettings,
	type WizardSettingsEntry,
} from "./create-scratch-view-model";

function makeSettings(overrides: Partial<ScratchOrgWizardSettings> = {}): ScratchOrgWizardSettings {
	return {
		creationMode: "standard",
		template: "minimal",
		edition: "Developer",
		orgName: "",
		features: [],
		settings: [],
		...overrides,
	};
}

function entry(group: string, subKeys: Record<string, boolean> = {}): WizardSettingsEntry {
	return { group, subKeys };
}

describe("buildScratchOrgDefinition", () => {
	it("produces minimal definition from minimal template", () => {
		const result = buildScratchOrgDefinition(makeSettings({ template: "minimal" }));
		expect(result.edition).toBe("Developer");
		expect(result.features).toBeUndefined();
		expect(result.settings).toBeUndefined();
	});

	it("includes orgName when provided", () => {
		const result = buildScratchOrgDefinition(makeSettings({ orgName: "My Scratch Org" }));
		expect(result.orgName).toBe("My Scratch Org");
	});

	it("ignores blank orgName", () => {
		const result = buildScratchOrgDefinition(makeSettings({ orgName: "  " }));
		expect(result.orgName).toBeUndefined();
	});

	it("merges additional features with template features", () => {
		const result = buildScratchOrgDefinition(
			makeSettings({ template: "admin-dev", features: ["Einstein"] }),
		);
		const features = result.features as string[];
		expect(features).toContain("ServiceCloud");
		expect(features).toContain("Communities");
		expect(features).toContain("Einstein");
	});

	it("deduplicates features from template and wizard", () => {
		const result = buildScratchOrgDefinition(
			makeSettings({ template: "admin-dev", features: ["ServiceCloud", "Einstein"] }),
		);
		const features = result.features as string[];
		const servicecloudCount = features.filter((f) => f === "ServiceCloud").length;
		expect(servicecloudCount).toBe(1);
	});

	it("minimal template produces no features", () => {
		const result = buildScratchOrgDefinition(makeSettings({ template: "minimal", features: [] }));
		expect(result.features).toBeUndefined();
	});

	it("minimal template with empty features produces no features key", () => {
		const result = buildScratchOrgDefinition(makeSettings({ template: "minimal" }));
		expect(Object.prototype.hasOwnProperty.call(result, "features")).toBe(false);
	});

	describe("nested settings", () => {
		it("emits correct nested shape for single group with one sub-key", () => {
			const result = buildScratchOrgDefinition(
				makeSettings({
					settings: [entry("lightningExperienceSettings", { enableS1DesktopEnabled: true })],
				}),
			);
			const settingsObj = result.settings as Record<string, Record<string, boolean>>;
			expect(settingsObj.lightningExperienceSettings).toEqual({ enableS1DesktopEnabled: true });
		});

		it("emits correct nested shape for single group with multiple sub-keys", () => {
			const result = buildScratchOrgDefinition(
				makeSettings({
					settings: [
						entry("lightningExperienceSettings", {
							enableS1DesktopEnabled: true,
							enableLightningPreviewPref: false,
						}),
					],
				}),
			);
			const settingsObj = result.settings as Record<string, Record<string, boolean>>;
			expect(settingsObj.lightningExperienceSettings).toEqual({
				enableS1DesktopEnabled: true,
				enableLightningPreviewPref: false,
			});
		});

		it("emits correct nested shape for multiple groups", () => {
			const result = buildScratchOrgDefinition(
				makeSettings({
					settings: [
						entry("lightningExperienceSettings", { enableS1DesktopEnabled: true }),
						entry("mobileSettings", { enableS1EncryptedStoragePref2: false }),
					],
				}),
			);
			const settingsObj = result.settings as Record<string, Record<string, boolean>>;
			expect(settingsObj.lightningExperienceSettings).toEqual({ enableS1DesktopEnabled: true });
			expect(settingsObj.mobileSettings).toEqual({ enableS1EncryptedStoragePref2: false });
		});

		it("drops unknown group with no sub-keys", () => {
			const result = buildScratchOrgDefinition(
				makeSettings({ settings: [entry("customSettings", {})] }),
			);
			expect(result.settings).toBeUndefined();
		});

		it("drops empty groups and only emits groups with sub-keys", () => {
			const result = buildScratchOrgDefinition(
				makeSettings({
					settings: [
						entry("emptyGroup", {}),
						entry("lightningExperienceSettings", { enableS1DesktopEnabled: true }),
					],
				}),
			);
			const settingsObj = result.settings as Record<string, Record<string, boolean>>;
			expect(settingsObj.lightningExperienceSettings).toBeDefined();
			expect(settingsObj.emptyGroup).toBeUndefined();
		});

		it("does not include settings object when all groups have no sub-keys", () => {
			const result = buildScratchOrgDefinition(
				makeSettings({ settings: [entry("groupA", {}), entry("groupB", {})] }),
			);
			expect(result.settings).toBeUndefined();
		});

		it("does not include settings object when settings array is empty", () => {
			const result = buildScratchOrgDefinition(makeSettings({ settings: [] }));
			expect(result.settings).toBeUndefined();
		});

		it("preserves false boolean sub-key values", () => {
			const result = buildScratchOrgDefinition(
				makeSettings({
					settings: [entry("chatterSettings", { enableChatter: false })],
				}),
			);
			const settingsObj = result.settings as Record<string, Record<string, boolean>>;
			expect(settingsObj.chatterSettings.enableChatter).toBe(false);
		});
	});

	it("produces empty object for custom template with no fields", () => {
		const result = buildScratchOrgDefinition(makeSettings({ template: "custom", edition: "" }));
		expect(result).toEqual({});
	});

	it("overrides template edition with wizard edition", () => {
		const result = buildScratchOrgDefinition(
			makeSettings({ template: "minimal", edition: "Enterprise" }),
		);
		expect(result.edition).toBe("Enterprise");
	});

	it("builds snapshot-only definition in snapshot mode", () => {
		const result = buildScratchOrgDefinition(
			makeSettings({
				creationMode: "snapshot",
				snapshotName: "baseline-v1",
				features: ["Communities"],
				settings: [entry("lightningExperienceSettings", { enableS1DesktopEnabled: true })],
			}),
		);
		expect(result).toEqual({ snapshot: "baseline-v1" });
	});
});

describe("validateDefinitionJson", () => {
	it("returns valid for a well-formed JSON object", () => {
		const result = validateDefinitionJson('{ "edition": "Developer" }');
		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.parsed).toEqual({ edition: "Developer" });
		}
	});

	it("returns invalid for empty string", () => {
		const result = validateDefinitionJson("");
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toBeTruthy();
		}
	});

	it("returns invalid for malformed JSON", () => {
		const result = validateDefinitionJson('{ "edition": }');
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toBeTruthy();
		}
	});

	it("returns invalid for a JSON array", () => {
		const result = validateDefinitionJson("[1, 2, 3]");
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toContain("object");
		}
	});

	it("returns invalid for a JSON string scalar", () => {
		const result = validateDefinitionJson('"hello"');
		expect(result.valid).toBe(false);
	});

	it("returns valid for an empty object", () => {
		const result = validateDefinitionJson("{}");
		expect(result.valid).toBe(true);
	});

	it("includes parse error message for invalid JSON", () => {
		const result = validateDefinitionJson("{ bad json }");
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error.length).toBeGreaterThan(0);
		}
	});
});

describe("validateDurationDays", () => {
	it("accepts the minimum value of 1", () => {
		expect(validateDurationDays(1).valid).toBe(true);
	});

	it("accepts the default value of 7", () => {
		expect(validateDurationDays(7).valid).toBe(true);
	});

	it("accepts the maximum value of 30", () => {
		expect(validateDurationDays(30).valid).toBe(true);
	});

	it("rejects 0", () => {
		const result = validateDurationDays(0);
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toBeTruthy();
		}
	});

	it("rejects 31", () => {
		const result = validateDurationDays(31);
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toBeTruthy();
		}
	});

	it("rejects negative values", () => {
		expect(validateDurationDays(-1).valid).toBe(false);
		expect(validateDurationDays(-10).valid).toBe(false);
	});

	it("rejects non-integers", () => {
		const result = validateDurationDays(7.5);
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.error).toBeTruthy();
		}
	});
});

describe("generateAlias", () => {
	it("returns a hyphenated two-word string", () => {
		const alias = generateAlias(0.5);
		expect(alias).toMatch(/^[a-z]+-[a-z]+$/);
	});

	it("never returns an empty string", () => {
		for (let seed = 0; seed < 1; seed += 0.1) {
			expect(generateAlias(seed).length).toBeGreaterThan(0);
		}
	});

	it("produces deterministic output for the same seed", () => {
		expect(generateAlias(0.42)).toBe(generateAlias(0.42));
	});

	it("produces different outputs for different seeds", () => {
		const results = new Set<string>();
		for (let seed = 0; seed < 0.9; seed += 0.13) {
			results.add(generateAlias(seed));
		}
		expect(results.size).toBeGreaterThan(1);
	});
});
