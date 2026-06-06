// @ts-nocheck
import path from "node:path";

import { chromium } from "playwright";

import { buildScreenshotName, saveScreenshot } from "./io.mjs";

const NAVIGATION_TIMEOUT_MS = 45_000;
const COMPONENT_WAIT_TIMEOUT_MS = 15_000;
const DEPLOY_WAIT_TIMEOUT_MS = 45_000;
const LWC_BUNDLE_WAIT_TIMEOUT_MS = 120_000;
const SOQL_WAIT_TIMEOUT_MS = 45_000;
const CART_COMPARE_WAIT_TIMEOUT_MS = 45_000;
const SMOKE_MARKER = "smoke-crawl";
const AREA_CONFIG = {
	"metadata-explorer": {
		navLabel: "Metadata Explorer",
		tableSelector: '.metadata-table[aria-label="Metadata types"]',
		rowSelector: ".metadata-row-button",
		readRows: readMetadataTypes,
		waitForOutcome: waitForComponentOutcome,
		clickDepth: clickMetadataDepth,
	},
	"object-explorer": {
		navLabel: "Object Explorer",
		tableSelector: '.object-table[aria-label="Object directory"]',
		rowSelector: ".object-row-button",
		readRows: readObjectRows,
		waitForOutcome: waitForObjectOutcome,
		clickDepth: clickObjectDepth,
	},
};

export async function runSmokeCrawler({
	options,
	report,
	artifactPaths,
	flushReport,
	isStopRequested,
	requestStop,
	log,
}) {
	const browser = await chromium.launch({ headless: true });
	let page;
	let context;
	const cursor = {
		area: "metadata-explorer",
		metadataType: "unknown",
		componentName: null,
	};

	try {
		context = await browser.newContext({ viewport: { width: 1680, height: 1020 } });
		await grantClipboardPermissions(context, options.appUrl);
		page = await context.newPage();
		await wireToastObserver(page, async (toastMessage) => {
			await addError({
				report,
				flushReport,
				page,
				artifactPaths,
				cursor,
				signal: "toast",
				message: trimMessage(toastMessage),
			});
		});
		wireConsoleCapture(page, async (message) => {
			await addError({
				report,
				flushReport,
				page,
				artifactPaths,
				cursor,
				signal: "console",
				message: trimMessage(message),
			});
		});
		wireNetworkCapture(page, async (networkEvent) => {
			await addError({
				report,
				flushReport,
				page,
				artifactPaths,
				cursor,
				signal: "network",
				message: networkEvent.message,
			});
			if (networkEvent.isAuthExpiry && !isStopRequested()) {
				await requestStop("interrupted", "Salesforce auth expired during crawl.");
			}
		});

		await page.goto(options.appUrl, {
			waitUntil: "networkidle",
			timeout: NAVIGATION_TIMEOUT_MS,
		});
		for (const area of options.areas) {
			if (isStopRequested()) {
				break;
			}
			await crawlArea({
				page,
				area,
				options,
				report,
				artifactPaths,
				flushReport,
				isStopRequested,
				cursor,
				log,
			});
		}
	} finally {
		await context?.close().catch(() => {});
		await browser.close().catch(() => {});
	}
}

async function grantClipboardPermissions(context, appUrl) {
	try {
		const origin = new URL(appUrl).origin;
		await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
	} catch {
		// Clipboard permissions are best-effort and can fail on unsupported engines.
	}
}

async function crawlArea({
	page,
	area,
	options,
	report,
	artifactPaths,
	flushReport,
	isStopRequested,
	cursor,
	log,
}) {
	if (area === "lwc-editor") {
		return crawlLwcArea({
			page,
			options,
			report,
			artifactPaths,
			flushReport,
			cursor,
			log,
		});
	}

	if (area === "rest-explorer") {
		return crawlRestArea({
			page,
			options,
			report,
			artifactPaths,
			flushReport,
			cursor,
			log,
		});
	}

	if (area === "soql-explorer") {
		return crawlSoqlArea({
			page,
			options,
			report,
			artifactPaths,
			flushReport,
			cursor,
			log,
		});
	}

	if (area === "cart") {
		return crawlCartArea({
			page,
			options,
			report,
			artifactPaths,
			flushReport,
			cursor,
			log,
		});
	}

	const config = AREA_CONFIG[area];
	if (!config) {
		throw new Error(`Unsupported crawl area "${area}".`);
	}

	cursor.area = area;
	cursor.componentName = null;

	await page.getByRole("button", { name: config.navLabel }).click();
	await page.waitForSelector(config.tableSelector, {
		timeout: NAVIGATION_TIMEOUT_MS,
	});

	const rows = await config.readRows(page);
	const { startIndex } = resolveStartIndex({
		rows,
		jump: options.jump,
		area,
	});

	const total = rows.length;
	if (total === 0) {
		throw new Error(`No rows were found in ${config.navLabel}.`);
	}

	for (let rowIndex = startIndex; rowIndex < total; rowIndex++) {
		if (isStopRequested()) {
			break;
		}
		const rowName = rows[rowIndex];
		cursor.metadataType = rowName;
		cursor.componentName = null;

		let rowResult = "ok";
		try {
			await page.locator(config.rowSelector).nth(rowIndex).click({ timeout: NAVIGATION_TIMEOUT_MS });
			if (area === "object-explorer" && shouldSweepAllObjectCategories(rowName)) {
				rowResult = "account-category-sweep";
				await crawlObjectExplorerAccountCategories({
					page,
					rowName,
					cursor,
					report,
					artifactPaths,
					flushReport,
					options,
				});
				report.run.counts.coverageGaps = report.coverageGaps.length;
				report.run.counts.errors = report.errors.length;
				await flushReport();
				if (!options.quiet) {
					log(`${area} [${rowIndex + 1}/${total}] ${rowName} -> ${rowResult}`);
				}
				report.run.counts.typesVisited += 1;
				continue;
			}

			const outcome = await config.waitForOutcome(page);

			if (outcome === "timeout") {
				rowResult = "timeout";
				await addError({
					report,
					flushReport,
					page,
					artifactPaths,
					cursor,
					signal: "timeout",
					message: `no response within 15s while awaiting ${area} results`,
				});
			} else if (outcome === "empty") {
				rowResult = "gap";
				const screenshot = await captureFindingScreenshot({
					page,
					artifactPaths,
					filename: buildScreenshotName({
						kind: "coverage-gap",
						metadataType: rowName,
					}),
				});
				report.coverageGaps.push({
					kind: "zero-result",
					area,
					metadataType: rowName,
					screenshot,
					observedAt: new Date().toISOString(),
				});
			} else {
				await config.clickDepth({
					page,
					cursor,
					depth: options.depth,
					delayMs: options.delayMs,
					artifactPaths,
					metadataType: rowName,
				});
			}
		} catch (error) {
			rowResult = "error";
			await addError({
				report,
				flushReport,
				page,
				artifactPaths,
				cursor,
				signal: "console",
				message: trimMessage(
					`Crawler row failure: ${error instanceof Error ? error.message : String(error)}`,
				),
			});
		}

		report.run.counts.typesVisited += 1;
		report.run.counts.coverageGaps = report.coverageGaps.length;
		report.run.counts.errors = report.errors.length;
		await flushReport();

		if (!options.quiet) {
			log(`${area} [${rowIndex + 1}/${total}] ${rowName} -> ${rowResult}`);
		}
	}
}

