import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SpawnChildProcess } from "../agents/utils/child-process.js";
import type { LoopRuntimeConfig } from "../lib/config/index.js";
import type { SessionEvent } from "../lib/session-event.js";
import { readSessionEvents } from "../lib/session-event-store.js";
import { discoverSessions } from "../lib/session-store.js";
import type { RunReporter } from "../output/run-reporter.js";
import { createFakeProcessSpawner } from "../testing/fake-process.js";
import { createPiScenario } from "../testing/pi-scenario.js";
import { executeSession } from "./execute-session.js";

function runtimeConfig(): LoopRuntimeConfig {
  return {
    agent: "pi",
    agents: {
      claude: { command: "claude", args: {}, env: {} },
      pi: { command: "pi", args: {}, env: { PROVIDER: "pi" } },
    },
  };
}

function reporter(report: (event: SessionEvent) => void = () => {}): RunReporter {
  return { report, [Symbol.dispose]() {}, async [Symbol.asyncDispose]() {} };
}

async function run(options: {
  root: string;
  reporter: RunReporter;
  signal?: AbortSignal;
  spawnProcess?: SpawnChildProcess;
}) {
  const env = { LOOP_STATE_HOME: path.join(options.root, "state") };
  const code = await executeSession(
    {
      config: { steps: [{ type: "task", task: "work" }] },
      runtimeConfig: runtimeConfig(),
      template: { source: "test", template: "{{task}}" },
      projectRoot: options.root,
      reporter: options.reporter,
      signal: options.signal,
    },
    {
      env,
      spawnProcess:
        options.spawnProcess ??
        (() => {
          throw new Error("unexpected process invocation");
        }),
    },
  );
  const sessionDir = discoverSessions(env, options.root)[0]?.sessionDir;
  if (!sessionDir) throw new Error("session was not persisted");
  return { code, sessionDir };
}

describe("executeSession", () => {
  test("uses scoped technical dependencies and reports persisted outcomes in order", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-execute-scoped-"));
    const previousStateHome = process.env.LOOP_STATE_HOME;
    const reported: SessionEvent[] = [];
    const processes = createFakeProcessSpawner();
    processes.givenRun(
      createPiScenario()
        .session({ id: "pi-session" })
        .text("done")
        .complete({ result: "done" })
        .build(),
    );

    const result = await run({
      root,
      reporter: reporter((event) => reported.push(event)),
      spawnProcess: processes.spawn,
    });

    expect(result.code).toBe(0);
    expect(processes.invocations()).toHaveLength(1);
    expect(processes.invocations()[0]).toMatchObject({
      cwd: root,
      env: { PROVIDER: "pi" },
    });
    expect(reported.map((event) => event.id)).toEqual(
      readSessionEvents(result.sessionDir).events.map((event) => event.id),
    );
    expect(fs.existsSync(path.join(result.sessionDir, "active.lock"))).toBe(false);
    expect(process.env.LOOP_STATE_HOME).toBe(previousStateHome);
  });

  test("contains reporter exceptions", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-execute-reporter-"));
    const processes = createFakeProcessSpawner();
    processes.givenRun(createPiScenario().complete({ result: "done" }).build());

    const result = await run({
      root,
      reporter: reporter(() => {
        throw new Error("presentation failed");
      }),
      spawnProcess: processes.spawn,
    });

    expect(result.code).toBe(0);
  });

  test("does not spawn an agent for an already aborted signal", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-execute-aborted-"));
    const controller = new AbortController();
    controller.abort();
    let invocations = 0;

    const result = await run({
      root,
      reporter: reporter(),
      signal: controller.signal,
      spawnProcess() {
        invocations++;
        throw new Error("not expected");
      },
    });

    expect(result.code).toBe(130);
    expect(invocations).toBe(0);
    expect(fs.existsSync(path.join(result.sessionDir, "active.lock"))).toBe(false);
  });
});
