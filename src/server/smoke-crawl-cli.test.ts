import { describe, expect, it } from "vitest";

import { parseCliArgs } from "../../scripts/smoke-crawl/cli.mjs";

describe("smoke-crawl cli", () => {
	it("defaults to both crawl areas", () => {
		const args = parseCliArgs([]);
		expect(args.areas).toEqual([
			"metadata-explorer",
			"object-explorer",
			"lwc-editor",
			"rest-explorer",
			"soql-explorer",
		]);
	});

	it("parses explicit areas and jump target", () => {
		const args = parseCliArgs([
			"--areas=object-explorer,rest-explorer,soql-explorer",
			"--jump=Account",
			"--depth=0",
			"--quiet",
		]);
		expect(args.areas).toEqual(["object-explorer", "rest-explorer", "soql-explorer"]);
		expect(args.jump).toBe("Account");
		expect(args.depth).toBe(0);
		expect(args.quiet).toBe(true);
	});

	it("rejects unsupported areas", () => {
		expect(() => parseCliArgs(["--areas=metadata-explorer,foo"])).toThrow(
			/unsupported value "foo"/i,
		);
	});
});
