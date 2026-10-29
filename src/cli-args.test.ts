import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./cli-args";

describe("parseCliArgs", () => {
  it.each([
    ["--help", "help"],
    ["-h", "help"],
    ["--version", "version"],
  ])("returns %s action", (argument, action) => {
    expect(parseCliArgs([argument])).toEqual({ action });
  });

  it("serves with no arguments", () => {
    expect(parseCliArgs([])).toEqual({ action: "serve" });
  });

  it("accepts the static compatibility flag", () => {
    expect(parseCliArgs(["--serve-static"])).toEqual({ action: "serve" });
  });

  it("gives informational flags precedence", () => {
    expect(parseCliArgs(["--bogus", "--help"])).toEqual({ action: "help" });
    expect(parseCliArgs(["--help", "--version"])).toEqual({ action: "version" });
  });

  it("rejects unknown options and positionals", () => {
    expect(() => parseCliArgs(["--bogus"])).toThrow(/Unknown option/);
    expect(() => parseCliArgs(["unexpected"])).toThrow(/Unexpected argument/);
  });
});
