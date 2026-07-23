import { describe, expect, test } from "bun:test";
import type { RunReporter } from "../lib/run-reporter.js";
import type { ExecuteSessionOptions } from "./execute-session.js";
import { runCommand } from "./run-command.js";

describe("run command", () => {
  test("keeps the reporter alive until session execution settles", async () => {
    let disposed = false;
    let disposedDuringExecution: boolean | undefined;
    const reporter: RunReporter = {
      report() {},
      [Symbol.dispose]() {
        disposed = true;
      },
      async [Symbol.asyncDispose]() {
        disposed = true;
      },
    };

    const result = await runCommand(
      { steps: [{ type: "task", task: "work" }] },
      { stdout: { isTTY: true, write() {} }, writeError() {} },
      {
        createRunReporter: () => reporter,
        async executeSession(_options: ExecuteSessionOptions) {
          await Bun.sleep(0);
          disposedDuringExecution = disposed;
          return 7;
        },
      },
    );

    expect(result).toBe(7);
    expect(disposedDuringExecution).toBe(false);
    expect(disposed).toBe(true);
  });
});
