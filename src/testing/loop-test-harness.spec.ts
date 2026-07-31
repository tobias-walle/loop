import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { setupLoopTest } from "./loop-test-harness";

describe("setupLoopTest", () => {
  test("runs real Pi application behavior with isolated roots and observable outcomes", async () => {
    await using loop = await setupLoopTest();
    loop
      .agent("pi")
      .givenRun((pi) =>
        pi
          .session({ id: "pi-session", model: "pi-model" })
          .text("Implemented")
          .usage({ input: 10, output: 3, costUsd: 0.2 })
          .complete({ result: "Implemented" }),
      );

    const result = await loop.run("Do the work", { agent: "pi" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Implemented");
    expect(result.stderr).toBe("");
    expect(loop.session.latest()?.aggregate.status).toBe("completed");
    expect(loop.session.events().some((event) => event.type === "run_completed")).toBe(true);
    expect(loop.session.latest()?.aggregate.totals.totalCostUsd).toBe(0.2);
    expect(loop.session.lock().health).toBe("unlocked");
    expect(loop.agent("pi").invocations()).toHaveLength(1);
    expect(loop.resources()).toEqual({ runningProcesses: 0, queuedRuns: 0, locks: 0 });
  });

  test("keeps scoped environment and roots isolated across concurrent harnesses", async () => {
    await using first = await setupLoopTest({ env: { HARNESS: "first" } });
    await using second = await setupLoopTest({ env: { HARNESS: "second" } });
    first.agent("pi").givenRun((pi) => pi.text("first").complete({ result: "first" }));
    second
      .agent("claude")
      .givenRun((claude) => claude.text("second").complete({ result: "second" }));

    const [firstResult, secondResult] = await Promise.all([
      first.run("first task", { agent: "pi" }),
      second.run("second task", { agent: "claude" }),
    ]);

    expect(first.roots).not.toEqual(second.roots);
    expect(firstResult.stdout).toContain("first");
    expect(secondResult.stdout).toContain("second");
    expect(first.agent("pi").invocations()[0]?.cwd).toBe(first.roots.project);
    expect(second.agent("claude").invocations()[0]?.cwd).toBe(second.roots.project);
    expect(process.env.HARNESS).not.toBe("first");
    expect(process.env.HARNESS).not.toBe("second");
  });

  test("supports until workflows and real recipe loading", async () => {
    await using loop = await setupLoopTest();
    loop.agent("pi").givenRun((pi) => pi.complete({ result: "progress\nLOOP_CONTINUE: more" }));
    loop.agent("pi").givenRun((pi) => pi.complete({ result: "finished\nLOOP_DONE" }));

    const until = await loop.run("iterate", {
      agent: "pi",
      until: "finished",
      max: 3,
    });

    expect(until.exitCode).toBe(0);
    expect(loop.agent("pi").invocations()).toHaveLength(2);

    loop.writeRecipe("review", "steps:\n  - task: Review the work\n");
    loop.agent("claude").givenRun((claude) => claude.complete({ result: "reviewed" }));
    const recipe = await loop.runRecipe("review");

    expect(recipe.exitCode).toBe(0);
    expect(loop.agent("claude").invocations()[0]?.args.at(-1)).toContain("Review the work");
  });

  test("includes scenario, invocation, persisted state, output, and resources in cleanup diagnostics", async () => {
    const loop = await setupLoopTest();
    loop.agent("pi").givenRun((pi) => pi.complete({ result: "unused" }));

    await expect(loop[Symbol.asyncDispose]()).rejects.toThrow("piInvocations");
  });

  test("removes owned roots during disposal", async () => {
    const loop = await setupLoopTest();
    const root = loop.roots.owner;
    expect(fs.existsSync(root)).toBe(true);

    await loop[Symbol.asyncDispose]();

    expect(fs.existsSync(root)).toBe(false);
  });
});
