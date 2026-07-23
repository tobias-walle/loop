import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { LoopRuntimeConfig } from "../lib/config/index.js";
import { appendSessionEvent, readSessionEvents } from "../lib/session-event-store.js";
import { type SessionEvent, createEvent } from "../lib/session-event.js";
import { loadSession } from "../lib/session-store.js";
import { createResumableSession } from "../lib/session.js";
import type { RunReporter } from "../output/run-reporter.js";
import { executeSession } from "./execute-session.js";

function writeSuccessfulPi(root: string, marker?: string): string {
  const script = path.join(root, "fake-pi.js");
  fs.writeFileSync(
    script,
    `${marker ? `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "spawned");` : ""}
process.stdout.write(JSON.stringify({ type: "agent_start", model: "test" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_end", result: "done", durationMs: 1, usage: { input: 1, output: 1 } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\\n");
`,
  );
  return script;
}

function runtimeConfig(): LoopRuntimeConfig {
  return {
    agent: "pi",
    agents: {
      claude: { command: "claude", args: {}, env: {} },
      pi: { command: process.execPath, args: {}, env: {} },
    },
  };
}

function reporter(report: (event: SessionEvent) => void = () => {}): RunReporter {
  return { report, [Symbol.dispose]() {}, async [Symbol.asyncDispose]() {} };
}

async function run(
  root: string,
  options: { reporter: RunReporter; signal?: AbortSignal; marker?: string },
): Promise<{ code: number; sessionDir: string }> {
  const script = writeSuccessfulPi(root, options.marker);
  const previous = process.env.LOOP_STATE_HOME;
  process.env.LOOP_STATE_HOME = path.join(root, "state");
  try {
    const code = await executeSession({
      config: { steps: [{ type: "task", task: "work" }], passthroughArgs: [script] },
      runtimeConfig: runtimeConfig(),
      template: { source: "test", template: "{{task}}" },
      projectRoot: root,
      reporter: options.reporter,
      signal: options.signal,
    });
    const sessions = path.join(root, "state", "sessions");
    const project = fs.readdirSync(sessions)[0];
    const session = fs.readdirSync(path.join(sessions, project))[0];
    return { code, sessionDir: path.join(sessions, project, session) };
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, "LOOP_STATE_HOME");
    else process.env.LOOP_STATE_HOME = previous;
  }
}

describe("executeSession", () => {
  test("reports persisted events in order", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-execute-"));
    const reported: SessionEvent[] = [];
    const result = await run(root, { reporter: reporter((event) => reported.push(event)) });

    expect(result.code).toBe(0);
    expect(reported.map((event) => event.id)).toEqual(
      readSessionEvents(result.sessionDir).events.map((event) => event.id),
    );
    expect(fs.existsSync(path.join(result.sessionDir, "active.lock"))).toBe(false);
  });

  test("replays complete stored history before resumed events", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-execute-resume-"));
    const script = writeSuccessfulPi(root);
    const previous = process.env.LOOP_STATE_HOME;
    process.env.LOOP_STATE_HOME = path.join(root, "state");
    try {
      const created = createResumableSession({
        loopVersion: "test",
        projectRoot: root,
        steps: [{ type: "task", task: "work" }],
        template: { source: "default", content: "{{task}}", sha256: "hash" },
        agent: { name: "pi", command: process.execPath, args: {}, passthroughArgs: [script] },
      });
      const priorText = createEvent("agent_event", {
        stepIndex: 0,
        executionId: "prior-exec",
        event: { type: "text_done", text: "persisted answer", parentToolUseId: null },
      });
      const priorUsage = createEvent("agent_usage_updated", {
        executionId: "prior-exec",
        costUsd: 0.5,
        durationMs: 1_000,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
      });
      appendSessionEvent(created.sessionDir, priorText);
      appendSessionEvent(created.sessionDir, priorUsage);
      const replayed: SessionEvent[] = [];
      const reported: SessionEvent[] = [];
      const runReporter = Object.assign(
        reporter((event) => reported.push(event)),
        {
          replay(events: readonly SessionEvent[]) {
            replayed.push(...events);
          },
        },
      );

      const code = await executeSession({
        config: { steps: created.invocation.steps, passthroughArgs: [script] },
        runtimeConfig: runtimeConfig(),
        template: { source: "default", template: "{{task}}" },
        projectRoot: root,
        resumeSession: loadSession(created.sessionDir),
        reporter: runReporter,
      });

      expect(code).toBe(0);
      expect(replayed.map((event) => event.id)).toEqual([
        created.createdEvent.id,
        priorText.id,
        priorUsage.id,
      ]);
      expect(reported[0]?.type).toBe("attempt_started");
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, "LOOP_STATE_HOME");
      else process.env.LOOP_STATE_HOME = previous;
    }
  });

  test("contains reporter exceptions", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-execute-"));
    const result = await run(root, {
      reporter: reporter(() => {
        throw new Error("presentation failed");
      }),
    });
    expect(result.code).toBe(0);
  });

  test("does not spawn an agent for an already aborted signal", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-execute-"));
    const marker = path.join(root, "spawned");
    const controller = new AbortController();
    controller.abort();
    const result = await run(root, { reporter: reporter(), signal: controller.signal, marker });

    expect(result.code).toBe(130);
    expect(fs.existsSync(marker)).toBe(false);
    expect(fs.existsSync(path.join(result.sessionDir, "active.lock"))).toBe(false);
  });
});
