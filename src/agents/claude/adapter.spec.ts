import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createClaudeAdapter } from "./adapter";

function writeFakeClaude(): { command: string; argvPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-claude-adapter-test-"));
  const argvPath = path.join(dir, "argv.json");
  const command = path.join(dir, "fake-claude.js");
  fs.writeFileSync(
    command,
    `#!/usr/bin/env node
import fs from "node:fs";
fs.writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "ok", total_cost_usd: 0, duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }) + "\\n");
`,
  );
  fs.chmodSync(command, 0o755);
  return { command, argvPath };
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
});