async function crawlLwcArea({ page, options, report, artifactPaths, flushReport, cursor, log }) {
	cursor.area = "lwc-editor";
	cursor.metadataType = "lwc-editor";
	cursor.componentName = null;

	await page.getByRole("button", { name: "LWC Editor" }).click();
	await page.waitForSelector('aside.bundle-list[aria-label="LWC Bundle List"]', {
		timeout: NAVIGATION_TIMEOUT_MS,
	});

	const bundleSearchInput = page.locator('input[aria-label="Search bundles"]').first();
	if ((await bundleSearchInput.count()) > 0) {
		await bundleSearchInput.fill("");
	}

	const bundlePanelState = await waitForLwcBundlePanelState(page);
	if (bundlePanelState === "timeout") {
		await addError({
			report,
			flushReport,
			page,
			artifactPaths,
			cursor,
			signal: "timeout",
			message: "LWC bundle list did not finish loading before timeout",
		});
		report.run.counts.typesVisited += 1;
		report.run.counts.errors = report.errors.length;
		await flushReport();
		if (!options.quiet) {
			log("lwc-editor [1/1] bundles -> timeout");
		}
		return;
	}

	const bundles = page.locator(".bundle-list-items .bundle-item");
	const bundleCount = await bundles.count();
	if (bundleCount === 0 || bundlePanelState === "empty") {
		const screenshot = await captureFindingScreenshot({
			page,
			artifactPaths,
			filename: buildScreenshotName({
				kind: "coverage-gap",
				metadataType: "lwc-editor-bundles",
			}),
		});
		report.coverageGaps.push({
			kind: "zero-result",
			area: "lwc-editor",
			metadataType: "LwcBundles",
			screenshot,
			observedAt: new Date().toISOString(),
		});
		report.run.counts.typesVisited += 1;
		report.run.counts.coverageGaps = report.coverageGaps.length;
		await flushReport();
		if (!options.quiet) {
			log("lwc-editor [1/1] bundles -> gap");
		}
		return;
	}

	const selectionResult = await selectFirstLwcBundle(page);
	if (selectionResult !== "selected") {
		await addError({
			report,
			flushReport,
			page,
			artifactPaths,
			cursor,
			signal: "timeout",
			message: "LWC bundle list loaded but first bundle could not be selected",
		});
		report.run.counts.typesVisited += 1;
		report.run.counts.errors = report.errors.length;
		await flushReport();
		if (!options.quiet) {
			log("lwc-editor [1/1] first bundle select -> timeout");
		}
		return;
	}
	await page.waitForSelector('.file-tabs[aria-label="Bundle files"] .file-tab', {
		timeout: NAVIGATION_TIMEOUT_MS,
	});

	const changedFiles = [];
	const jsEdited = await appendCommentToFirstFileBySuffix({
		page,
		suffix: ".js",
		comment: `// ${SMOKE_MARKER}: automated comment`,
	});
	if (jsEdited) changedFiles.push(".js");

	const htmlEdited = await appendCommentToFirstFileBySuffix({
		page,
		suffix: ".html",
		comment: `<!-- ${SMOKE_MARKER}: automated comment -->`,
	});
	if (htmlEdited) changedFiles.push(".html");

	cursor.metadataType = "lwc-editor::deploy";
	cursor.componentName = changedFiles.join(",") || "none";
	const deployButton = page.getByRole("button", { name: /Deploy to Org/i });
	if ((await deployButton.count()) === 0) {
		await addError({
			report,
			flushReport,
			page,
			artifactPaths,
			cursor,
			signal: "timeout",
			message: "Deploy to Org button not found in LWC editor",
		});
	} else {
		await deployButton.click({ timeout: NAVIGATION_TIMEOUT_MS });
		const deployOutcome = await waitForLwcDeployOutcome(page);
		if (deployOutcome.kind === "error") {
			await addError({
				report,
				flushReport,
				page,
				artifactPaths,
				cursor,
				signal: "console",
				message: trimMessage(`LWC deploy outcome: ${deployOutcome.message}`),
			});
		}
	}

	report.run.counts.typesVisited += 1;
	report.run.counts.coverageGaps = report.coverageGaps.length;
	report.run.counts.errors = report.errors.length;
	await flushReport();
	if (!options.quiet) {
		log("lwc-editor [1/1] first bundle edit+deploy -> complete");
	}
}

async function crawlRestArea({ page, options, report, artifactPaths, flushReport, cursor, log }) {
	cursor.area = "rest-explorer";
	cursor.metadataType = "rest-explorer";
	cursor.componentName = null;

	await page.getByRole("button", { name: "REST Explorer" }).click();
	await page.waitForSelector(".rest-explorer", { timeout: NAVIGATION_TIMEOUT_MS });

	const methodSelect = page.getByRole("combobox", { name: /http method/i });
	await methodSelect.selectOption("GET");

	const requestPath = "/services/data/v66.0/limits";
	const pathInput = page.getByLabel("Request path");
	await pathInput.fill(requestPath);
	cursor.metadataType = `rest-explorer::${requestPath}`;
	await page.getByRole("button", { name: /^Send$/i }).click();

	const responseOutcome = await waitForRestResponseOutcome(page);
	if (responseOutcome !== "response") {
		await addError({
			report,
			flushReport,
			page,
			artifactPaths,
			cursor,
			signal: "timeout",
			message: "REST response did not render after GET /services/data/v66.0/limits",
		});
	} else {
		const removeButtons = page.getByRole("button", { name: /Delete history entry/i });
		const beforeCount = await removeButtons.count();
		if (beforeCount === 0) {
			await addError({
				report,
				flushReport,
				page,
				artifactPaths,
				cursor,
				signal: "timeout",
				message: "REST request history did not render a removable entry",
			});
		} else {
			await removeButtons.first().click({ timeout: NAVIGATION_TIMEOUT_MS });
			await page.waitForTimeout(150);
		}
	}

	report.run.counts.typesVisited += 1;
	report.run.counts.coverageGaps = report.coverageGaps.length;
	report.run.counts.errors = report.errors.length;
	await flushReport();
	if (!options.quiet) {
		log("rest-explorer [1/1] GET limits + remove history -> complete");
	}
}

