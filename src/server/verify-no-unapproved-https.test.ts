import { describe, expect, it } from "vitest";

import { findDisallowedHttpsUrls } from "../../scripts/verify-no-unapproved-https.mjs";

describe("findDisallowedHttpsUrls", () => {
	it("allows Salesforce hosts", () => {
		const content = [
			"https://mydomain.my.salesforce.com/path",
			"https://acme.force.com",
			"https://acme.lightning.force.com",
			"https://acme.salesforce-setup.com",
			"https://cs42.cloudforce.com",
			"https://salesforce.com?foo=bar",
			"https://force.com#fragment",
		].join("\n");

		expect(findDisallowedHttpsUrls(content)).toEqual([]);
	});

	it("flags non-Salesforce external hosts", () => {
		const content = [
			"https://example.com/lib.js",
			"https://fonts.googleapis.com/css2?family=Roboto",
			"https://cdn.jsdelivr.net/npm/foo@1.0.0/index.js",
		].join("\n");

		expect(findDisallowedHttpsUrls(content)).toEqual([
			"https://example.com/lib.js",
			"https://fonts.googleapis.com/css2?family=Roboto",
			"https://cdn.jsdelivr.net/npm/foo@1.0.0/index.js",
		]);
	});

	it("allows known framework diagnostic URLs that are not network calls", () => {
		const content = [
			"https://svelte.dev/e/state_referenced_locally",
			"https://svelte.dev/e/node_invalid_placement_ssr",
		].join("\n");
		expect(findDisallowedHttpsUrls(content)).toEqual([]);
	});
});
