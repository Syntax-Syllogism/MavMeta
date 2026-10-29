import { parseArgs } from "node:util";

export const USAGE = `Usage: mavmeta [--help] [--version]

Start the local Salesforce metadata web UI. The packaged CLI opens your browser
on an ephemeral local port.

Options:
  -h, --help     Show this help and exit
      --version  Show the version and exit

Environment:
  MAVMETA_HOST   Loopback host to bind (default: 127.0.0.1)
  MAVMETA_PORT   Port to bind (default: ephemeral for the packaged CLI)`;

export type CliAction = "help" | "version" | "serve";

export function parseCliArgs(argv: string[]): { action: CliAction } {
  // Help and version are informational probes and take precedence over other arguments.
  if (argv.includes("--version")) return { action: "version" };
  if (argv.includes("--help") || argv.includes("-h")) return { action: "help" };

  const { values } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
      "serve-static": { type: "boolean" },
    },
    strict: true,
    allowPositionals: false,
  });

  return { action: values.help ? "help" : values.version ? "version" : "serve" };
}