async function crawlSoqlArea({ page, options, report, artifactPaths, flushReport, cursor, log }) {
	cursor.area = "soql-explorer";
	cursor.metadataType = "soql-explorer";
	cursor.componentName = null;

	await page.getByRole("button", { name: "SOQL Explorer" }).click();
	const soqlRoot = page.locator(".soql-explorer").first();
	await soqlRoot.waitFor({ timeout: NAVIGATION_TIMEOUT_MS });

	const scenarios = [
		{
			apiLabel: "REST",
			sobject: "Account",
			filterField: "Name",
			filterOperator: "!=",
			filterValue: null,
			orderField: "Name",
			orderDirection: "DESC",
			limit: "10",
		},
		{
			apiLabel: "Tooling",
			sobject: "LightningComponentBundle",
			filterField: "ApiVersion",
			filterOperator: ">",
			filterValue: "50",
			orderField: "CreatedDate",
			orderDirection: "DESC",
			limit: "10",
		},
	];

	for (let index = 0; index < scenarios.length; index++) {
		const scenario = scenarios[index];
		cursor.metadataType = `soql-explorer::${scenario.apiLabel.toLowerCase()}::${scenario.sobject}`;
		cursor.componentName = null;

		let result = "complete";
		try {
			const outcome = await runSoqlScenario({
				page,
				soqlRoot,
				...scenario,
			});
			if (outcome !== "result") {
				result = outcome;
				await addError({
					report,
					flushReport,
					page,
					artifactPaths,
					cursor,
					signal: outcome === "timeout" ? "timeout" : "console",
					message:
						outcome === "timeout"
							? `SOQL ${scenario.apiLabel} ${scenario.sobject} run did not produce results before timeout`
							: `SOQL ${scenario.apiLabel} ${scenario.sobject} run reached an error state`,
				});
			}
		} catch (error) {
			result = "error";
			await addError({
				report,
				flushReport,
				page,
				artifactPaths,
				cursor,
				signal: "console",
				message: trimMessage(
					`Crawler soql failure (${scenario.apiLabel} ${scenario.sobject}): ${
						error instanceof Error ? error.message : String(error)
					}`,
				),
			});
		}

		report.run.counts.typesVisited += 1;
		report.run.counts.coverageGaps = report.coverageGaps.length;
		report.run.counts.errors = report.errors.length;
		await flushReport();
		if (!options.quiet) {
			log(
				`soql-explorer [${index + 1}/${scenarios.length}] ${scenario.apiLabel} ${scenario.sobject} -> ${result}`,
			);
		}
	}
}

async function crawlCartArea({ page, options, report, artifactPaths, flushReport, cursor, log }) {
	cursor.area = "cart";
	cursor.metadataType = "cart";
	cursor.componentName = null;

	const cartDepth = resolveCartDepth(options.depth);
	let touchedCartState = false;

	try {
		const existingCartCount = await readCartCount(page);
		if (existingCartCount > 0) {
			await cleanupCartState({
				page,
				report,
				flushReport,
				artifactPaths,
				cursor,
				touchedCartState: true,
			});
		}

		touchedCartState = true;
		const stagingOutcome = await stageCartItemsFromMetadataExplorer({
			page,
			options,
			report,
			artifactPaths,
			flushReport,
			cursor,
			cartDepth,
		});

		if (stagingOutcome === "gap") {
			report.run.counts.typesVisited += 1;
			report.run.counts.coverageGaps = report.coverageGaps.length;
			report.run.counts.errors = report.errors.length;
			await flushReport();
			if (!options.quiet) {
				log("cart [staging] metadata explorer -> gap");
			}
			return;
		}

		if (stagingOutcome !== "staged") {
			return;
		}

		touchedCartState = true;
		cursor.metadataType = "cart";
		cursor.componentName = null;
		report.run.counts.typesVisited += 1;
		report.run.counts.coverageGaps = report.coverageGaps.length;
		report.run.counts.errors = report.errors.length;
		await flushReport();
		if (!options.quiet) {
			log("cart [staging] metadata explorer -> staged");
		}

		await page.locator(".cart-entry-button").click({ timeout: NAVIGATION_TIMEOUT_MS });
		await page.waitForSelector('[role="dialog"][aria-label="Metadata cart workflow"]', {
			timeout: NAVIGATION_TIMEOUT_MS,
		});

		const listReady = await waitForCartListState(page);
		if (listReady === "empty") {
			await addError({
				report,
				flushReport,
				page,
				artifactPaths,
				cursor,
				signal: "console",
				message: "Metadata cart drawer opened but no staged metadata was present.",
			});
			return;
		}
		if (listReady === "timeout") {
			await addError({
				report,
				flushReport,
				page,
				artifactPaths,
				cursor,
				signal: "timeout",
				message: "Metadata cart drawer did not render staged items before timeout.",
			});
			return;
		}

		const nextButton = getCartNextButton(page);
		await nextButton.click({ timeout: NAVIGATION_TIMEOUT_MS });
		await page.locator('button.cart-action-card.danger-card').filter({ hasText: "Delete from org" }).click({
			timeout: NAVIGATION_TIMEOUT_MS,
		});
		await waitForSelectedCartAction(page, "Delete from org");
		await nextButton.click({ timeout: NAVIGATION_TIMEOUT_MS });
		await page.waitForSelector(".destructive-summary", { timeout: NAVIGATION_TIMEOUT_MS });

		await captureFindingScreenshot({
			page,
			artifactPaths,
			filename: buildScreenshotName({
				kind: "component",
				metadataType: "cart-delete-confirm",
				componentName: "Delete from org",
			}),
		});

		report.run.counts.typesVisited += 1;
		report.run.counts.coverageGaps = report.coverageGaps.length;
		report.run.counts.errors = report.errors.length;
		await flushReport();
		if (!options.quiet) {
			log("cart [delete] delete from org -> confirm");
		}

		await page.getByRole("button", { name: "Back" }).click({ timeout: NAVIGATION_TIMEOUT_MS });

		const compareCard = page.getByRole("button", { name: "Compare with org" });
		await compareCard.click({ timeout: NAVIGATION_TIMEOUT_MS });
		await waitForSelectedCartAction(page, "Compare with org");
		await nextButton.click({ timeout: NAVIGATION_TIMEOUT_MS });
		await page.waitForSelector('select[aria-label="Compare target org"]', {
			timeout: NAVIGATION_TIMEOUT_MS,
		});

		const compareTargetSelect = page.locator('select[aria-label="Compare target org"]');
		const compareTargetOptions = compareTargetSelect.locator("option");
		const compareTargetCount = await compareTargetOptions.count();
		if (compareTargetCount === 0) {
			report.run.counts.typesVisited += 1;
			report.run.counts.coverageGaps = report.coverageGaps.length;
			report.run.counts.errors = report.errors.length;
			await flushReport();
			if (!options.quiet) {
				log("cart [compare] compare with org -> skipped (single org)");
			}
			return;
		}

		await compareTargetSelect.selectOption({ index: 0 });
		await page.getByRole("button", { name: "Run Compare" }).click({ timeout: NAVIGATION_TIMEOUT_MS });

		const compareOutcome = await waitForCartCompareOutcome(page);
		if (compareOutcome === "timeout") {
			await addError({
				report,
				flushReport,
				page,
				artifactPaths,
				cursor,
				signal: "timeout",
				message: "cart compare did not reach a terminal state before timeout.",
			});
		}

		report.run.counts.typesVisited += 1;
		report.run.counts.coverageGaps = report.coverageGaps.length;
		report.run.counts.errors = report.errors.length;
		await flushReport();
		if (!options.quiet) {
			log(`cart [compare] compare with org -> ${compareOutcome}`);
		}
	} catch (error) {
		await addError({
			report,
			flushReport,
			page,
			artifactPaths,
			cursor,
			signal: "console",
			message: trimMessage(
				`Crawler cart failure: ${error instanceof Error ? error.message : String(error)}`,
			),
		});
	} finally {
		await cleanupCartState({
			page,
			report,
			flushReport,
			artifactPaths,
			cursor,
			touchedCartState,
		});
	}
}

