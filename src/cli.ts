import { parseCliArgs, USAGE } from "./cli-args";

declare const __MAVMETA_VERSION__: string;

try {
  const { action } = parseCliArgs(process.argv.slice(2));

  if (action === "help") {
    console.log(USAGE);
  } else if (action === "version") {
    console.log(`mavmeta ${__MAVMETA_VERSION__}`);
  } else {
    void import("./server/index");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`mavmeta: ${message}\nRun mavmeta --help for usage.`);
  process.exitCode = 2;
}
