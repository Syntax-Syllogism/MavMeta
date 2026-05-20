import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST_DIR = "dist";

function collectHtmlFiles(dir) {
	const entries = readdirSync(dir);
	const files = [];
	for (const entry of entries) {
		const fullPath = join(dir, entry);
		const stats = statSync(fullPath);
		if (stats.isDirectory()) {
			files.push(...collectHtmlFiles(fullPath));
			continue;
		}
		if (entry.endsWith(".html")) {
			files.push(fullPath);
		}
	}
	return files;
}

function findViolations(html) {
	const violations = [];
	const inlineScriptPattern = /<script\b(?![^>]*\bsrc=)[^>]*>/gi;
	const inlineHandlerPattern = /\son[a-z]+\s*=/gi;
	const javascriptHrefPattern = /\b(?:href|src)\s*=\s*["']\s*javascript:/gi;

	if (inlineScriptPattern.test(html)) {
		violations.push("inline <script> tag without src");
	}
	if (inlineHandlerPattern.test(html)) {
		violations.push("inline event handler attribute (on*)");
	}
	if (javascriptHrefPattern.test(html)) {
		violations.push("javascript: URL usage");
	}
	return violations;
}

const htmlFiles = collectHtmlFiles(DIST_DIR);
if (!htmlFiles.length) {
	console.error("No HTML files found in dist/. Run build first.");
	process.exit(1);
}

const errors = [];
for (const file of htmlFiles) {
	const content = readFileSync(file, "utf8");
	const violations = findViolations(content);
	if (violations.length) {
		errors.push({ file, violations });
	}
}

if (errors.length) {
	for (const error of errors) {
		console.error(`${error.file}: ${error.violations.join(", ")}`);
	}
	process.exit(1);
}

console.log("Inline script/event-handler check passed.");