async function clickMetadataDepth({ page, cursor, depth, delayMs, artifactPaths, metadataType }) {
	if (depth === 0) {
		return;
	}
	await expandGroupedSectionsUntilLinks(page, depth);
	const links = page.locator(".component-link");
	const total = await links.count();
	const max = Math.min(depth, total);

	for (let index = 0; index < max; index++) {
		const link = links.nth(index);
		const componentName = (await link.textContent())?.trim() || `component-${index + 1}`;
		cursor.componentName = componentName;
		await link.click({ timeout: NAVIGATION_TIMEOUT_MS });
		await page.waitForTimeout(delayMs);
		await captureFindingScreenshot({
			page,
			artifactPaths,
			filename: buildScreenshotName({
				kind: "component",
				metadataType,
				componentName,
			}),
		});
	}
	cursor.componentName = null;
}

async function clickObjectDepth({ page, cursor, depth, delayMs, artifactPaths, metadataType }) {
	if (depth === 0) {
		return;
	}
	const links = page.locator(".child-table .component-link");
	const total = await links.count();
	const max = Math.min(depth, total);
	for (let index = 0; index < max; index++) {
		const link = links.nth(index);
		const componentName = (await link.textContent())?.trim() || `component-${index + 1}`;
		cursor.componentName = componentName;
		await link.click({ timeout: NAVIGATION_TIMEOUT_MS });
		await page.waitForTimeout(delayMs);
		await captureFindingScreenshot({
			page,
			artifactPaths,
			filename: buildScreenshotName({
				kind: "component",
				metadataType,
				componentName,
			}),
		});
	}
	cursor.componentName = null;
}

async function waitForComponentOutcome(page) {
	try {
		const handle = await page.waitForFunction(
			() => {
				const hasComponentLink = !!document.querySelector(".component-table .component-link");
				const hasGroupToggle = !!document.querySelector(".component-tree .group-toggle");

				const emptyHeaders = Array.from(
					document.querySelectorAll(".component-explorer .empty-state h3"),
				);
				const hasNoComponents = emptyHeaders.some(
					(header) => header.textContent?.trim() === "No components returned",
				);

				if (hasComponentLink || hasGroupToggle || hasNoComponents) {
					return {
						hasComponentLink,
						hasGroupToggle,
						hasNoComponents,
					};
				}

				return null;
			},
			{ timeout: COMPONENT_WAIT_TIMEOUT_MS },
		);
		const panelState = await handle.jsonValue();
		return classifyComponentPanelState(panelState);
	} catch {
		return "timeout";
	}
}

export function classifyComponentPanelState({ hasComponentLink, hasGroupToggle, hasNoComponents }) {
	if (hasComponentLink) {
		return "components";
	}
	if (hasGroupToggle) {
		return "components-grouped";
	}
	if (hasNoComponents) {
		return "empty";
	}
	return "loading";
}

async function waitForObjectOutcome(page) {
	try {
		const handle = await page.waitForFunction(
			() => {
				const hasComponentLink = !!document.querySelector(".child-table .component-link");
				const hasNoCategoryItems = !!document.querySelector(
					".category-workspace .empty-state.compact-empty",
				);
				if (hasComponentLink || hasNoCategoryItems) {
					return { hasComponentLink, hasNoCategoryItems };
				}
				return null;
			},
			{ timeout: COMPONENT_WAIT_TIMEOUT_MS },
		);
		return classifyObjectPanelState(await handle.jsonValue());
	} catch {
		return "timeout";
	}
}

export function classifyObjectPanelState({ hasComponentLink, hasNoCategoryItems }) {
	if (hasComponentLink) {
		return "components";
	}
	if (hasNoCategoryItems) {
		return "empty";
	}
	return "loading";
}

async function readMetadataTypes(page) {
	const types = await page.locator(".metadata-row-button").evaluateAll((rows) =>
		rows
			.map((row) => {
				const spans = row.querySelectorAll("span");
				const apiName = spans[1]?.textContent?.trim();
				const fallback = spans[0]?.textContent?.trim();
				return apiName || fallback || "";
			})
			.filter(Boolean),
	);
	return Array.from(new Set(types));
}

