import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const APP_URL = process.env.MAVMETA_SCREENSHOT_URL ?? "http://localhost:5173";
const OUTPUT_DIR = path.resolve("docs/screenshots");
const LIGHT_DIR = path.join(OUTPUT_DIR, "light");
const WAIT_TIMEOUT_MS = 45000;
const CART_STORAGE_KEY = "mavmeta:staged-items";

async function ensureDir() {
	await fs.mkdir(OUTPUT_DIR, { recursive: true });
	await fs.mkdir(LIGHT_DIR, { recursive: true });
}

async function capture(page, filename, theme = "dark") {
	const savePath = theme === "light" ? path.join(LIGHT_DIR, filename) : path.join(OUTPUT_DIR, filename);
	await page.screenshot({
		path: savePath,
		fullPage: true,
	});
}

async function clickNav(page, ariaLabel) {
	await page.getByRole("button", { name: ariaLabel }).click();
	await page.waitForTimeout(700);
}

async function prepareMetadataScreenshot(page) {
	await page.waitForSelector('.metadata-table[aria-label="Metadata types"]', {
		timeout: WAIT_TIMEOUT_MS,
	});
	await page.waitForFunction(() => {
		return document.querySelectorAll(".metadata-row-button").length > 0;
	});

	const filterInput = page.getByPlaceholder("ApexClass, CustomObject, Flow...");
	await filterInput.fill("Apex");
	await page.waitForTimeout(300);

	const apexTypeRow = page.locator(".metadata-row-button", { hasText: "ApexClass" }).first();
	await apexTypeRow.click();

	await page.waitForSelector('.component-table[aria-label="Metadata components"] .component-link', {
		timeout: WAIT_TIMEOUT_MS,
	});
	await page.locator('.component-table[aria-label="Metadata components"] .component-link').first().click();
	await page.waitForTimeout(700);
}

async function prepareObjectsScreenshot(page) {
	await page.waitForSelector('.object-table[aria-label="Object directory"]', {
		timeout: WAIT_TIMEOUT_MS,
	});
	await page.waitForFunction(() => {
		return document.querySelectorAll(".object-row-button").length > 0;
	});

	const accountRow = page.locator(".object-row-button", { hasText: "Account" }).first();
	await accountRow.click();
	await page.waitForTimeout(700);
}

async function prepareLwcScreenshot(page) {
	await page.waitForSelector('aside.bundle-list[aria-label="LWC Bundle List"]', {
		timeout: WAIT_TIMEOUT_MS,
	});
	await page.waitForSelector('ul.bundle-list-items[aria-label="LWC bundles"] li.bundle-item', {
		timeout: WAIT_TIMEOUT_MS,
	});
	await page.locator('ul.bundle-list-items[aria-label="LWC bundles"] li.bundle-item').first().click();

	await page.waitForSelector('.file-tabs[aria-label="Bundle files"] .file-tab', {
		timeout: WAIT_TIMEOUT_MS,
	});
	await page.waitForTimeout(700);
}

async function trySelectCheckr(page) {
	const select = page.locator("label.quick-switcher select");
	if ((await select.count()) === 0) return;
	const options = await select.locator("option").allTextContents();
	const checkrOption = options.find((text) => text.toLowerCase().includes("checkr"));
	if (!checkrOption) return;
	await select.selectOption({ label: checkrOption.trim() });
	await page.waitForTimeout(1200);
}

