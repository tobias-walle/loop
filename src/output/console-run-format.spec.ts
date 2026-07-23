import { describe, expect, test } from "bun:test";
import { consoleStyle, formatToolPreview } from "./console-run-format.js";

describe("console run formatting", () => {
  test("applies semantic color only for TTY output", () => {
    expect(consoleStyle(false).success("done")).toBe("done");
    expect(consoleStyle(true).success("done")).toContain("\x1b[");
  });

  test("bounds tool previews independently from terminal width", () => {
    const preview = formatToolPreview("Bash", { command: "x".repeat(2_000) });
    expect(preview.length).toBeLessThanOrEqual(500);
    expect(preview).toEndWith("...");
  });
});
