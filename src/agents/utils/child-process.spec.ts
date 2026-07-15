import { expect, test } from "bun:test";
import { once } from "node:events";
import { spawnChildProcess } from "./child-process.js";

test("resolves when the child exits even if a descendant retains stdout", async () => {
  const script = [
    'const { spawn } = require("node:child_process")',
    'const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 500)"], { detached: true, stdio: ["ignore", 1, 2] })',
    "child.unref()",
  ].join(";");
  const child = spawnChildProcess(process.execPath, ["-e", script]);

  const outcome = await Promise.race([
    child.result.then(() => "exited"),
    new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 200)),
  ]);

  expect(outcome).toBe("exited");
});

test("returns the exit status and buffered stderr", async () => {
  const child = spawnChildProcess(process.execPath, [
    "-e",
    'process.stderr.write("bad credentials\\n"); process.exit(7)',
  ]);

  expect(await child.result).toMatchObject({
    exitCode: 7,
    signal: null,
    stderr: "bad credentials",
  });
});

test("force kills a process that ignores graceful termination", async () => {
  const child = spawnChildProcess(
    process.execPath,
    ["-e", 'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000)'],
    { forceAfterMs: 20 },
  );
  await once(child.stdout, "data");

  child.abort();
  const outcome = await Promise.race([
    child.result.then(() => "exited"),
    new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 300)),
  ]);

  expect(outcome).toBe("exited");
});
