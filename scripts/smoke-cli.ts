import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "loop-cli-smoke-"));
const projectRoot = join(temporaryRoot, "project");
const markerPath = join(temporaryRoot, "agent-ran");
const fakePiPath = join(temporaryRoot, "fake-pi");

try {
  mkdirSync(projectRoot);
  writeFileSync(
    fakePiPath,
    `#!/usr/bin/env node
import fs from "node:fs";
fs.writeFileSync(${JSON.stringify(markerPath)}, "yes");
process.stdout.write(JSON.stringify({ type: "agent_start", model: "smoke" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "message_end", message: { stopReason: "stop" } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_end", result: "ok", usage: { input: 1, output: 1 } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\\n");
`,
  );
  chmodSync(fakePiPath, 0o755);

  const result = spawnSync("node", [join(root, "dist/cli.js"), "--agent", "pi", "smoke"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      LOOP_CONFIG_HOME: join(temporaryRoot, "config"),
      LOOP_STATE_HOME: join(temporaryRoot, "state"),
      LOOP_PI_COMMAND: fakePiPath,
    },
    encoding: "utf8",
    timeout: 10_000,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Built CLI exited with code ${String(result.status)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  if (readFileSync(markerPath, "utf8") !== "yes") {
    throw new Error("Built CLI did not execute the configured pi agent");
  }
  if (!result.stdout.includes("✓ done")) {
    throw new Error(`Built CLI did not report completion\nstdout:\n${result.stdout}`);
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
