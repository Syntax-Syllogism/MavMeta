import { openInSystemBrowser } from "./system-browser";

type Logger = {
	info: (message: string) => void;
	warn: (message: string) => void;
};

type OpenStaticBrowserInput = {
	shouldServeStatic: boolean;
	url: string;
	log: Logger;
	openBrowser?: (url: string) => Promise<void>;
};

export async function maybeOpenStaticBrowser({
	shouldServeStatic,
	url,
	log,
	openBrowser = openInSystemBrowser,
}: OpenStaticBrowserInput): Promise<void> {
	if (!shouldServeStatic) {
		return;
	}

	log.info(`Opening MavMeta at ${url}`);
	try {
		await openBrowser(url);
	} catch {
		log.warn(`Could not open browser automatically. Visit ${url} manually.`);
	}
}
