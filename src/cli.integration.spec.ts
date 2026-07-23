import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { appendSessionEvent, readSessionEvents } from "./lib/session-event-store.js";
import { createEvent } from "./lib/session-event.js";
import { createResumableSession } from "./lib/session.js";

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const temporaryDirs: string[] = [];

function temporaryDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-cli-integration-"));
  temporaryDirs.push(dir);
  return dir;
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Condition not met within ${timeoutMs}ms`);
    await Bun.sleep(10);
  }
}

function onlySessionDir(stateHome: string): string {
  const sessionsRoot = path.join(stateHome, "sessions");
  const projects = fs.readdirSync(sessionsRoot);
  expect(projects).toHaveLength(1);
  const projectDir = path.join(sessionsRoot, projects[0]);
  const sessions = fs.readdirSync(projectDir);
  expect(sessions).toHaveLength(1);
  return path.join(projectDir, sessions[0]);
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("CLI execution", () => {
  test("advances an until loop after each one-shot Pi process exits", async () => {
    const root = temporaryDir();
    const projectRoot = path.join(root, "project");
    const configHome = path.join(root, "config");
    const stateHome = path.join(root, "state");
    const invocationPath = path.join(root, "invocations.txt");
    const fakePiPath = path.join(root, "fake-pi.js");

    fs.mkdirSync(path.join(projectRoot, ".loop"), { recursive: true });
    fs.mkdirSync(configHome, { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".loop", "config.toml"),
      `[agents.pi]\ncommand = ${JSON.stringify(fakePiPath)}\n`,
    );
    fs.writeFileSync(
      fakePiPath,
      `#!${process.execPath}\nimport fs from "node:fs";\nfs.appendFileSync(${JSON.stringify(invocationPath)}, "run\\n");\nprocess.stdout.write(JSON.stringify({ type: "session", id: "fake-session" }) + "\\n");\nprocess.stdout.write(JSON.stringify({ type: "agent_start", model: "fake-pi" }) + "\\n");\nprocess.stdout.write(JSON.stringify({ type: "agent_end", result: "work remains\\nLOOP_CONTINUE: work remains", durationMs: 10, usage: { input: 1, output: 1 } }) + "\\n");\n`,
      { mode: 0o755 },
    );

    const cli = Bun.spawn(
      [
        process.execPath,
        path.join(REPO_ROOT, "src/cli.ts"),
        "--agent",
        "pi",
        "work",
        "--until",
        "done",
        "--max",
        "2",
      ],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          LOOP_CONFIG_HOME: configHome,
          LOOP_STATE_HOME: stateHome,
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode] = await Promise.all([
      cli.exited,
      new Response(cli.stdout).text(),
      new Response(cli.stderr).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(fs.readFileSync(invocationPath, "utf-8").trim().split("\n")).toHaveLength(2);
    expect(fs.existsSync(path.join(onlySessionDir(stateHome), "active.lock"))).toBe(false);
  }, 10_000);
});

