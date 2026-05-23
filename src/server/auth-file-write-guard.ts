import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PROTECTED_ROOTS = [path.resolve(os.homedir(), ".sf"), path.resolve(os.homedir(), ".sfdx")];

const WRITE_FLAG_PATTERN = /[wa+]/;
const MAX_WARNED_PATHS = 256;

type AuthFileWriteGuardMode = "warn" | "block";

type AuthFileWriteGuardOptions = {
	mode?: AuthFileWriteGuardMode;
};

const warnedPaths = new Set<string>();

export function installAuthFileWriteGuard(options: AuthFileWriteGuardOptions = {}): void {
	const mode = options.mode ?? "block";
	const originalOpen = fs.open as (...args: unknown[]) => unknown;
	(fs as unknown as { open: (...args: unknown[]) => unknown }).open = (
		filePath: unknown,
		flags: unknown,
		...rest: unknown[]
	) => {
		assertWriteAllowed(filePath, flags, mode);
		return originalOpen(filePath, flags, ...rest);
	};

	const originalWriteFile = fs.writeFile as (...args: unknown[]) => unknown;
	(fs as unknown as { writeFile: (...args: unknown[]) => unknown }).writeFile = (
		filePath: unknown,
		data: unknown,
		...rest: unknown[]
	) => {
		assertWriteAllowed(filePath, "w", mode);
		return originalWriteFile(filePath, data, ...rest);
	};

	const originalAppendFile = fs.appendFile as (...args: unknown[]) => unknown;
	(fs as unknown as { appendFile: (...args: unknown[]) => unknown }).appendFile = (
		filePath: unknown,
		data: unknown,
		...rest: unknown[]
	) => {
		assertWriteAllowed(filePath, "a", mode);
		return originalAppendFile(filePath, data, ...rest);
	};

	const originalPromisesOpen = fsPromises.open.bind(fsPromises) as (
		...args: unknown[]
	) => Promise<unknown>;
	(fsPromises as unknown as { open: (...args: unknown[]) => Promise<unknown> }).open = async (
		filePath: unknown,
		flags: unknown = "r",
		fileMode?: unknown,
	) => {
		assertWriteAllowed(filePath, flags, mode);
		return originalPromisesOpen(filePath, flags, fileMode);
	};

	const originalPromisesWriteFile = fsPromises.writeFile.bind(fsPromises) as (
		...args: unknown[]
	) => Promise<unknown>;
	(fsPromises as unknown as { writeFile: (...args: unknown[]) => Promise<unknown> }).writeFile =
		async (filePath: unknown, data: unknown, options?: unknown) => {
			assertWriteAllowed(filePath, "w", mode);
			return originalPromisesWriteFile(filePath, data, options);
		};

	const originalPromisesAppendFile = fsPromises.appendFile.bind(fsPromises) as (
		...args: unknown[]
	) => Promise<unknown>;
	(fsPromises as unknown as { appendFile: (...args: unknown[]) => Promise<unknown> }).appendFile =
		async (filePath: unknown, data: unknown, options?: unknown) => {
			assertWriteAllowed(filePath, "a", mode);
			return originalPromisesAppendFile(filePath, data, options);
		};
}

export function assertWriteAllowed(
	filePath: unknown,
	flags: unknown,
	mode: AuthFileWriteGuardMode = "block",
): void {
	if (typeof flags === "number") {
		return;
	}
	if (typeof flags !== "string" || !WRITE_FLAG_PATTERN.test(flags)) {
		return;
	}
	if (typeof filePath !== "string") {
		return;
	}
	const resolvedPath = path.resolve(filePath);
	const isProtected = PROTECTED_ROOTS.some(
		(root) => resolvedPath === root || resolvedPath.startsWith(`${root}${path.sep}`),
	);
	if (isProtected) {
		const message = `Write access to Salesforce auth path is forbidden: ${resolvedPath}`;
		if (mode === "warn") {
			if (!warnedPaths.has(resolvedPath)) {
				if (warnedPaths.size >= MAX_WARNED_PATHS) {
					warnedPaths.clear();
				}
				warnedPaths.add(resolvedPath);
				console.warn(message);
			}
			return;
		}
		throw new Error(message);
	}
}
