import { describe, expect, test } from "bun:test";
import type { RunOutput, RunReporter } from "../output/run-reporter.js";
import { createRunReporter } from "./run-reporter.js";

function reporter(name: string): RunReporter & { name: string } {
  return { name, report() {}, [Symbol.dispose]() {}, async [Symbol.asyncDispose]() {} };
}

describe("run reporter composition", () => {
  test("uses the live renderer for a TTY", () => {
    const output: RunOutput = { isTTY: true, write() {} };
    const live = reporter("live");
    const console = reporter("console");

    const selected = createRunReporter(output, {
      createLive: () => live,
      createConsole: () => console,
    });

    expect(selected).toBe(live);
  });

  test("uses plain console reporting when output is redirected", () => {
    const output: RunOutput = { isTTY: false, write() {} };
    const live = reporter("live");
    const console = reporter("console");

    const selected = createRunReporter(output, {
      createLive: () => live,
      createConsole: () => console,
    });

    expect(selected).toBe(console);
  });
});
