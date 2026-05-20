import fs from "node:fs";
import path from "node:path";

const APPROVED_HOST_PATTERN =
	/^https:\/\/([^.]+\.)*(salesforce\.com|force\.com|lightning\.force\.com|salesforce-setup\.com|cloudforce\.com)(?::\d+)?(?=[/?#]|$)/i;
const ALLOWED_DOC_URL_PATTERN = /^https:\/\/svelte\.dev\/e\//i;

const HTTPS_URL_PATTERN = /https:\/\/[^\s"'<>`)\]]+/gi;
const TEXT_FILE_EXTENSIONS = new Set([
	".html",
	".htm",
	".css",
	".js",
	".mjs",
	".cjs",
	".map",
	".txt",
	".json",
]);

/**
 * @param {string} content
 * @returns {string[]}
 */
export function findDisallowedHttpsUrls(content) {
	const matches = content.match(HTTPS_URL_PATTERN) ?? [];
	return Array.from(new Set(matches)).filter(
		(url) => !APPROVED_HOST_PATTERN.test(url) && !ALLOWED_DOC_URL_PATTERN.test(url),
	);
}

/**
 * @param {string} rootDir
 * @returns {string}
 */
function collectFileContents(rootDir) {
	const pending = [rootDir];
	const chunks = [];
	while (pending.length) {
		const current = pending.pop();
		if (!current || !fs.existsSync(current)) continue;
		const stats = fs.statSync(current);
		if (stats.isDirectory()) {
			for (const entry of fs.readdirSync(current)) {
				pending.push(path.join(current, entry));
			}
			continue;
		}
		if (!TEXT_FILE_EXTENSIONS.has(path.extname(current).toLowerCase())) {
			continue;
		}
		chunks.push(fs.readFileSync(current, "utf8"));
	}
	return chunks.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const distRoot = path.resolve("dist");
	const content = collectFileContents(distRoot);
	const disallowed = findDisallowedHttpsUrls(content);
	if (disallowed.length > 0) {
		console.error("Unexpected external HTTPS URLs found in dist:");
		for (const url of disallowed) {
			console.error(url);
		}
		process.exit(1);
	}
}