async function readObjectRows(page) {
	const rows = await page.locator(".object-row-button").evaluateAll((buttons) =>
		buttons
			.map((button) => {
				const spans = button.querySelectorAll("span");
				const apiName = spans[1]?.textContent?.trim();
				const label = spans[0]?.textContent?.trim();
				return apiName || label || "";
			})
			.filter(Boolean),
	);
	return rows;
}

async function addError({ report, flushReport, page, artifactPaths, cursor, signal, message }) {
	const screenshotName = buildScreenshotName({
		kind: "error",
		metadataType: cursor.metadataType,
		componentName: cursor.componentName,
		signal,
	});
	const screenshot = await captureFindingScreenshot({
		page,
		artifactPaths,
		filename: screenshotName,
	});
	report.errors.push({
		area: cursor.area,
		metadataType: cursor.metadataType,
		componentName: cursor.componentName,
		signal,
		message,
		screenshot,
		observedAt: new Date().toISOString(),
	});
	report.run.counts.errors = report.errors.length;
	await flushReport();
}

async function captureFindingScreenshot({ page, artifactPaths, filename }) {
	const absolutePath = path.join(artifactPaths.screenshotsDirectory, filename);
	const savedPath = await saveScreenshot(page, absolutePath);
	return path.relative(artifactPaths.runDirectory, savedPath).replaceAll("\\", "/");
}

async function wireToastObserver(page, onToast) {
	await page.exposeFunction("__mavmetaSmokeToast", async (value) => {
		await onToast(String(value || ""));
	});

	await page.addInitScript(() => {
		function readToastMessage(element) {
			const value = element.textContent ?? "";
			return value.trim();
		}

		function publishToast(element) {
			const message = readToastMessage(element);
			if (!message) {
				return;
			}
			const reportFn = window.__mavmetaSmokeToast;
			if (typeof reportFn === "function") {
				reportFn(message);
			}
		}

		function observeAlerts() {
			const observer = new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					for (const node of mutation.addedNodes) {
						if (!(node instanceof HTMLElement)) {
							continue;
						}
						if (node.getAttribute?.("role") === "alert") {
							publishToast(node);
						}
						const nested = node.querySelector?.('[role="alert"]');
						if (nested) {
							publishToast(nested);
						}
					}
				}
			});
			observer.observe(document.documentElement, {
				childList: true,
				subtree: true,
			});
		}

		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", observeAlerts, { once: true });
		} else {
			observeAlerts();
		}
	});
}

function wireConsoleCapture(page, onConsole) {
	page.on("console", (message) => {
		if (message.type() !== "error") {
			return;
		}
		void onConsole(message.text());
	});
}

function wireNetworkCapture(page, onNetwork) {
	page.on("response", (response) => {
		const status = response.status();
		if (status < 400) {
			return;
		}

		const request = response.request();
		const method = request.method();
		const urlPath = formatUrlPath(response.url());
		const message = `${method} ${status} ${urlPath}`;
		const isAuthExpiry = method === "GET" && status === 401 && urlPath.startsWith("/services/data/");
		void onNetwork({ message, isAuthExpiry });
	});
}

function formatUrlPath(value) {
	try {
		const parsed = new URL(value);
		return `${parsed.pathname}${parsed.search}`;
	} catch {
		return value;
	}
}

function trimMessage(value) {
	return String(value || "").trim().slice(0, 500);
}

async function appendCommentToFirstFileBySuffix({ page, suffix, comment }) {
	const tabs = page.locator(".file-tabs .file-tab");
	const tabCount = await tabs.count();
	let targetIndex = -1;
	for (let index = 0; index < tabCount; index++) {
		const text = ((await tabs.nth(index).textContent()) || "").trim().toLowerCase();
		if (text.includes(suffix.toLowerCase())) {
			targetIndex = index;
			break;
		}
	}
	if (targetIndex < 0) {
		return false;
	}

	await tabs.nth(targetIndex).click({ timeout: NAVIGATION_TIMEOUT_MS });
	await page.waitForSelector(".code-editor .cm-content", { timeout: NAVIGATION_TIMEOUT_MS });
	const editor = page.locator(".code-editor .cm-content").first();
	await editor.click({ timeout: NAVIGATION_TIMEOUT_MS });
	await page.keyboard.press("Control+End");
	await page.keyboard.press("Enter");
	await page.keyboard.type(comment);
	await page.waitForTimeout(80);
	return true;
}

async function waitForLwcDeployOutcome(page) {
	try {
		const handle = await page.waitForFunction(
			() => {
				const statusEl = document.querySelector(".playground-status");
				const text = statusEl?.textContent?.trim() ?? "";
				if (!text) return null;
				if (/deployed/i.test(text)) return { kind: "success", message: text };
				if (/deploy failed|deploy conflict|request failed|error/i.test(text)) {
					return { kind: "error", message: text };
				}
				return null;
			},
			{ timeout: DEPLOY_WAIT_TIMEOUT_MS },
		);
		return await handle.jsonValue();
	} catch {
		return { kind: "error", message: "LWC deploy did not reach a terminal status before timeout." };
	}
}

async function waitForRestResponseOutcome(page) {
	try {
		const handle = await page.waitForFunction(
			() => {
				const hasError = !!document.querySelector(".rest-error[role='alert']");
				const hasResponse = !!document.querySelector(".rest-response-section");
				const hasHistory = !!document.querySelector(".rest-history-section");
				if (hasResponse) return "response";
				if (hasError) return "error";
				if (hasHistory) return "response";
				return null;
			},
			{ timeout: COMPONENT_WAIT_TIMEOUT_MS },
		);
		return await handle.jsonValue();
	} catch {
		return "timeout";
	}
}

async function waitForSoqlRunOutcome(page) {
	try {
		const handle = await page.waitForFunction(
			() => {
				const hasRows = !!document.querySelector(".soql-results .metadata-row:not(.table-heading)");
				const hasError = !!document.querySelector(".soql-error[role='alert']");
				const hasStatusError = !!document.querySelector(".soql-status--error");
				if (hasRows) return "result";
				if (hasError || hasStatusError) return "error";
				return null;
			},
			{ timeout: SOQL_WAIT_TIMEOUT_MS },
		);
		return await handle.jsonValue();
	} catch {
		return "timeout";
	}
}

