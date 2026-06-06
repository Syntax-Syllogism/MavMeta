import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	buildScreenshotName,
	createInitialReport,
	renderReportHtml,
	sanitizeName,
	writeReportArtifacts,
} from "../../scripts/smoke-crawl/io.mjs";
import { assertReportSchema, validateReportSchema } from "../../scripts/smoke-crawl/schema.mjs";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("smoke-crawl io", () => {
	it("sanitizes names using canonical slug rules", () => {
		expect(sanitizeName("Apex Trigger")).toBe("apex-trigger");
		expect(sanitizeName("__Layout__Example__")).toBe("layout-example");
		expect(sanitizeName("Flow:Start!")).toBe("flow-start");
	});

	it("builds screenshot names with signal/context parts", () => {
		const gap = buildScreenshotName({
			kind: "coverage-gap",
			metadataType: "ApexTrigger",
			componentName: null,
			signal: null,
		});
		const error = buildScreenshotName({
			kind: "error",
			metadataType: "CustomObject",
			componentName: "Invoice__c",
			signal: "network",
		});
		expect(gap).toBe("zero-apextrigger.png");
		expect(error).toBe("error-customobject-invoice-c-network.png");
	});

	it("renders html by replacing embedded report-data script", async () => {
		const templatePath = path.resolve("scripts", "smoke-crawl", "assets", "report-template.html");
		const templateHtml = await readFile(templatePath, "utf8");
		const report = createInitialReport({
			orgAlias: "ref-org",
			orgUsername: "ref@example.com",
			depth: 2,
			delayMs: 500,
			areas: ["metadata-explorer"],
		});
		(report.run as { finishedAt: string | null; status: string }).finishedAt = report.run.startedAt;
		(report.run as { finishedAt: string | null; status: string }).status = "complete";

		const html = renderReportHtml({ templateHtml, report });
		expect(html).toContain('"orgAlias": "ref-org"');
		expect(html).toContain('id="report-data"');
		expect(html).toContain('data-tab-target="overview"');
		expect(html).toContain('data-panel="findings"');
		expect(html).toContain("Search findings");
		expect(html).toContain("Raw report JSON");
	});

	it("validates example report schema from notes assets", async () => {
		const examplePath = path.resolve("scripts", "smoke-crawl", "assets", "example-report.json");
		const example = JSON.parse(await readFile(examplePath, "utf8"));
		expect(validateReportSchema(example)).toEqual([]);
		expect(() => assertReportSchema(example)).not.toThrow();
	});

	it("accepts cart in report schema areas and findings", () => {
		const report = createInitialReport({
			orgAlias: "ref-org",
			orgUsername: "ref@example.com",
			depth: 2,
			delayMs: 500,
			areas: ["cart"],
		});
		const run = report.run as { finishedAt: string | null; status: string };
		run.status = "complete";
		run.finishedAt = report.run.startedAt;
		(
			report.coverageGaps as Array<{
				kind: string;
				area: string;
				metadataType: string;
				screenshot: string;
				observedAt: string;
			}>
		).push({
			kind: "zero-result",
			area: "cart",
			metadataType: "CartStaging",
			screenshot: "screenshots/zero-cart-staging.png",
			observedAt: report.run.startedAt,
		});
		(
			report.errors as Array<{
				area: string;
				metadataType: string;
				componentName: null;
				signal: string;
				message: string;
				screenshot: string | null;
				observedAt: string;
			}>
		).push({
			area: "cart",
			metadataType: "cart",
			componentName: null,
			signal: "timeout",
			message: "cart compare timed out",
			screenshot: null,
			observedAt: report.run.startedAt,
		});

		expect(validateReportSchema(report)).toEqual([]);
		expect(() => assertReportSchema(report)).not.toThrow();
	});

	it("includes cart in the schema error enumerations", () => {
		const issues = validateReportSchema({
			run: {
				orgAlias: null,
				orgUsername: "demo@example.com",
				status: "complete",
				startedAt: new Date().toISOString(),
				finishedAt: new Date().toISOString(),
				config: {
					depth: 1,
					delayMs: 250,
					areas: ["cart", "bad-area"],
				},
				counts: {
					typesVisited: 0,
					coverageGaps: 0,
					errors: 0,
				},
			},
			coverageGaps: [
				{
					kind: "zero-result",
					area: "bad-area",
					metadataType: "CartStaging",
					screenshot: "screenshots/zero-cart-staging.png",
					observedAt: new Date().toISOString(),
				},
			],
			errors: [
				{
					area: "bad-area",
					metadataType: "cart",
					componentName: null,
					signal: "timeout",
					message: "cart compare timed out",
					screenshot: null,
					observedAt: new Date().toISOString(),
				},
			],
		});

		expect(issues).toContain(
			'"run.config.areas" entries must be one of metadata-explorer|object-explorer|lwc-editor|rest-explorer|soql-explorer|cart.',
		);
		expect(issues).toContain(
			"coverageGaps[0].area must be metadata-explorer|object-explorer|lwc-editor|rest-explorer|soql-explorer|cart.",
		);
		expect(issues).toContain(
			"errors[0].area must be metadata-explorer|object-explorer|lwc-editor|rest-explorer|soql-explorer|cart.",
		);
	});

	it("writes report.json and report.html with atomic artifacts", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "mavmeta-smoke-"));
		tempDirs.push(directory);

		const report = createInitialReport({
			orgAlias: null,
			orgUsername: "demo@example.com",
			depth: 1,
			delayMs: 250,
			areas: ["metadata-explorer"],
		});
		(report.run as { finishedAt: string | null; status: string }).status = "complete";
		(report.run as { finishedAt: string | null; status: string }).finishedAt =
			new Date().toISOString();

		const reportJsonPath = path.join(directory, "report.json");
		const reportHtmlPath = path.join(directory, "report.html");
		const templatePath = path.resolve("scripts", "smoke-crawl", "assets", "report-template.html");

		await writeReportArtifacts({
			report,
			reportJsonPath,
			reportHtmlPath,
			templatePath,
		});
		await writeReportArtifacts({
			report,
			reportJsonPath,
			reportHtmlPath,
			templatePath,
		});

		const savedJson = JSON.parse(await readFile(reportJsonPath, "utf8"));
		const savedHtml = await readFile(reportHtmlPath, "utf8");
		expect(savedJson.run.orgUsername).toBe("demo@example.com");
		expect(savedHtml).toContain('"orgUsername": "demo@example.com"');
	});
});
