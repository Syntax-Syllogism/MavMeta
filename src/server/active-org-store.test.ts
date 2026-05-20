import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ActiveOrgStore } from "./active-org-store";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function createStateFilePath() {
	const directory = mkdtempSync(join(tmpdir(), "mavmeta-active-org-"));
	tempDirectories.push(directory);
	return join(directory, "state.json");
}

describe("ActiveOrgStore", () => {
	it("persists active username and restores it on next load", () => {
		const stateFilePath = createStateFilePath();
		const firstStore = new ActiveOrgStore(stateFilePath);

		firstStore.setActiveUsername("user@example.com");

		const secondStore = new ActiveOrgStore(stateFilePath);
		expect(secondStore.getActiveUsername()).toBe("user@example.com");
	});

	it("clears persisted state", () => {
		const stateFilePath = createStateFilePath();
		const firstStore = new ActiveOrgStore(stateFilePath);
		firstStore.setActiveUsername("user@example.com");

		const secondStore = new ActiveOrgStore(stateFilePath);
		secondStore.clear();

		const thirdStore = new ActiveOrgStore(stateFilePath);
		expect(thirdStore.getActiveUsername()).toBeUndefined();
	});
});