async function waitForCartCompareOutcome(page) {
	try {
		const handle = await page.waitForFunction(
			() => {
				const hasResult = !!document.querySelector(".deployment-result-summary");
				const hasEmptyState = Array.from(
					document.querySelectorAll(".empty-state.compact-empty"),
				).some((element) => {
					const text = element.textContent?.trim() ?? "";
					return text === "No compare results yet.";
				});
				if (hasResult || hasEmptyState) {
					return { hasResult, hasEmptyState };
				}
				return null;
			},
			{ timeout: CART_COMPARE_WAIT_TIMEOUT_MS },
		);
		return classifyCartCompareOutcome(await handle.jsonValue());
	} catch {
		return "timeout";
	}
}

export function classifyCartCompareOutcome({ hasResult, hasEmptyState }) {
	if (hasResult) {
		return "result";
	}
	if (hasEmptyState) {
		return "empty";
	}
	return "loading";
}

async function runSoqlScenario({
	page,
	soqlRoot,
	apiLabel,
	sobject,
	filterField,
	filterOperator,
	filterValue,
	orderField,
	orderDirection,
	limit,
}) {
	const apiButton = soqlRoot.getByRole("button", { name: apiLabel, exact: true });
	if ((await apiButton.getAttribute("aria-pressed")) !== "true") {
		await apiButton.click({ timeout: NAVIGATION_TIMEOUT_MS });
	}

	await selectSoqlObject(soqlRoot, sobject);

	await waitForSoqlObjectReady(page, sobject);

	await soqlRoot.getByRole("button", { name: "Clear", exact: true }).click();
	await page.waitForFunction(
		() => document.querySelectorAll(".soql-field[aria-pressed='true']").length === 0,
		{ timeout: NAVIGATION_TIMEOUT_MS },
	);

	await soqlRoot.getByRole("button", { name: "All", exact: true }).click();
	await page.waitForFunction(
		() => document.querySelectorAll(".soql-field[aria-pressed='true']").length > 0,
		{ timeout: NAVIGATION_TIMEOUT_MS },
	);

	await expandSoqlSection(soqlRoot.locator(".soql-section-toggle", { hasText: "Filters" }).first());
	await soqlRoot.getByRole("button", { name: "+ Add filter" }).click();
	await soqlRoot.getByLabel("Filter field 1").selectOption(filterField);
	await soqlRoot.getByLabel("Filter operator 1").selectOption(filterOperator);
	if (filterValue !== null) {
		await soqlRoot.getByLabel("Filter value 1").fill(filterValue);
	}

	await expandSoqlSection(
		soqlRoot.locator(".soql-section-toggle", { hasText: "Sort & Limit" }).first(),
	);
	await soqlRoot.getByLabel("Order by field").selectOption(orderField);
	await soqlRoot.getByLabel("Order direction").selectOption(orderDirection);
	await soqlRoot.getByLabel("Row limit").fill(limit);

	await soqlRoot.getByRole("button", { name: "Copy", exact: true }).click();

	await collapseSoqlSection(soqlRoot.locator(".soql-section-toggle", { hasText: "Filters" }).first());
	await collapseSoqlSection(
		soqlRoot.locator(".soql-section-toggle", { hasText: "Sort & Limit" }).first(),
	);
	await collapseSoqlSection(soqlRoot.locator(".soql-section-toggle", { hasText: "Query" }).first());

	await soqlRoot.getByRole("button", { name: /^Run$/i }).click();
	return waitForSoqlRunOutcome(page);
}

async function waitForSoqlObjectReady(page, sobject) {
	const escapedSObject = sobject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	await page.waitForFunction(
		(soqlRegex) => {
			const selected = document.querySelectorAll(".soql-field[aria-pressed='true']").length;
			const total = document.querySelectorAll(".soql-field").length;
			const queryText = document.querySelector(".soql-editor .cm-content")?.textContent ?? "";
			return total > 0 && selected > 0 && new RegExp(soqlRegex, "i").test(queryText);
		},
		`FROM\\s+${escapedSObject}\\b`,
		{ timeout: SOQL_WAIT_TIMEOUT_MS },
	);
}

async function stageCartItemsFromMetadataExplorer({
	page,
	options,
	report,
	artifactPaths,
	flushReport,
	cursor,
	cartDepth,
}) {
	await page.getByRole("button", { name: "Metadata Explorer" }).click();
	await page.waitForSelector('.metadata-table[aria-label="Metadata types"]', {
		timeout: NAVIGATION_TIMEOUT_MS,
	});

	const rows = await readMetadataTypes(page);
	if (rows.length === 0) {
		const screenshot = await captureFindingScreenshot({
			page,
			artifactPaths,
			filename: buildScreenshotName({
				kind: "coverage-gap",
				metadataType: "CartStaging",
			}),
		});
		report.coverageGaps.push({
			kind: "zero-result",
			area: "cart",
			metadataType: "CartStaging",
			screenshot,
			observedAt: new Date().toISOString(),
		});
		return "gap";
	}

	const { startIndex } = resolveStartIndex({
		rows,
		jump: options.jump,
		area: "cart",
	});

	for (let rowIndex = startIndex; rowIndex < rows.length; rowIndex++) {
		const rowName = rows[rowIndex];
		cursor.metadataType = rowName;
		cursor.componentName = null;

		await page.locator(".metadata-row-button").nth(rowIndex).click({ timeout: NAVIGATION_TIMEOUT_MS });
		const outcome = await waitForComponentOutcome(page);
		if (outcome === "timeout") {
			await addError({
				report,
				flushReport,
				page,
				artifactPaths,
				cursor,
				signal: "timeout",
				message: `no response within 15s while awaiting cart staging row ${rowName}`,
			});
			continue;
		}
		if (outcome === "empty") {
			continue;
		}

		const stageOutcome = await stageCartComponentsForCurrentType({
			page,
			options,
			report,
			artifactPaths,
			flushReport,
			cursor,
			rowName,
			cartDepth,
		});
		if (stageOutcome !== "staged") {
			return stageOutcome;
		}
		return "staged";
	}

	const screenshot = await captureFindingScreenshot({
		page,
		artifactPaths,
		filename: buildScreenshotName({
			kind: "coverage-gap",
			metadataType: "CartStaging",
		}),
	});
	report.coverageGaps.push({
		kind: "zero-result",
		area: "cart",
		metadataType: "CartStaging",
		screenshot,
		observedAt: new Date().toISOString(),
	});
	return "gap";
}

