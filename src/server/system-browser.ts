import { spawn } from "node:child_process";

type SpawnFn = typeof spawn;

export async function openInSystemBrowser(
	url: string,
	spawnProcess: SpawnFn = spawn,
): Promise<void> {
	const command = getOpenCommand(url);

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

function getOpenCommand(url: string): [string, ...string[]] {
	if (process.platform === "darwin") {
		return ["open", url];
	}

	if (process.platform === "win32") {
		return ["cmd", "/c", "start", "", url];
	}

	return ["xdg-open", url];
}
