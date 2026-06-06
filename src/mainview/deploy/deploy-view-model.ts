import { getDestructiveCompatibilityIssue } from "../../shared/destructive-compatibility";
import type { DestructiveDeployResult } from "../../shared/deploy";

type PreflightComponent = {
	metadataType: string;
	fullName: string;
};

export function getDeployConfirmationPhrase(label: string | undefined) {
	return label ?? "";
}

export function buildPreflightSkippedComponents(components: PreflightComponent[]) {
	return components
		.map((item) => ({
			metadataType: item.metadataType,
			fullName: item.fullName,
			reason: getDestructiveCompatibilityIssue(item.metadataType),
		}))
		.filter((item): item is PreflightComponent & { reason: string } => item.reason !== undefined);
}

export function getDeployResultId(result: DestructiveDeployResult) {
	const rawId = result.rawResult?.id ?? result.rawResult?.deployId;
	return typeof rawId === "string" && rawId.trim() ? rawId : "n/a";
}

export function getDeploySuccessCount(result: DestructiveDeployResult) {
	const deployed = result.rawResult?.numberComponentsDeployed;

	if (typeof deployed === "number") {
		return String(deployed);
	}

	return result.success ? "Complete" : "n/a";
}

export function getFailureMessage(failure: { problem: string }) {
	return failure.problem || "Unknown error";
}