async function stageCartComponentsForCurrentType({
	page,
	options,
	report,
	artifactPaths,
	flushReport,
	cursor,
	rowName,
	cartDepth,
}) {
	if ((await page.locator(".component-link").count()) === 0) {
		await expandGroupedSectionsUntilLinks(page, cartDepth);
	}

	const componentLinks = page.locator(".component-link");
	const total = await componentLinks.count();
	const max = Math.min(cartDepth, total);
	if (max === 0) {
		await addError({
			report,
			flushReport,
			page,
			artifactPaths,
			cursor,
			signal: "console",
			message: `Metadata Explorer rendered no stageable components for ${rowName}`,
		});
		return "error";
	}

	const baseCartCount = await readCartCount(page);
	for (let index = 0; index < max; index++) {
		const link = componentLinks.nth(index);
		const componentName = trimMessage((await link.textContent()) || `component-${index + 1}`);
		cursor.componentName = componentName;
		await link.click({ timeout: NAVIGATION_TIMEOUT_MS });

		const componentRow = link.locator("xpath=ancestor::div[contains(@class, 'component-row')][1]");
		const stageButton = componentRow.getByRole("button", { name: "Stage", exact: true });
		if ((await stageButton.count()) === 0) {
			await addError({
				report,
				flushReport,
				page,
				artifactPaths,
				cursor,
				signal: "console",
				message: `Stage toggle did not appear for ${componentName}`,
			});
			return "error";
		}
		await stageButton.click({ timeout: NAVIGATION_TIMEOUT_MS });

		const expectedCount = baseCartCount + index + 1;
		if (!(await waitForCartCount(page, expectedCount))) {
			await addError({
				report,
				flushReport,
				page,
				artifactPaths,
				cursor,
				signal: "timeout",
				message: `cart count did not reach ${expectedCount} after staging ${componentName}`,
			});
			return "error";
		}
	}

	cursor.componentName = null;
	return "staged";
}

async function cleanupCartState({
	page,
	report,
	flushReport,
	artifactPaths,
	cursor,
	touchedCartState,
}) {
	if (!touchedCartState) {
		return;
	}

	let cartCount = await readCartCount(page);
	let drawerVisible =
		(await page.locator('[role="dialog"][aria-label="Metadata cart workflow"]').count()) > 0;
	if (cartCount === 0 && !drawerVisible) {
		return;
	}

	if (!drawerVisible) {
		await page.locator(".cart-entry-button").click({ timeout: NAVIGATION_TIMEOUT_MS });
		await page.waitForSelector('[role="dialog"][aria-label="Metadata cart workflow"]', {
			timeout: NAVIGATION_TIMEOUT_MS,
		});
	}

	await ensureCartListStep(page);
	drawerVisible = (await page.locator('[role="dialog"][aria-label="Metadata cart workflow"]').count()) > 0;
	if (!drawerVisible && cartCount > 0) {
		await page.locator(".cart-entry-button").click({ timeout: NAVIGATION_TIMEOUT_MS });
		await page.waitForSelector('[role="dialog"][aria-label="Metadata cart workflow"]', {
			timeout: NAVIGATION_TIMEOUT_MS,
		});
		await ensureCartListStep(page);
	}

	const clearAllButton = page.locator('button.text-btn--danger', { hasText: "Clear All" }).first();
	if ((await clearAllButton.count()) > 0) {
		await clearAllButton.click({ timeout: NAVIGATION_TIMEOUT_MS });
		if (!(await waitForCartCount(page, 0))) {
			await addError({
				report,
				flushReport,
				page,
				artifactPaths,
				cursor,
				signal: "timeout",
				message: "Cart cleanup did not clear staged items before timeout.",
			});
		}
	}

	const closeButton = page.locator(".close-drawer-button").first();
	if ((await closeButton.count()) > 0) {
		await closeButton.click({ timeout: NAVIGATION_TIMEOUT_MS });
	}
}

async function ensureCartListStep(page) {
	for (let attempts = 0; attempts < 4; attempts++) {
		const clearAllButton = page.locator('button.text-btn--danger', { hasText: "Clear All" }).first();
		if ((await clearAllButton.count()) > 0) {
			return;
		}
		const backButton = page.getByRole("button", { name: "Back" });
		if ((await backButton.count()) === 0) {
			const finishCloseButton = page.getByRole("button", { name: "Finish & Close" });
			if ((await finishCloseButton.count()) > 0) {
				await finishCloseButton.click({ timeout: NAVIGATION_TIMEOUT_MS });
				await page.waitForTimeout(100);
				continue;
			}
			return;
		}
		await backButton.click({ timeout: NAVIGATION_TIMEOUT_MS });
		await page.waitForTimeout(100);
	}
}

async function waitForCartListState(page) {
	try {
		const handle = await page.waitForFunction(
			() => {
				const hasGroups = !!document.querySelector(".staged-group[aria-label]");
				const emptyState = Array.from(document.querySelectorAll(".empty-state.compact-empty")).some(
					(element) => {
						const text = element.textContent?.trim() ?? "";
						return text.startsWith("No staged metadata");
					},
				);
				if (hasGroups || emptyState) {
					return { hasGroups, emptyState };
				}
				return null;
			},
			{ timeout: NAVIGATION_TIMEOUT_MS },
		);
		const state = await handle.jsonValue();
		return state.hasGroups ? "items" : "empty";
	} catch {
		return "timeout";
	}
}

export function getCartNextButton(page) {
	return page.getByRole("button", { name: "Next", exact: true });
}

async function waitForSelectedCartAction(page, actionLabel) {
	const selectedAction = page.locator("button.cart-action-card.selected").filter({
		hasText: actionLabel,
	}).first();
	await selectedAction.waitFor({ state: "visible", timeout: NAVIGATION_TIMEOUT_MS });
}

async function waitForCartCount(page, expectedCount) {
	try {
		await page.waitForFunction(
			(value) => {
				const text = document.querySelector(".cart-count")?.textContent?.trim() ?? "";
				const parsed = Number.parseInt(text, 10);
				return Number.isInteger(parsed) && parsed === value;
			},
			expectedCount,
			{ timeout: NAVIGATION_TIMEOUT_MS },
		);
		return true;
	} catch {
		return false;
	}
}

async function readCartCount(page) {
	const text = trimMessage(await page.locator(".cart-count").first().textContent().catch(() => ""));
	const match = text.match(/\d+/);
	return match ? Number(match[0]) : 0;
}

function resolveCartDepth(depth) {
	if (depth > 0) {
		return Math.min(depth, 3);
	}
	return 3;
}

