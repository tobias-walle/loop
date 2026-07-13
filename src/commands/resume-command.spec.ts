import { describe, expect, test } from "bun:test";
import type { StoredInvocation } from "../lib/session-events.js";
import { buildResumeRuntimeConfig } from "./resume-command.js";

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
