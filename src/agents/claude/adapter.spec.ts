import { describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createClaudeAdapter } from "./adapter";

function writeFakeClaude(): { command: string; argvPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-claude-adapter-test-"));
  const argvPath = path.join(dir, "argv.json");
  const command = writeClaudeScript(
    dir,
    `import fs from "node:fs";
fs.writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "ok", total_cost_usd: 0, duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }) + "\\n");`,
  );
  return { command, argvPath };
}

function writeClaudeScript(dir: string, source: string): string {
  const command = path.join(dir, "fake-claude.js");
  fs.writeFileSync(command, `#!/usr/bin/env node\n${source}\n`);
  fs.chmodSync(command, 0o755);
  return command;
}

async function collectSession(command: string) {
  const session = createClaudeAdapter({ command }).spawn("hello");
  const events = [];
  for await (const event of session.events) events.push(event);
  await session.exited;
  return events;
}

describe("Claude adapter", () => {
  test("uses permission-mode auto by default", async () => {
    const { command, argvPath } = writeFakeClaude();
    const session = createClaudeAdapter({ command }).spawn("hello");
    for await (const _event of session.events) {
      // drain
    }
    await session.exited;

    expect(JSON.parse(fs.readFileSync(argvPath, "utf-8"))).toEqual([
      "--print",
      "--verbose",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--permission-mode",
      "auto",
      "hello",
    ]);
  });

  test("step args override configured args", async () => {
    const { command, argvPath } = writeFakeClaude();
    const session = createClaudeAdapter({
      command,
      args: { "permission-mode": "auto", "some-flag": true },
    }).spawn("hello", { args: { "permission-mode": "bypassPermissions" } });
    for await (const _event of session.events) {
      // drain
    }
    await session.exited;

    expect(JSON.parse(fs.readFileSync(argvPath, "utf-8"))).toEqual([
      "--print",
      "--verbose",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--permission-mode",
      "bypassPermissions",
      "--some-flag",
      "hello",
    ]);
  });

  test("reports stderr when the process fails after a completion event", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-claude-adapter-test-"));
    const command = writeClaudeScript(
      dir,
      `process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "ok", total_cost_usd: 0, duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0 } }) + "\\n");
process.stderr.write("authentication failed\\n");
process.exitCode = 7;`,
    );

    const events = await collectSession(command);

    expect(events).toEqual([
      {
        type: "error",
        message: "Claude process exited with code 7: authentication failed",
      },
    ]);
  });

  test("reports the original spawn error", async () => {
    const missing = path.join(os.tmpdir(), `missing-claude-${crypto.randomUUID()}`);

    const events = await collectSession(missing);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error" });
    expect(events[0]?.type === "error" ? events[0].message : "").toContain("ENOENT");
  });
});
