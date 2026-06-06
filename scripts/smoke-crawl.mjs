// @ts-nocheck
import { assertAppReachable, fetchSessionToken, resolveOrgContext } from "./smoke-crawl/api.mjs";
import { parseCliArgs, getUsageText } from "./smoke-crawl/cli.mjs";
import { runSmokeCrawler } from "./smoke-crawl/crawler.mjs";
import { createArtifactPaths, createInitialReport, writeReportArtifacts } from "./smoke-crawl/io.mjs";

async function main() {
	const args = parseCliArgs();
	if (args.help) {
		console.log(getUsageText());
		return;
	}

	console.log(
		`Smoke crawler starting (app: ${args.appUrl}, areas: ${args.areas.join(",")}, depth: ${args.depth}, delay: ${args.delayMs}ms)`,
	);
	await assertAppReachable(args.appUrl);

	const sessionToken = await fetchSessionToken(args.appUrl);
	const orgContext = await resolveOrgContext({
		appUrl: args.appUrl,
		sessionToken,
		orgOverride: args.org,
	});

	const artifactPaths = await createArtifactPaths();
	const report = createInitialReport({
		orgAlias: orgContext.orgAlias,
		orgUsername: orgContext.orgUsername,
		depth: args.depth,
		delayMs: args.delayMs,
		areas: args.areas,
	});

	let flushQueue = Promise.resolve();
	const flushReport = () => {
		flushQueue = flushQueue
			.catch(() => undefined)
			.then(() => writeReportArtifacts({ report, ...artifactPaths }));
		return flushQueue;
	};

	let stopRequested = false;
	const isStopRequested = () => stopRequested;
	const requestStop = async (status, reason) => {
		if (!stopRequested) {
			stopRequested = true;
		}
		if (report.run.status === "running") {
			report.run.status = status;
			report.run.finishedAt = new Date().toISOString();
			if (reason) {
				console.log(reason);
			}
		}
		await flushReport();
	};

	const onSigint = () => {
		void requestStop("interrupted", "Interrupted by SIGINT.");
	};
	process.on("SIGINT", onSigint);

	await flushReport();

	try {
		await runSmokeCrawler({
			options: args,
			report,
			artifactPaths,
			flushReport,
			isStopRequested,
			requestStop,
			log: (line) => console.log(line),
		});
	} finally {
		process.off("SIGINT", onSigint);
	}

	if (report.run.status === "running") {
		report.run.status = "complete";
	}
	if (report.run.finishedAt === null) {
		report.run.finishedAt = new Date().toISOString();
	}

	report.run.counts.coverageGaps = report.coverageGaps.length;
	report.run.counts.errors = report.errors.length;
	await flushReport();

	console.log(`Smoke crawler finished with status: ${report.run.status}`);
	console.log(
		`Summary: ${report.run.counts.typesVisited} types, ${report.run.counts.coverageGaps} gaps, ${report.run.counts.errors} errors`,
	);
	console.log(`Report artifacts: ${artifactPaths.runDirectory}`);

	if (report.run.status === "interrupted") {
		process.exitCode = 130;
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
