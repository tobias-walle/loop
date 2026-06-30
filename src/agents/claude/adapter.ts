import { type ChildProcess, spawn } from "node:child_process";
import { type Logger, noopLogger } from "../../lib/logging.js";
import type { AgentAdapter, AgentSession, AgentSpawnOptions } from "../types.js";
import { streamEvents } from "./stream.js";

export interface ClaudeAdapterOptions {
  command?: string;
  model?: string;
  args?: string[];
  env?: Record<string, string>;
  logger?: Logger;
}

export function createClaudeAdapter(options?: ClaudeAdapterOptions): AgentAdapter {
  const logger = options?.logger ?? noopLogger;
  const command = options?.command ?? "claude";
  const configuredArgs = options?.args ?? [];
  const configuredEnv = options?.env ?? {};
  if (options?.model) {
    logger.warn(
      "Claude model config is currently ignored until Claude CLI model support is verified",
      {
        model: options.model,
      },
    );
  }

  return {
    spawn(prompt: string, opts?: AgentSpawnOptions): AgentSession {
      const args = [
        "--print",
        "--verbose",
        "--dangerously-skip-permissions",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        ...configuredArgs,
        prompt,
      ];

      logger.debug("Spawning claude process", {
        cwd: opts?.cwd,
        argCount: args.length,
        command,
      });

      const proc: ChildProcess = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: opts?.cwd,
        env: { ...process.env, ...configuredEnv, ...(opts?.env ?? {}) },
      });

      const pid = proc.pid;
      if (pid == null) {
        logger.warn("Claude process spawned without PID (spawn may have failed)");
      } else {
        logger.info("Claude process spawned", { pid });
      }

      const exited = new Promise<void>((resolveExit) => {
        proc.on("exit", (code, signal) => {
          logger.info("Claude process exited", { pid, code, signal });
          if (proc.stdout && !proc.stdout.destroyed) {
            proc.stdout.destroy();
          }
          resolveExit();
        });
      });

      proc.on("error", (err) => {
        logger.error("Claude process error", { pid, error: err.message });
      });

      let stderrBuf = "";
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString();
        let idx = stderrBuf.indexOf("\n");
        while (idx !== -1) {
          const line = stderrBuf.slice(0, idx).trim();
          if (line) logger.warn("Claude stderr", { pid, line });
          stderrBuf = stderrBuf.slice(idx + 1);
          idx = stderrBuf.indexOf("\n");
        }
      });
      proc.stderr?.on("end", () => {
        if (stderrBuf.trim()) {
          logger.warn("Claude stderr", { pid, line: stderrBuf.trim() });
        }
      });

      const events = proc.stdout
        ? wrapTerminateOnEnd(streamEvents(proc.stdout), proc, logger, pid)
        : emptyEvents();

      return {
        events,
        exited,
        abort(): void {
          logger.warn("Aborting claude process", { pid });
          proc.kill("SIGTERM");
        },
      };
    },
  };
}

async function* wrapTerminateOnEnd(
  source: AsyncGenerator<import("../types.js").AgentEvent>,
  proc: ChildProcess,
  logger: Logger,
  pid: number | undefined,
): AsyncGenerator<import("../types.js").AgentEvent> {
  for await (const event of source) {
    yield event;
    if (event.type === "done" || event.type === "error") {
      logger.debug("Terminating claude process after event", { pid, eventType: event.type });
      proc.kill("SIGTERM");
      return;
    }
  }

  const exitCode = proc.exitCode;
  const msg =
    exitCode != null
      ? `Claude process exited unexpectedly (code ${exitCode})`
      : "Claude event stream ended without completion";
  logger.warn(msg, { pid, exitCode });
  if (exitCode == null) proc.kill("SIGTERM");
  yield { type: "error", message: msg };
}

async function* emptyEvents(): AsyncGenerator<import("../types.js").AgentEvent> {
  yield { type: "error", message: "Claude process has no stdout stream" };
}