describe("CLI resume", () => {
  test("continues the first incomplete step in the original session", async () => {
    const root = temporaryDir();
    const projectRoot = path.join(root, "project");
    const stateHome = path.join(root, "state");
    const invocationPath = path.join(root, "invocations.txt");
    const fakePiPath = path.join(root, "fake-pi.js");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(
      fakePiPath,
      `#!${process.execPath}\nimport fs from "node:fs";\nfs.appendFileSync(${JSON.stringify(invocationPath)}, "run\\n");\nprocess.stdout.write(JSON.stringify({ type: "session", id: "resumed" }) + "\\n");\nprocess.stdout.write(JSON.stringify({ type: "agent_start", model: "fake-pi" }) + "\\n");\nprocess.stdout.write(JSON.stringify({ type: "agent_end", result: "resumed work done", durationMs: 10, usage: { input: 1, output: 1 } }) + "\\n");\n`,
      { mode: 0o755 },
    );
    const { sessionDir } = createResumableSession(
      {
        loopVersion: "test",
        projectRoot,
        steps: [
          { type: "task", task: "Already done" },
          { type: "task", task: "Resume me" },
        ],
        template: { source: "default", content: "{{task}} {{previousSummary}}", sha256: "hash" },
        agent: { name: "pi", command: fakePiPath, args: {}, passthroughArgs: [] },
      },
      { ...process.env, LOOP_STATE_HOME: stateHome },
    );
    const firstResult = {
      step: { type: "task", task: "Already done" } as const,
      iterations: 1,
      result: "persisted first result",
      costUsd: 0,
      durationMs: 1,
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
      exitReason: "done" as const,
    };
    appendSessionEvent(sessionDir, createEvent("attempt_started", {}, { attemptId: "first" }));
    appendSessionEvent(sessionDir, createEvent("step_started", { stepIndex: 0 }));
    appendSessionEvent(
      sessionDir,
      createEvent("step_completed", {
        stepIndex: 0,
        summary: "persisted first result",
        result: firstResult,
      }),
    );
    appendSessionEvent(sessionDir, createEvent("step_started", { stepIndex: 1 }));
    appendSessionEvent(sessionDir, createEvent("attempt_aborted", {}, { attemptId: "first" }));

    const cli = Bun.spawn([process.execPath, path.join(REPO_ROOT, "src/cli.ts"), "resume"], {
      cwd: root,
      env: { ...process.env, LOOP_STATE_HOME: stateHome },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    await Bun.sleep(100);
    cli.stdin.write("\r");
    await Bun.sleep(50);
    cli.stdin.write("\r");
    cli.stdin.end();
    const [exitCode, stderr] = await Promise.all([
      cli.exited,
      new Response(cli.stderr).text(),
      new Response(cli.stdout).text(),
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(fs.readFileSync(invocationPath, "utf-8").trim().split("\n")).toEqual(["run"]);
    expect(onlySessionDir(stateHome)).toBe(sessionDir);
    const events = readSessionEvents(sessionDir).events;
    expect(events.filter((event) => event.type === "attempt_started")).toHaveLength(2);
    expect(events.filter((event) => event.type === "step_completed")).toHaveLength(2);
    expect(events.filter((event) => event.type === "step_iteration_started")).toHaveLength(1);
    expect(fs.existsSync(path.join(sessionDir, "active.lock"))).toBe(false);
  }, 10_000);
});

describe("CLI failures", () => {
  test("finalizes the session when the agent executable is missing", async () => {
    const root = temporaryDir();
    const projectRoot = path.join(root, "project");
    const configHome = path.join(root, "config");
    const stateHome = path.join(root, "state");

    fs.mkdirSync(path.join(projectRoot, ".loop"), { recursive: true });
    fs.mkdirSync(configHome, { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".loop", "config.toml"),
      `[agents.pi]\ncommand = ${JSON.stringify(path.join(root, "missing-pi"))}\n`,
    );

    const cli = Bun.spawn(
      [process.execPath, path.join(REPO_ROOT, "src/cli.ts"), "--agent", "pi", "work"],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          LOOP_CONFIG_HOME: configHome,
          LOOP_STATE_HOME: stateHome,
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = new Response(cli.stdout).text();
    const stderr = new Response(cli.stderr).text();

    const exitCode = await Promise.race([cli.exited, Bun.sleep(3_000).then(() => undefined)]);
    if (exitCode === undefined) {
      cli.kill("SIGKILL");
      await cli.exited;
    }
    await Promise.allSettled([stdout, stderr]);

    expect(exitCode).toBe(1);
    const sessionDir = onlySessionDir(stateHome);
    expect(fs.existsSync(path.join(sessionDir, "active.lock"))).toBe(false);
    const metadata = JSON.parse(
      fs.readFileSync(path.join(sessionDir, "session.json"), "utf-8"),
    ) as { status?: string };
    expect(metadata.status).toBe("failed");
  }, 10_000);

  test("terminates a Pi process that closes stdout without completing", async () => {
    const root = temporaryDir();
    const projectRoot = path.join(root, "project");
    const configHome = path.join(root, "config");
    const stateHome = path.join(root, "state");
    const agentPidPath = path.join(root, "agent.pid");
    const fakePiPath = path.join(root, "fake-pi.js");

    fs.mkdirSync(path.join(projectRoot, ".loop"), { recursive: true });
    fs.mkdirSync(configHome, { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".loop", "config.toml"),
      `[agents.pi]\ncommand = ${JSON.stringify(fakePiPath)}\n`,
    );
    fs.writeFileSync(
      fakePiPath,
      `#!/bin/sh\nprintf '%s' "$$" > ${JSON.stringify(agentPidPath)}\nexec 1>&-\nexec sleep 1000\n`,
      { mode: 0o755 },
    );

    const cli = Bun.spawn(
      [process.execPath, path.join(REPO_ROOT, "src/cli.ts"), "--agent", "pi", "work"],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          LOOP_CONFIG_HOME: configHome,
          LOOP_STATE_HOME: stateHome,
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = new Response(cli.stdout).text();
    const stderr = new Response(cli.stderr).text();

    let agentPid: number | undefined;
    try {
      await waitFor(() => fs.existsSync(agentPidPath));
      agentPid = Number(fs.readFileSync(agentPidPath, "utf-8"));
      const exitCode = await Promise.race([cli.exited, Bun.sleep(3_000).then(() => undefined)]);
      if (exitCode === undefined) {
        cli.kill("SIGKILL");
        await cli.exited;
      }

      expect(exitCode).toBe(1);
      expect(isProcessRunning(agentPid)).toBe(false);
      expect(fs.existsSync(path.join(onlySessionDir(stateHome), "active.lock"))).toBe(false);
    } finally {
      if (cli.exitCode === null) cli.kill("SIGKILL");
      if (agentPid !== undefined && isProcessRunning(agentPid)) process.kill(agentPid, "SIGKILL");
      await Promise.allSettled([stdout, stderr]);
    }
  }, 10_000);
});

describe("CLI interruption", () => {
  test("forces agent shutdown on a second interrupt", async () => {
    const root = temporaryDir();
    const projectRoot = path.join(root, "project");
    const configHome = path.join(root, "config");
    const stateHome = path.join(root, "state");
    const agentPidPath = path.join(root, "agent.pid");
    const termSeenPath = path.join(root, "term-seen");
    const fakePiPath = path.join(root, "fake-pi.js");

    fs.mkdirSync(path.join(projectRoot, ".loop"), { recursive: true });
    fs.mkdirSync(configHome, { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".loop", "config.toml"),
      `[agents.pi]\ncommand = ${JSON.stringify(fakePiPath)}\n`,
    );
    fs.writeFileSync(
      fakePiPath,
      `#!${process.execPath}\nimport fs from "node:fs";\nsetInterval(() => {}, 1000);\nprocess.on("SIGTERM", () => {\n  fs.writeFileSync(${JSON.stringify(termSeenPath)}, "seen");\n});\nprocess.stdout.write(JSON.stringify({ type: "session", id: "fake-session" }) + "\\n");\nprocess.stdout.write(JSON.stringify({ type: "agent_start", model: "fake-pi" }) + "\\n");\nfs.writeFileSync(${JSON.stringify(agentPidPath)}, String(process.pid));\n`,
      { mode: 0o755 },
    );

    const cli = Bun.spawn(
      [process.execPath, path.join(REPO_ROOT, "src/cli.ts"), "--agent", "pi", "wait"],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          LOOP_CONFIG_HOME: configHome,
          LOOP_STATE_HOME: stateHome,
        },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = new Response(cli.stdout).text();
    const stderr = new Response(cli.stderr).text();

    let agentPid: number | undefined;
    try {
      await waitFor(() => fs.existsSync(agentPidPath));
      agentPid = Number(fs.readFileSync(agentPidPath, "utf-8"));

      cli.kill("SIGINT");
      await waitFor(() => fs.existsSync(termSeenPath));
      cli.kill("SIGINT");

      const exitCode = await Promise.race([cli.exited, Bun.sleep(3_000).then(() => undefined)]);
      if (exitCode === undefined) {
        cli.kill("SIGKILL");
        await cli.exited;
      }

      expect(exitCode).toBe(130);
      expect(isProcessRunning(agentPid)).toBe(false);
      expect(fs.existsSync(path.join(onlySessionDir(stateHome), "active.lock"))).toBe(false);
    } finally {
      if (cli.exitCode === null) cli.kill("SIGKILL");
      if (agentPid !== undefined && isProcessRunning(agentPid)) process.kill(agentPid, "SIGKILL");
      await Promise.allSettled([stdout, stderr]);
    }
  }, 10_000);

  test("waits for agent shutdown and finalizes the aborted session", async () => {
    const root = temporaryDir();
    const projectRoot = path.join(root, "project");
    const configHome = path.join(root, "config");
    const stateHome = path.join(root, "state");
    const agentPidPath = path.join(root, "agent.pid");
    const agentCleanupPath = path.join(root, "agent-cleanup-complete");
    const fakePiPath = path.join(root, "fake-pi.js");

    fs.mkdirSync(path.join(projectRoot, ".loop"), { recursive: true });
    fs.mkdirSync(configHome, { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".loop", "config.toml"),
      `[agents.pi]\ncommand = ${JSON.stringify(fakePiPath)}\n`,
    );
    fs.writeFileSync(
      fakePiPath,
      `#!${process.execPath}\nimport fs from "node:fs";\nconst keepAlive = setInterval(() => {}, 1000);\nprocess.on("SIGTERM", () => {\n  clearInterval(keepAlive);\n  setTimeout(() => {\n    fs.writeFileSync(${JSON.stringify(agentCleanupPath)}, "done");\n    process.exit(0);\n  }, 150);\n});\nprocess.stdout.write(JSON.stringify({ type: "session", id: "fake-session" }) + "\\n");\nprocess.stdout.write(JSON.stringify({ type: "agent_start", model: "fake-pi" }) + "\\n");\nfs.writeFileSync(${JSON.stringify(agentPidPath)}, String(process.pid));\n`,
      { mode: 0o755 },
    );

    const cli = Bun.spawn(
      [process.execPath, path.join(REPO_ROOT, "src/cli.ts"), "--agent", "pi", "wait"],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          LOOP_CONFIG_HOME: configHome,
          LOOP_STATE_HOME: stateHome,
        },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = new Response(cli.stdout).text();
    const stderr = new Response(cli.stderr).text();

    let agentPid: number | undefined;
    try {
      await waitFor(() => fs.existsSync(agentPidPath));
      agentPid = Number(fs.readFileSync(agentPidPath, "utf-8"));

      cli.kill("SIGINT");

      const exitCode = await Promise.race([cli.exited, Bun.sleep(3_000).then(() => undefined)]);
      if (exitCode === undefined) {
        cli.kill("SIGKILL");
        await cli.exited;
      }

      expect(exitCode).toBe(130);
      expect(fs.existsSync(agentCleanupPath)).toBe(true);
      expect(isProcessRunning(agentPid)).toBe(false);

      const sessionDir = onlySessionDir(stateHome);
      expect(fs.existsSync(path.join(sessionDir, "active.lock"))).toBe(false);

      const metadata = JSON.parse(
        fs.readFileSync(path.join(sessionDir, "session.json"), "utf-8"),
      ) as { status?: string };
      expect(metadata.status).toBe("aborted");

      const events = fs
        .readFileSync(path.join(sessionDir, "events.jsonl"), "utf-8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { type?: string });
      expect(events.some((event) => event.type === "attempt_aborted")).toBe(true);
    } finally {
      if (cli.exitCode === null) cli.kill("SIGKILL");
      if (agentPid !== undefined && isProcessRunning(agentPid)) process.kill(agentPid, "SIGKILL");
      await Promise.allSettled([stdout, stderr]);
    }
  }, 10_000);
});