async function selectSoqlObject(soqlRoot, sobject) {
	const sobjectInput = soqlRoot.getByLabel("SObject");
	await sobjectInput.click({ timeout: NAVIGATION_TIMEOUT_MS });
	await sobjectInput.fill(sobject);

	const escaped = sobject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const exactOption = soqlRoot
		.locator(".soql-autocomplete-option")
		.filter({ hasText: new RegExp(`\\(${escaped}\\)`, "i") })
		.first();

	try {
		await exactOption.waitFor({ timeout: SOQL_WAIT_TIMEOUT_MS });
		await exactOption.click({ timeout: NAVIGATION_TIMEOUT_MS });
		return;
	} catch {
		// Fall back to keyboard selection if the menu is slow to render.
		await sobjectInput.press("Enter");
	}
}

async function waitForLwcBundlePanelState(page) {
	const deadline = Date.now() + LWC_BUNDLE_WAIT_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const hasItems = (await page.locator(".bundle-list-items .bundle-item").count()) > 0;
		if (hasItems) return "items";

		const emptyText =
			((await page
				.locator(".bundle-list-empty")
				.first()
				.textContent()
				.catch(() => "")) || "").trim();
		const hasTrueEmpty = /no lwc bundles found/i.test(emptyText);

		const loadingText =
			((await page
				.locator(".bundle-list-loading")
				.first()
				.textContent()
				.catch(() => "")) || "").trim();
		const hasLoading = /loading bundles/i.test(loadingText);

		const state = classifyLwcBundlePanelState({ hasItems, hasLoading, hasTrueEmpty });
		if (state !== "loading") return state;
		await page.waitForTimeout(200);
	}
	return "timeout";
}

export function classifyLwcBundlePanelState({ hasItems, hasLoading, hasTrueEmpty }) {
	if (hasItems) return "items";
	if (!hasLoading && hasTrueEmpty) return "empty";
	return "loading";
}

async function selectFirstLwcBundle(page) {
	const firstBundle = page.locator(".bundle-list-items .bundle-item").first();
	if ((await firstBundle.count()) === 0) {
		return "missing";
	}
	await firstBundle.scrollIntoViewIfNeeded().catch(() => {});
	await firstBundle.click({ timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});

	let selectedCount = await page.locator('.bundle-list-items .bundle-item[aria-selected="true"]').count();
	if (selectedCount > 0) {
		return "selected";
	}

	await firstBundle.focus().catch(() => {});
	await page.keyboard.press("Enter").catch(() => {});
	await page.waitForTimeout(120);
	selectedCount = await page.locator('.bundle-list-items .bundle-item[aria-selected="true"]').count();
	return selectedCount > 0 ? "selected" : "not-selected";
}

async function collapseSoqlSection(toggleLocator) {
	if ((await toggleLocator.count()) === 0) {
		return;
	}
	if ((await toggleLocator.getAttribute("aria-expanded")) === "true") {
		await toggleLocator.click({ timeout: NAVIGATION_TIMEOUT_MS });
	}
}

async function expandSoqlSection(toggleLocator) {
	if ((await toggleLocator.count()) === 0) {
		return;
	}
	if ((await toggleLocator.getAttribute("aria-expanded")) === "false") {
		await toggleLocator.click({ timeout: NAVIGATION_TIMEOUT_MS });
	}
}

async function crawlObjectExplorerAccountCategories({
	page,
	rowName,
	cursor,
	report,
	artifactPaths,
	flushReport,
	options,
}) {
	const categoryButtons = page.locator(".category-tab");
	const categoryCount = await categoryButtons.count();
	for (let categoryIndex = 0; categoryIndex < categoryCount; categoryIndex++) {
		const categoryButton = categoryButtons.nth(categoryIndex);
		const categoryName = trimMessage(
			(await categoryButton.locator(".tab-label").textContent()) ||
				(await categoryButton.textContent()) ||
				`category-${categoryIndex + 1}`,
		);
		await categoryButton.click({ timeout: NAVIGATION_TIMEOUT_MS });
		await page.waitForTimeout(options.delayMs);

		const objectCategoryKey = `${rowName}::${categoryName}`;
		cursor.metadataType = objectCategoryKey;
		cursor.componentName = null;

		const outcome = await waitForObjectOutcome(page);
		if (outcome === "timeout") {
			await addError({
				report,
				flushReport,
				page,
				artifactPaths,
				cursor,
				signal: "timeout",
				message: `no response within 15s while awaiting object category ${categoryName}`,
			});
			continue;
		}
		if (outcome === "empty") {
			const screenshot = await captureFindingScreenshot({
				page,
				artifactPaths,
				filename: buildScreenshotName({
					kind: "coverage-gap",
					metadataType: objectCategoryKey,
				}),
			});
			report.coverageGaps.push({
				kind: "zero-result",
				area: "object-explorer",
				metadataType: objectCategoryKey,
				screenshot,
				observedAt: new Date().toISOString(),
			});
			continue;
		}
		await clickObjectDepth({
			page,
			cursor,
			depth: options.depth,
			delayMs: options.delayMs,
			artifactPaths,
			metadataType: objectCategoryKey,
		});
	}
	cursor.metadataType = rowName;
	cursor.componentName = null;
}

function resolveStartIndex({ rows, jump, area }) {
	if (!jump) {
		return { startIndex: 0 };
	}
	const needle = jump.toLowerCase();
	const index = rows.findIndex((row) => row.toLowerCase().includes(needle));
	if (index < 0) {
		throw new Error(`No ${area} row matched --jump "${jump}".`);
	}
	return { startIndex: index };
}

export function shouldSweepAllObjectCategories(rowName) {
	return String(rowName || "").trim().toLowerCase() === "account";
}

async function expandGroupedSectionsUntilLinks(page, depth) {
	const targetLinks = Math.max(1, depth);
	let linksCount = await page.locator(".component-link").count();
	if (linksCount >= targetLinks) {
		return;
	}

	for (;;) {
		const collapsedToggle = page
			.locator('.component-tree .group-toggle[aria-expanded="false"]')
			.first();
		const hasCollapsedToggle = (await collapsedToggle.count()) > 0;
		if (!hasCollapsedToggle) {
			break;
		}
		await collapsedToggle.click({ timeout: NAVIGATION_TIMEOUT_MS });
		await page.waitForTimeout(100);
		linksCount = await page.locator(".component-link").count();
		if (linksCount >= targetLinks) {
			break;
		}
	}
}
