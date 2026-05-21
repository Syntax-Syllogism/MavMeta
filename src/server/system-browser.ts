import { spawn } from "node:child_process";

type SpawnFn = typeof spawn;

export async function openInSystemBrowser(
	url: string,
	spawnProcess: SpawnFn = spawn,
	platform: NodeJS.Platform = process.platform,
): Promise<void> {
	const command = getOpenCommand(url, platform);

	await new Promise<void>((resolve, reject) => {
		const process = spawnProcess(command[0], command.slice(1), {
			stdio: "ignore",
			detached: true,
		});

		process.once("error", reject);
		process.once("spawn", resolve);
		process.unref();
	});
}

function getOpenCommand(url: string, platform: NodeJS.Platform): [string, ...string[]] {
	if (platform === "darwin") {
		return ["open", url];
	}

	if (platform === "win32") {
		return ["rundll32", "url.dll,FileProtocolHandler", url];
	}

	return ["xdg-open", url];
}
