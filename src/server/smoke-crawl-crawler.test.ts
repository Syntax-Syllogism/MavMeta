import { describe, expect, it } from "vitest";

import {
	classifyComponentPanelState,
	classifyLwcBundlePanelState,
	classifyObjectPanelState,
	shouldSweepAllObjectCategories,
} from "../../scripts/smoke-crawl/crawler.mjs";

describe("smoke-crawl crawler panel state classification", () => {
	it("treats grouped rows as populated components", () => {
		const result = classifyComponentPanelState({
			hasComponentLink: false,
			hasGroupToggle: true,
			hasNoComponents: false,
		});
		expect(result).toBe("components-grouped");
	});

	it("prefers component links over grouped fallback", () => {
		const result = classifyComponentPanelState({
			hasComponentLink: true,
			hasGroupToggle: true,
			hasNoComponents: false,
		});
		expect(result).toBe("components");
	});

	it("detects empty state when no links/groups are present", () => {
		const result = classifyComponentPanelState({
			hasComponentLink: false,
			hasGroupToggle: false,
			hasNoComponents: true,
		});
		expect(result).toBe("empty");
	});

	it("treats object explorer component links as populated", () => {
		const result = classifyObjectPanelState({
			hasComponentLink: true,
			hasNoCategoryItems: false,
		});
		expect(result).toBe("components");
	});

	it("treats object explorer empty compact state as empty", () => {
		const result = classifyObjectPanelState({
			hasComponentLink: false,
			hasNoCategoryItems: true,
		});
		expect(result).toBe("empty");
	});

	it("sweeps category buttons for Account only", () => {
		expect(shouldSweepAllObjectCategories("Account")).toBe(true);
		expect(shouldSweepAllObjectCategories("account")).toBe(true);
		expect(shouldSweepAllObjectCategories("Contact")).toBe(false);
	});

	it("classifies lwc bundle panel as items when bundle rows exist", () => {
		expect(
			classifyLwcBundlePanelState({
				hasItems: true,
				hasLoading: true,
				hasTrueEmpty: false,
			}),
		).toBe("items");
	});

	it("classifies lwc bundle panel as empty only after loading settles", () => {
		expect(
			classifyLwcBundlePanelState({
				hasItems: false,
				hasLoading: false,
				hasTrueEmpty: true,
			}),
		).toBe("empty");
		expect(
			classifyLwcBundlePanelState({
				hasItems: false,
				hasLoading: true,
				hasTrueEmpty: true,
			}),
		).toBe("loading");
	});
});
