import { describe, expect, test } from "bun:test";
import type { StoredInvocation } from "../lib/session-event.js";
import { buildResumeRuntimeConfig, resumeCommand } from "./resume-command.js";

const invocation: StoredInvocation = {
  sessionId: "id",
  loopVersion: "test",
  projectRoot: "/project",
  steps: [{ type: "task", task: "Fix" }],
  template: { source: "user", content: "stored template", sha256: "hash" },
  agent: {
    name: "pi",
    command: "/stored/pi",
    model: "stored-model",
    args: { provider: "stored" },
    passthroughArgs: ["--thinking", "high"],
  },
};

describe("resumeCommand", () => {
  test("does not execute a session when the browser exits", async () => {
    let executions = 0;
    const result = await resumeCommand(
      {
        stdout: { isTTY: false, write() {} },
        writeError() {},
      },
      {
        projectRoot: process.cwd(),
        env: {},
        spawnProcess() {
          throw new Error("not expected");
        },
        browseSessions: async () => ({ type: "exit", exitCode: 7 }),
        createRunReporter() {
          throw new Error("not expected");
        },
        executeSession: async () => {
          executions++;
          return 0;
        },
      },
    );

    expect(result).toBe(7);
    expect(executions).toBe(0);
  });
});

describe("buildResumeRuntimeConfig", () => {
  test("restores persisted agent settings while retaining current environment", () => {
    const runtime = buildResumeRuntimeConfig(invocation, {
      agent: "claude",
      agents: {
        claude: { command: "claude", args: {}, env: {} },
        pi: { command: "pi", model: "new-model", args: {}, env: { API_TOKEN: "current" } },
      },
    });

    expect(runtime.agent).toBe("pi");
    expect(runtime.agents.pi).toEqual({
      command: "/stored/pi",
      model: "stored-model",
      args: { provider: "stored" },
      env: { API_TOKEN: "current" },
    });
  });
});
