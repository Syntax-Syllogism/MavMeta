import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type ActiveOrgStateFile = {
	activeUsername?: string;
};

export type ActiveOrgStoreApi = {
	getActiveUsername(): string | undefined;
	setActiveUsername(username: string): void;
	clear(): void;
};

export class ActiveOrgStore implements ActiveOrgStoreApi {
	private activeUsername: string | undefined;
	private readonly stateFilePath: string;

	constructor(stateFilePath = resolveDefaultStateFilePath()) {
		this.stateFilePath = stateFilePath;
		this.activeUsername = this.readFromDisk();
	}

	getActiveUsername(): string | undefined {
		return this.activeUsername;
	}

	setActiveUsername(username: string): void {
		this.activeUsername = username;
		this.writeToDisk();
	}

	clear(): void {
		this.activeUsername = undefined;
		this.clearFromDisk();
	}

	private readFromDisk(): string | undefined {
		if (!existsSync(this.stateFilePath)) {
			return undefined;
		}

		try {
			const content = readFileSync(this.stateFilePath, "utf8");
			const parsed = JSON.parse(content) as ActiveOrgStateFile;
			return typeof parsed.activeUsername === "string" && parsed.activeUsername.trim()
				? parsed.activeUsername
				: undefined;
		} catch {
			return undefined;
		}
	}

	private writeToDisk(): void {
		const directoryPath = dirname(this.stateFilePath);
		mkdirSync(directoryPath, { recursive: true });

		const state: ActiveOrgStateFile = this.activeUsername
			? { activeUsername: this.activeUsername }
			: {};
		const tempPath = `${this.stateFilePath}.tmp`;
		writeFileSync(tempPath, JSON.stringify(state, null, 2), "utf8");
		renameSync(tempPath, this.stateFilePath);
	}

	private clearFromDisk(): void {
		if (!existsSync(this.stateFilePath)) {
			return;
		}

		try {
			unlinkSync(this.stateFilePath);
		} catch {
			// Ignore delete failure and keep in-memory state cleared.
		}
	}
}

function resolveDefaultStateFilePath(): string {
	return join(resolveConfigRoot(), "mavmeta", "active-org-state.json");
}

function resolveConfigRoot(): string {
	if (process.platform === "darwin") {
		return join(homedir(), "Library", "Application Support");
	}

	if (process.platform === "win32") {
		return process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
	}

	return process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
}