async function seedStagedItems(page) {
	const activeUsername = await page
		.locator("label.quick-switcher select")
		.inputValue()
		.catch(() => "");
	if (!activeUsername) return false;

	const components = [
		{ metadataType: "CustomField", fullName: "Account.TestField__c" },
		{ metadataType: "ApexClass", fullName: "ObsoleteBatchClass" },
		{ metadataType: "Layout", fullName: "Account-Account Layout" },
	];

	await page.evaluate(
		({ key, username, list }) => {
			const staged = list.map((item) => ({
				id: `${username}::${item.metadataType}::${item.fullName.toLowerCase()}`,
				orgUsername: username,
				metadataType: item.metadataType,
				fullName: item.fullName,
				component: {
					fullName: item.fullName,
					type: item.metadataType,
					fileName: `${item.fullName}.xml`,
				},
			}));
			localStorage.setItem(key, JSON.stringify(staged));
		},
		{ key: CART_STORAGE_KEY, username: activeUsername, list: components },
	);
	return true;
}

async function openWizardAndCapture(page, theme) {
	await page.getByRole("button", { name: "Metadata Cart" }).click();
	await page.waitForSelector(".cart-drawer", { timeout: WAIT_TIMEOUT_MS });
	await capture(page, "wizard-01-list.png", theme);

	await page.getByRole("button", { name: "Next" }).click().catch(async () => {
		await page.getByRole("button", { name: "Next Step" }).first().click();
	});
	await page.waitForTimeout(600);
	await capture(page, "wizard-02-actions.png", theme);

	const actionNames = ["delete", "deploy", "compare"];
	let pickedAction = false;
	for (const name of actionNames) {
		const button = page.locator(`button[data-action="${name}"]`);
		if ((await button.count()) > 0) {
			await button.first().click();
			pickedAction = true;
			break;
		}
	}
	if (!pickedAction) {
		for (const label of ["Delete", "Deploy", "Compare"]) {
			const candidate = page.getByRole("button", { name: new RegExp(label, "i") }).first();
			if (await candidate.isVisible().catch(() => false)) {
				await candidate.click().catch(() => {});
				pickedAction = true;
				break;
			}
		}
	}

	await page.getByRole("button", { name: "Next" }).click().catch(async () => {
		await page.getByRole("button", { name: "Next Step" }).first().click();
	});
	await page.waitForTimeout(700);
	await capture(page, "wizard-03-confirm.png", theme);
}

async function runCaptureSuite(page, theme) {
	await page.goto(APP_URL, { waitUntil: "networkidle", timeout: WAIT_TIMEOUT_MS });
	await page.waitForSelector('main.app-shell, [aria-label="Primary"]', {
		timeout: WAIT_TIMEOUT_MS,
	});
	await trySelectCheckr(page);
	await capture(page, "nav-01-orgs.png", theme);

	await clickNav(page, "Metadata Explorer");
	await prepareMetadataScreenshot(page);
	await capture(page, "nav-02-metadata.png", theme);

	await clickNav(page, "Object Explorer");
	await prepareObjectsScreenshot(page);
	await capture(page, "nav-03-objects.png", theme);

	await clickNav(page, "REST Explorer");
	await capture(page, "nav-04-rest.png", theme);

	await clickNav(page, "LWC Editor");
	await prepareLwcScreenshot(page);
	await capture(page, "nav-05-lwc.png", theme);

	await clickNav(page, "Metadata Explorer");
	const seeded = await seedStagedItems(page);
	if (seeded) {
		await page.reload({ waitUntil: "networkidle", timeout: WAIT_TIMEOUT_MS });
		await page.waitForSelector('main.app-shell, [aria-label="Primary"]', {
			timeout: WAIT_TIMEOUT_MS,
		});
		await trySelectCheckr(page);
		await openWizardAndCapture(page, theme);
	}
}

async function main() {
	await ensureDir();
	const browser = await chromium.launch({ headless: true });

	try {
		for (const theme of ["dark", "light"]) {
			console.log(`Capturing ${theme} theme screenshots...`);
			const context = await browser.newContext({ viewport: { width: 1680, height: 1020 } });
			const page = await context.newPage();

			// Set theme preference in localStorage before the page loads
			await page.addInitScript((t) => {
				window.localStorage.setItem("theme", t);
			}, theme);

			await runCaptureSuite(page, theme);
			await context.close();
		}
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
