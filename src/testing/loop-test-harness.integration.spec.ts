import { describe, expect, test } from "bun:test";
import { setupLoopTest } from "./loop-test-harness";

describe("Loop application harness", () => {
  test.each(["pi", "claude"] as const)("runs a successful %s workflow", async (agent) => {
    await using loop = await setupLoopTest();
    loop
      .agent(agent)
      .givenRun((scenario) =>
        scenario.session().text("done").complete({ result: "done", durationMs: 2 }),
      );

    const result = await loop.run("work", { agent });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("done");
    expect(result.session?.aggregate.status).toBe("completed");
    expect(loop.resources()).toEqual({ queuedRuns: 0, runningProcesses: 0, locks: 0 });
  });

  test("feeds prior iteration and step summaries into later provider prompts", async () => {
    await using loop = await setupLoopTest();
    loop.agent("pi").givenRun((pi) => pi.complete({ result: "iteration one" }));
    loop.agent("pi").givenRun((pi) => pi.complete({ result: "iteration two" }));
    loop.agent("pi").givenRun((pi) => pi.complete({ result: "step two" }));

    const result = await loop.runSteps(
      [
        { type: "task", task: "repeat work", repeat: 2 },
        { type: "task", task: "finish work" },
      ],
      { agent: "pi" },
    );

    expect(result.exitCode).toBe(0);
    const prompts = loop
      .agent("pi")
      .invocations()
      .map((invocation) => invocation.args.at(-1));
    expect(prompts).toHaveLength(3);
    expect(prompts[1]).toContain("iteration one");
    expect(prompts[2]).toContain("iteration two");
  });

  test.each([
    {
      name: "malformed output",
      arrange: (loop: Awaited<ReturnType<typeof setupLoopTest>>) =>
        loop.agent("pi").givenRun((pi) => pi.raw("not-json\n")),
    },
    {
      name: "premature stdout completion",
      arrange: (loop: Awaited<ReturnType<typeof setupLoopTest>>) =>
        loop.agent("pi").givenRun((pi) => pi.raw("")),
    },
    {
      name: "nonzero exit with stderr after completion",
      arrange: (loop: Awaited<ReturnType<typeof setupLoopTest>>) =>
        loop
          .agent("pi")
          .givenRun((pi) => pi.complete({ result: "done" }).stderr("provider failed").exit(9)),
    },
    {
      name: "spawn failure",
      arrange: (loop: Awaited<ReturnType<typeof setupLoopTest>>) =>
        loop.agent("pi").givenRun((pi) => pi.spawnError(new Error("ENOENT"))),
    },
  ])("persists provider failure for $name", async ({ arrange }) => {
    await using loop = await setupLoopTest();
    arrange(loop);

    const result = await loop.run("work", { agent: "pi" });

    expect(result.exitCode).toBe(1);
    expect(result.session?.aggregate.status).toBe("failed");
    expect(loop.session.events().some((event) => event.type === "step_failed")).toBe(true);
    expect(loop.session.lock().health).toBe("unlocked");
  });

  test("reports provider retries through real application output", async () => {
    await using loop = await setupLoopTest();
    loop
      .agent("claude")
      .givenRun((claude) =>
        claude
          .retry({ attempt: 1, maxRetries: 3, delayMs: 10, error: "rate limited" })
          .complete({ result: "recovered" }),
      );

    const result = await loop.run("work", { agent: "claude" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("retry 1/3: rate limited");
  });

  test("interrupts at a checkpoint and persists cancellation and cleanup", async () => {
    await using loop = await setupLoopTest();
    loop
      .agent("pi")
      .givenRun((pi) =>
        pi.text("working").checkpoint("agent-running").complete({ result: "too late" }),
      );

    const running = loop.run("work", { agent: "pi" });
    await loop.agent("pi").waitForCheckpoint("agent-running");
    loop.interrupt();
    const result = await running;

    expect(result.exitCode).toBe(130);
    expect(result.session?.aggregate.status).toBe("aborted");
    expect(loop.agent("pi").processes()[0]?.abortRequested).toBe(true);
    expect(loop.session.events().some((event) => event.type === "attempt_aborted")).toBe(true);
    expect(loop.session.lock().health).toBe("unlocked");
  });

  test("resumes a failed persisted session with a new provider scenario", async () => {
    await using loop = await setupLoopTest();
    loop.agent("pi").givenRun((pi) => pi.fail("first attempt failed"));
    const first = await loop.run("work", { agent: "pi" });
    expect(first.exitCode).toBe(1);
    expect(first.session?.aggregate.resumable).toBe(true);

    loop.agent("pi").givenRun((pi) => pi.text("resumed").complete({ result: "resumed" }));
    const resumed = await loop.resume(first.session?.sessionDir);

    expect(resumed.exitCode).toBe(0);
    expect(resumed.session?.aggregate.status).toBe("completed");
    expect(resumed.session?.aggregate.attempts).toHaveLength(2);
    expect(resumed.stdout).toContain("resumed");
  });

  test("runs repeated harness instances deterministically and concurrently", async () => {
    const runs = Array.from({ length: 4 }, async (_, index) => {
      await using loop = await setupLoopTest();
      loop
        .agent("claude")
        .givenRun((claude) => claude.text(`run-${index}`).complete({ result: `run-${index}` }));
      const result = await loop.run(`task-${index}`, { agent: "claude" });
      return {
        exitCode: result.exitCode,
        output: result.stdout.includes(`run-${index}`),
        resources: loop.resources(),
      };
    });

    expect(await Promise.all(runs)).toEqual(
      Array.from({ length: 4 }, () => ({
        exitCode: 0,
        output: true,
        resources: { queuedRuns: 0, runningProcesses: 0, locks: 0 },
      })),
    );
  });
});
