import { describe, expect, test } from "bun:test";
import { createFakeProcessSpawner } from "./fake-process";

async function readChunks(stream: NodeJS.ReadableStream): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk).toString());
  return chunks;
}

describe("fake process spawner", () => {
  test("consumes queued runs, records invocations, and preserves stdout chunks and results", async () => {
    const fake = createFakeProcessSpawner();
    fake.givenRun({
      stdoutChunks: ["first", Buffer.from("second")],
      stderr: "warning",
      exitCode: 7,
    });

    const handle = fake.spawn({
      command: "pi",
      args: ["--print"],
      cwd: "/project",
      env: { TOKEN: "test" },
    });

    expect(await readChunks(handle.stdout)).toEqual(["first", "second"]);
    expect(await handle.result).toEqual({
      exitCode: 7,
      signal: null,
      stderr: "warning",
    });
    expect(handle.isRunning()).toBe(false);
    expect(fake.invocations()).toEqual([
      { command: "pi", args: ["--print"], cwd: "/project", env: { TOKEN: "test" } },
    ]);
    fake.assertIdle();
  });

  test("models spawn errors and records abort requests", async () => {
    const fake = createFakeProcessSpawner();
    fake.givenRun({ spawnError: new Error("ENOENT"), deferred: true });
    const handle = fake.spawn({ command: "claude", args: [] });

    expect(handle.isRunning()).toBe(true);
    handle.abort();

    expect(fake.processes()[0]?.abortRequested).toBe(true);
    expect(await handle.result).toMatchObject({
      exitCode: null,
      signal: "SIGTERM",
      stderr: "",
      error: new Error("ENOENT"),
    });
    expect(handle.isRunning()).toBe(false);
  });

  test("defers completion until explicitly completed", async () => {
    const fake = createFakeProcessSpawner();
    fake.givenRun({ stdoutChunks: ["done\n"], deferred: true });
    const handle = fake.spawn({ command: "pi", args: [] });

    expect(await readChunks(handle.stdout)).toEqual(["done\n"]);
    expect(handle.isRunning()).toBe(true);

    fake.complete(0);
    expect(await handle.result).toEqual({ exitCode: 0, signal: null, stderr: "" });
  });

  test("pauses and releases named checkpoints without sleeps", async () => {
    const fake = createFakeProcessSpawner();
    fake.givenRun({
      operations: [
        { type: "stdout", chunks: ["before"] },
        { type: "checkpoint", name: "running" },
        { type: "stdout", chunks: ["after"] },
      ],
    });
    const handle = fake.spawn({ command: "pi", args: [] });

    await fake.waitForCheckpoint("running");
    expect(handle.isRunning()).toBe(true);
    fake.releaseCheckpoint("running");

    expect(await readChunks(handle.stdout)).toEqual(["before", "after"]);
    expect((await handle.result).exitCode).toBe(0);
  });

  test("reports unexpected invocations, unconsumed runs, and invalid transitions", async () => {
    const fake = createFakeProcessSpawner();
    expect(() => fake.spawn({ command: "pi", args: ["unexpected"] })).toThrow(
      "Unexpected process invocation",
    );

    fake.givenRun({ stdoutChunks: [] });
    expect(() => fake.assertIdle()).toThrow("1 required process run was not consumed");
    expect(() => fake.releaseCheckpoint("missing")).toThrow('Checkpoint "missing"');

    await expect(fake[Symbol.asyncDispose]()).rejects.toThrow("unconsumed");
  });

  test("disposal aborts running work and reports leaked resources", async () => {
    const fake = createFakeProcessSpawner();
    fake.givenRun({ deferred: true });
    const handle = fake.spawn({ command: "pi", args: [] });

    await expect(fake[Symbol.asyncDispose]()).rejects.toThrow("running process");
    expect(await handle.result).toMatchObject({ signal: "SIGTERM" });
    expect(handle.isRunning()).toBe(false);
  });
});
