import { describe, expect, it } from "vitest";

import type { DestructiveDeployResult } from "../../shared/deploy";
import {
	buildPreflightSkippedComponents,
	getDeployConfirmationPhrase,
	getDeployResultId,
	getDeploySuccessCount,
	getFailureMessage,
} from "./deploy-view-model";

describe("deploy view model", () => {
	const baseResult: DestructiveDeployResult = {
		target: { username: "user@example.com" },
		mode: "validate",
		environment: "production",
		success: true,
		state: "Succeeded",
		message: "Done",
		skipped: [],
		failed: [],
	};

	it("builds the destructive deploy confirmation phrase from the active org label", () => {
		expect(getDeployConfirmationPhrase("Production")).toBe("Production");
		expect(getDeployConfirmationPhrase(undefined)).toBe("");
	});

	it("returns only preflight components blocked by destructive compatibility rules", () => {
		expect(
			buildPreflightSkippedComponents([
				{ metadataType: "ApexClass", fullName: "AccountController" },
				{ metadataType: "Translations", fullName: "en_US" },
			]),
		).toEqual([
			{
				metadataType: "Translations",
				fullName: "en_US",
				reason: "Unsupported destructive metadata type: Translations.",
			},
		]);
	});

	it("formats deploy result fields with Metadata API fallbacks", () => {
		expect(
			getDeployResultId({
				...baseResult,
				rawResult: { deployId: "0Af123" },
			}),
		).toBe("0Af123");
		expect(getDeployResultId(baseResult)).toBe("n/a");
		expect(
			getDeploySuccessCount({
				...baseResult,
				rawResult: { numberComponentsDeployed: 3 },
			}),
		).toBe("3");
		expect(getDeploySuccessCount(baseResult)).toBe("Complete");
	});

	it("formats missing failure messages", () => {
		expect(getFailureMessage({ problem: "" })).toBe("Unknown error");
		expect(getFailureMessage({ problem: "Missing dependency" })).toBe(
			"Missing dependency",
		);
	});
});
