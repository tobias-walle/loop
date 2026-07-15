import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { LoopRuntimeConfig } from "../lib/config/index.js";
import type { LoopTUI } from "../tui/loop-tui.js";
import { executeSession } from "./execute-session.js";

function writeSuccessfulPi(root: string): string {
  const script = path.join(root, "fake-pi.js");
  fs.writeFileSync(
    script,
    `process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_end", result: "done", durationMs: 1, usage: { input: 0, output: 0 } }) + "\\n");
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

function tui(overrides: Partial<LoopTUI> = {}): LoopTUI {
  return {
    start() {},
    stop() {},
    showRunScreen() {},
    handleEvent() {},
    showInterruption() {},
    showStepHeader() {},
    showCompletion() {},
    showSessionInfo() {},
    showRunSummary() {},
    updateStatus() {},
    ...overrides,
  };
}

async function runWithTui(root: string, customTui: LoopTUI): Promise<number> {
  const script = writeSuccessfulPi(root);
  const previousStateHome = process.env.LOOP_STATE_HOME;
  process.env.LOOP_STATE_HOME = path.join(root, "state");
  try {
    return await executeSession({
      config: {
        steps: [{ type: "task", task: "work" }],
        passthroughArgs: [script],
      },
      runtimeConfig: runtimeConfig(),
      template: { source: "test", template: "{{task}}" },
      projectRoot: root,
      tui: customTui,
    });
  } finally {
    if (previousStateHome === undefined) Reflect.deleteProperty(process.env, "LOOP_STATE_HOME");
    else process.env.LOOP_STATE_HOME = previousStateHome;
  }
}

function sessionLockExists(root: string): boolean {
  const sessions = path.join(root, "state", "sessions");
  const project = fs.readdirSync(sessions)[0];
  const session = fs.readdirSync(path.join(sessions, project))[0];
  return fs.existsSync(path.join(sessions, project, session, "active.lock"));
}

describe("executeSession error recovery", () => {
  test("does not let TUI cleanup replace a successful result", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-execute-session-test-"));

    const result = await runWithTui(
      root,
      tui({
        stop() {
          throw new Error("TUI cleanup failed");
        },
      }),
    );

    expect(result).toBe(0);
    expect(sessionLockExists(root)).toBe(false);
  });

  test("contains an error thrown while reporting another failure", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-execute-session-test-"));

    const result = await runWithTui(
      root,
      tui({
        handleEvent() {
          throw new Error("TUI rendering failed");
        },
      }),
    );

    expect(result).toBe(1);
    expect(sessionLockExists(root)).toBe(false);
  });
});
