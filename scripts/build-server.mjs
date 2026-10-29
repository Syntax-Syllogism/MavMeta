import * as esbuild from "esbuild";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

await esbuild.build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  packages: "external",
  outfile: "dist-server/index.cjs",
  define: {
    __MAVMETA_VERSION__: JSON.stringify(packageJson.version),
  },
  banner: {
    js: [
      "#!/usr/bin/env node",
      'const mavmetaCliPath = require("node:path");',
      'process.env.MAVMETA_SERVE_STATIC = "1";',
      'process.env.MAVMETA_STATIC_ROOT_DIR ??= mavmetaCliPath.resolve(__dirname, "../dist");',
    ].join("\n"),
  },
});
