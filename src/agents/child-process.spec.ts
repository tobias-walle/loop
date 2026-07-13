import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createChildProcessController } from "./child-process.js";

test("resolves when the child exits even if a descendant retains stdout", async () => {
  const script = [
    'const { spawn } = require("node:child_process")',
    'const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 500)"], { detached: true, stdio: ["ignore", 1, 2] })',
    "child.unref()",
  ].join(";");
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  const controller = createChildProcessController(child);

  const outcome = await Promise.race([
    controller.exited.then(() => "exited"),
    new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 200)),
  ]);

  expect(outcome).toBe("exited");
});
