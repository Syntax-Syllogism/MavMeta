import { createApp } from "./app";
import { installAuthFileWriteGuard } from "./auth-file-write-guard";
import { maybeOpenStaticBrowser } from "./startup-browser";

const host = process.env.MAVMETA_HOST ?? "127.0.0.1";
const hasExplicitPort = process.env.MAVMETA_PORT !== undefined;
const shouldServeStatic =
	process.argv.includes("--serve-static") ||
	process.env.MAVMETA_SERVE_STATIC === "1";
const staticRootDir = process.env.MAVMETA_STATIC_ROOT_DIR?.trim() || undefined;
const webPort = parsePort(
	process.env.MAVMETA_WEB_PORT ?? "5173",
	"MAVMETA_WEB_PORT",
);
const port = parsePort(
	process.env.MAVMETA_PORT ?? (shouldServeStatic ? "0" : "8787"),
	"MAVMETA_PORT",
);

if (!isLoopbackHost(host)) {
	throw new Error(`MAVMETA_HOST must be loopback-only. Received "${host}".`);
}

const app = createApp({
	serveStatic: shouldServeStatic,
	staticRootDir,
	allowDevSessionBootstrap: !shouldServeStatic,
	hostAllowlist: shouldServeStatic
		? []
		: [`127.0.0.1:${webPort}`, `localhost:${webPort}`],
	originAllowlist: shouldServeStatic
		? []
		: [`http://127.0.0.1:${webPort}`, `http://localhost:${webPort}`],
});

installAuthFileWriteGuard({
	mode: parseAuthWriteGuardMode(process.env.MAVMETA_AUTH_WRITE_GUARD_MODE),
});

async function main(): Promise<void> {
	await app.listen({ host, port });
	const address = app.server.address();
	if (!address || typeof address === "string") {
		throw new Error("Failed to resolve server address.");
	}
	app.log.info(
		`MavMeta backend listening on http://${host}:${address.port} (${hasExplicitPort ? "configured" : "ephemeral"} port)`,
	);
	if (shouldServeStatic) {
		app.log.info("Static frontend serving is enabled.");
	}
	await maybeOpenStaticBrowser({
		shouldServeStatic,
		url: `http://${host}:${address.port}`,
		log: app.log,
	});
}

main().catch((error) => {
	app.log.error(error);
	process.exit(1);
});

function isLoopbackHost(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

function parsePort(value: string, name: string): number {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 0 || port > 65535) {
		throw new Error(`${name} must be an integer between 0 and 65535. Received "${value}".`);
	}
	return port;
}

function parseAuthWriteGuardMode(
	value: string | undefined,
): "warn" | "block" {
	if (value === undefined || value.trim() === "") {
		// Default to warn so Salesforce SDK token refresh can persist auth safely.
		return "warn";
	}
	const normalized = value.trim().toLowerCase();
	if (normalized === "warn" || normalized === "block") {
		return normalized;
	}
	throw new Error(
		`MAVMETA_AUTH_WRITE_GUARD_MODE must be "warn" or "block". Received "${value}".`,
	);
}
