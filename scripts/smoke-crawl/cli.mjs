// @ts-nocheck
import { parseArgs } from "node:util";

const DEFAULT_DEPTH = 2;
const DEFAULT_DELAY_MS = 500;
const DEFAULT_APP_URL = "http://localhost:5173";
const DEFAULT_AREAS = [
	"metadata-explorer",
	"object-explorer",
	"lwc-editor",
	"rest-explorer",
	"soql-explorer",
];
const ALLOWED_AREAS = new Set(DEFAULT_AREAS);

export function parseCliArgs(argv = process.argv.slice(2)) {
	const { values } = parseArgs({
		args: argv,
		options: {
			depth: { type: "string" },
			"delay-ms": { type: "string" },
			org: { type: "string" },
			"app-url": { type: "string" },
			areas: { type: "string" },
			jump: { type: "string" },
			quiet: { type: "boolean", default: false },
			help: { type: "boolean", short: "h", default: false },
		},
		allowPositionals: false,
	});

	if (values.help) {
		return { help: true };
	}

	const depth = parseIntegerFlag(values.depth, "--depth", { min: 0, fallback: DEFAULT_DEPTH });
	const delayMs = parseIntegerFlag(values["delay-ms"], "--delay-ms", {
		min: 0,
		fallback: DEFAULT_DELAY_MS,
	});
	const appUrl = normalizeAppUrl(values["app-url"] ?? DEFAULT_APP_URL);
	const org = values.org?.trim() || undefined;
	const jump = values.jump?.trim() || undefined;
	const areas = parseAreas(values.areas);

	return {
		help: false,
		depth,
		delayMs,
		appUrl,
		org,
		areas,
		jump,
		quiet: values.quiet === true,
	};
}

export function getUsageText() {
	return `
Usage:
  npm run smoke -- [options]

Options:
  --depth <N>       Max components to click per metadata type (default: ${DEFAULT_DEPTH})
  --delay-ms <N>    Delay between interactions in milliseconds (default: ${DEFAULT_DELAY_MS})
  --areas <list>    Comma-separated areas: metadata-explorer,object-explorer,lwc-editor,rest-explorer,soql-explorer
  --jump <text>     Start crawling at the first matching row label/API name
  --org <alias>     Org alias or username to set active before crawling
  --app-url <url>   Frontend URL (default: ${DEFAULT_APP_URL})
  --quiet           Suppress per-type progress lines
  -h, --help        Show this help
`.trim();
}

function parseAreas(value) {
	if (!value?.trim()) {
		return [...DEFAULT_AREAS];
	}

	const parts = value
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
	if (parts.length === 0) {
		return [...DEFAULT_AREAS];
	}
	for (const area of parts) {
		if (!ALLOWED_AREAS.has(area)) {
			throw new Error(
				`--areas contains unsupported value "${area}". Allowed values: ${[...ALLOWED_AREAS].join(", ")}`,
			);
		}
	}
	return Array.from(new Set(parts));
}

function parseIntegerFlag(value, flagName, { min, fallback }) {
	if (value === undefined) {
		return fallback;
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < min) {
		throw new Error(`${flagName} must be an integer >= ${min}. Received "${value}".`);
	}
	return parsed;
}

function normalizeAppUrl(value) {
	const trimmed = value.trim();
	if (!trimmed) {
		throw new Error("--app-url must be a non-empty URL.");
	}

	let parsed;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error(`--app-url must be a valid URL. Received "${value}".`);
	}

	if (!["http:", "https:"].includes(parsed.protocol)) {
		throw new Error(`--app-url must use http or https. Received "${value}".`);
	}

	parsed.hash = "";
	parsed.search = "";
	if (parsed.pathname !== "/") {
		parsed.pathname = parsed.pathname.replace(/\/+$/, "");
	}
	return parsed.toString().replace(/\/$/, "");
}
