// @ts-nocheck
const RUN_STATUSES = new Set(["running", "complete", "interrupted", "rate-limited"]);
const AREA_VALUES = new Set([
	"metadata-explorer",
	"object-explorer",
	"lwc-editor",
	"rest-explorer",
	"soql-explorer",
]);
const ERROR_SIGNALS = new Set(["network", "console", "toast", "timeout"]);

export function assertReportSchema(report) {
	const issues = validateReportSchema(report);
	if (issues.length > 0) {
		throw new Error(`Report schema validation failed:\n- ${issues.join("\n- ")}`);
	}
}

export function validateReportSchema(report) {
	const issues = [];

	if (!isObject(report)) {
		return ['Report root must be an object with "run", "coverageGaps", and "errors".'];
	}

	const run = report.run;
	if (!isObject(run)) {
		issues.push('Missing "run" object.');
	} else {
		if (!(run.orgAlias === null || typeof run.orgAlias === "string")) {
			issues.push('"run.orgAlias" must be string or null.');
		}
		if (typeof run.orgUsername !== "string" || !run.orgUsername.trim()) {
			issues.push('"run.orgUsername" must be a non-empty string.');
		}
		if (!RUN_STATUSES.has(run.status)) {
			issues.push('"run.status" must be running|complete|interrupted|rate-limited.');
		}
		if (!isIsoString(run.startedAt)) {
			issues.push('"run.startedAt" must be an ISO timestamp string.');
		}
		if (!(run.finishedAt === null || isIsoString(run.finishedAt))) {
			issues.push('"run.finishedAt" must be null or ISO timestamp string.');
		}

		if (!isObject(run.config)) {
			issues.push('"run.config" must be an object.');
		} else {
			if (!isNonNegativeInteger(run.config.depth)) {
				issues.push('"run.config.depth" must be an integer >= 0.');
			}
			if (!isNonNegativeInteger(run.config.delayMs)) {
				issues.push('"run.config.delayMs" must be an integer >= 0.');
			}
			if (!Array.isArray(run.config.areas) || run.config.areas.length === 0) {
				issues.push('"run.config.areas" must be a non-empty array.');
			} else if (run.config.areas.some((area) => !AREA_VALUES.has(area))) {
				issues.push(
					'"run.config.areas" entries must be one of metadata-explorer|object-explorer|lwc-editor|rest-explorer|soql-explorer.',
				);
			}
		}

		if (!isObject(run.counts)) {
			issues.push('"run.counts" must be an object.');
		} else {
			for (const key of ["typesVisited", "coverageGaps", "errors"]) {
				if (!isNonNegativeInteger(run.counts[key])) {
					issues.push(`"run.counts.${key}" must be an integer >= 0.`);
				}
			}
		}
	}

	if (!Array.isArray(report.coverageGaps)) {
		issues.push('"coverageGaps" must be an array.');
	} else {
		report.coverageGaps.forEach((gap, index) => {
			if (!isObject(gap)) {
				issues.push(`coverageGaps[${index}] must be an object.`);
				return;
			}
			if (gap.kind !== "zero-result") {
				issues.push(`coverageGaps[${index}].kind must be "zero-result".`);
			}
			if (!AREA_VALUES.has(gap.area)) {
				issues.push(
					`coverageGaps[${index}].area must be metadata-explorer|object-explorer|lwc-editor|rest-explorer|soql-explorer.`,
				);
			}
			if (typeof gap.metadataType !== "string" || !gap.metadataType.trim()) {
				issues.push(`coverageGaps[${index}].metadataType must be a non-empty string.`);
			}
			if (typeof gap.screenshot !== "string" || !gap.screenshot.trim()) {
				issues.push(`coverageGaps[${index}].screenshot must be a non-empty string.`);
			}
			if (!isIsoString(gap.observedAt)) {
				issues.push(`coverageGaps[${index}].observedAt must be an ISO timestamp string.`);
			}
		});
	}

	if (!Array.isArray(report.errors)) {
		issues.push('"errors" must be an array.');
	} else {
		report.errors.forEach((errorItem, index) => {
			if (!isObject(errorItem)) {
				issues.push(`errors[${index}] must be an object.`);
				return;
			}
			if (!AREA_VALUES.has(errorItem.area)) {
				issues.push(
					`errors[${index}].area must be metadata-explorer|object-explorer|lwc-editor|rest-explorer|soql-explorer.`,
				);
			}
			if (typeof errorItem.metadataType !== "string") {
				issues.push(`errors[${index}].metadataType must be a string.`);
			}
			if (!(errorItem.componentName === null || typeof errorItem.componentName === "string")) {
				issues.push(`errors[${index}].componentName must be string|null.`);
			}
			if (!ERROR_SIGNALS.has(errorItem.signal)) {
				issues.push(`errors[${index}].signal must be network|console|toast|timeout.`);
			}
			if (typeof errorItem.message !== "string" || !errorItem.message.trim()) {
				issues.push(`errors[${index}].message must be a non-empty string.`);
			}
			if (!(errorItem.screenshot === null || typeof errorItem.screenshot === "string")) {
				issues.push(`errors[${index}].screenshot must be string|null.`);
			}
			if (!isIsoString(errorItem.observedAt)) {
				issues.push(`errors[${index}].observedAt must be an ISO timestamp string.`);
			}
		});
	}

	return issues;
}

function isObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value) {
	return Number.isInteger(value) && value >= 0;
}

function isIsoString(value) {
	if (typeof value !== "string" || !value.trim()) {
		return false;
	}
	return !Number.isNaN(Date.parse(value));
}
