import { describe, expect, it } from "vitest";

import {
	computeDirtyFiles,
	filterBundles,
	formatCompileErrors,
	inferLanguageFromPath,
} from "./lwc-view-model";
import type { LwcBundleSummary, LwcFile } from "../../shared/lwc";

function makeBundle(overrides: Partial<LwcBundleSummary> = {}): LwcBundleSummary {
	return {
		id: "a001000000000001AAA",
		developerName: "helloWorld",
		masterLabel: "Hello World",
		namespacePrefix: null,
		apiVersion: 62,
		lastModifiedDate: "2024-01-01T00:00:00.000Z",
		lastModifiedByName: "Admin User",
		...overrides,
	};
}

function makeFile(overrides: Partial<LwcFile> = {}): LwcFile {
	return {
		id: "b001000000000001AAA",
		filePath: "lwc/helloWorld/helloWorld.js",
		format: "js",
		source: "import { LightningElement } from 'lwc';",
		lastModifiedDate: "2024-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("inferLanguageFromPath", () => {
	it("returns javascript for .js", () => {
		expect(inferLanguageFromPath("lwc/foo/foo.js")).toBe("javascript");
	});

	it("returns html for .html", () => {
		expect(inferLanguageFromPath("lwc/foo/foo.html")).toBe("html");
	});

	it("returns css for .css", () => {
		expect(inferLanguageFromPath("lwc/foo/foo.css")).toBe("css");
	});

	it("returns xml for .xml", () => {
		expect(inferLanguageFromPath("lwc/foo/foo.js-meta.xml")).toBe("xml");
	});

	it("returns unknown for unrecognized extension", () => {
		expect(inferLanguageFromPath("lwc/foo/foo.ts")).toBe("unknown");
	});

	it("returns unknown for empty string", () => {
		expect(inferLanguageFromPath("")).toBe("unknown");
	});
});

describe("computeDirtyFiles", () => {
	it("returns empty for no changes", () => {
		const file = makeFile({ source: "original" });
		const current = new Map([["lwc/helloWorld/helloWorld.js", "original"]]);
		expect(computeDirtyFiles([file], current)).toEqual([]);
	});

	it("returns the dirty file path when source changed", () => {
		const file = makeFile({ source: "original" });
		const current = new Map([["lwc/helloWorld/helloWorld.js", "modified"]]);
		expect(computeDirtyFiles([file], current)).toEqual(["lwc/helloWorld/helloWorld.js"]);
	});

	it("identifies multiple dirty files", () => {
		const files = [
			makeFile({ filePath: "lwc/foo/foo.js", source: "a" }),
			makeFile({ filePath: "lwc/foo/foo.html", source: "b" }),
			makeFile({ filePath: "lwc/foo/foo.css", source: "c" }),
		];
		const current = new Map([
			["lwc/foo/foo.js", "changed"],
			["lwc/foo/foo.html", "b"],
			["lwc/foo/foo.css", "also changed"],
		]);
		expect(computeDirtyFiles(files, current)).toEqual(["lwc/foo/foo.js", "lwc/foo/foo.css"]);
	});

	it("ignores files not present in current map", () => {
		const file = makeFile({ source: "original" });
		expect(computeDirtyFiles([file], new Map())).toEqual([]);
	});
});

describe("filterBundles", () => {
	const bundles = [
		makeBundle({ developerName: "accountCard", masterLabel: "Account Card" }),
		makeBundle({ developerName: "helloWorld", masterLabel: "Hello World" }),
		makeBundle({ developerName: "contactForm", masterLabel: "Contact Form" }),
	];

	it("returns all bundles for empty query", () => {
		expect(filterBundles(bundles, "")).toHaveLength(3);
		expect(filterBundles(bundles, "   ")).toHaveLength(3);
	});

	it("filters by developerName (case-insensitive)", () => {
		const result = filterBundles(bundles, "ACCOUNT");
		expect(result).toHaveLength(1);
		expect(result[0].developerName).toBe("accountCard");
	});

	it("filters by masterLabel (case-insensitive)", () => {
		const result = filterBundles(bundles, "contact form");
		expect(result).toHaveLength(1);
		expect(result[0].developerName).toBe("contactForm");
	});

	it("returns empty when no match", () => {
		expect(filterBundles(bundles, "zzznomatch")).toHaveLength(0);
	});

	it("handles partial match across bundles", () => {
		const result = filterBundles(bundles, "o");
		// "helloWorld" (hello), "contactForm" (contact, form) — all three contain "o"
		expect(result.length).toBeGreaterThan(1);
	});
});

describe("formatCompileErrors", () => {
	it("returns empty array for non-array input", () => {
		expect(formatCompileErrors(null)).toEqual([]);
		expect(formatCompileErrors("error string")).toEqual([]);
		expect(formatCompileErrors(undefined)).toEqual([]);
	});

	it("skips items without a message", () => {
		expect(formatCompileErrors([{ filePath: "foo.js" }])).toEqual([]);
	});

	it("normalizes a valid error", () => {
		const result = formatCompileErrors([
			{
				filePath: "lwc/foo/foo.js",
				line: 10,
				column: 5,
				message: "Syntax error",
				severity: "error",
			},
		]);
		expect(result).toEqual([
			{
				filePath: "lwc/foo/foo.js",
				line: 10,
				column: 5,
				message: "Syntax error",
				severity: "error",
			},
		]);
	});

	it("defaults severity to error when missing or unrecognized", () => {
		const result = formatCompileErrors([{ filePath: "", message: "Oops" }]);
		expect(result[0].severity).toBe("error");
	});

	it("preserves warning severity", () => {
		const result = formatCompileErrors([{ filePath: "", message: "Warn", severity: "warning" }]);
		expect(result[0].severity).toBe("warning");
	});

	it("handles missing optional fields", () => {
		const result = formatCompileErrors([{ message: "Error" }]);
		expect(result[0].filePath).toBe("");
		expect(result[0].line).toBeUndefined();
		expect(result[0].column).toBeUndefined();
	});
});
