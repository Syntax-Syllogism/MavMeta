import * as esbuild from "esbuild";

await esbuild.build({
	entryPoints: ["src/cli.ts"],
	bundle: true,
	platform: "node",
	target: "node20",
	format: "cjs",
	packages: "external",
	outfile: "dist-server/index.cjs",
	banner: { js: '#!/usr/bin/env node\nprocess.env.MAVMETA_SERVE_STATIC = "1";' },
});
