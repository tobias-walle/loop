import { type ChildProcess, spawn } from "node:child_process";
import { type Logger, noopLogger } from "../../lib/logging.js";
import type { AgentAdapter, AgentSession, AgentSpawnOptions } from "../types.js";
import { generateInteractiveEvents, streamEvents } from "./stream.js";

export interface ClaudeAdapterOptions {
  interactive?: boolean;
  logger?: Logger;
}

export function createClaudeAdapter(options?: ClaudeAdapterOptions): AgentAdapter {
  const interactive = options?.interactive ?? false;
  const logger = options?.logger ?? noopLogger;

  return {
    spawn(prompt: string, opts?: AgentSpawnOptions): AgentSession {
      const baseArgs = [
        "--verbose",
        "--dangerously-skip-permissions",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
      ];

      const args = interactive
        ? [...baseArgs, "--input-format", "stream-json"]
        : ["--print", ...baseArgs, prompt];

      logger.debug("Spawning claude process", {
        interactive,
        cwd: opts?.cwd,
        argCount: args.length,
      });

      const proc: ChildProcess = spawn("claude", args, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: opts?.cwd,
        env: opts?.env ? { ...process.env, ...opts.env } : undefined,
      });

      const pid = proc.pid;
      if (pid == null) {
        logger.warn("Claude process spawned without PID (spawn may have failed)", { interactive });
      } else {
        logger.info("Claude process spawned", { pid, interactive });
      }

      proc.on("error", (err) => {
        logger.error("Claude process error", { pid, error: err.message });
      });
      proc.on("exit", (code, signal) => {
        logger.info("Claude process exited", { pid, code, signal });
        // Ensure stdout closes so readLines unblocks even if the stream
        // wasn't closed cleanly (e.g. crash, SIGKILL).
        if (proc.stdout && !proc.stdout.destroyed) {
          proc.stdout.destroy();
        }
      });

      // Capture stderr so diagnostic output from Claude is not silently lost
      let stderrBuf = "";
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString();
        // Flush complete lines
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

      if (interactive) {
        const initMessage = JSON.stringify({
          type: "user",
          message: { role: "user", content: prompt },
        });
        const written = proc.stdin?.write(`${initMessage}\n`) ?? false;
        logger.debug("Sent initial prompt via stdin", {
          pid,
          promptLength: prompt.length,
          stdinWritable: proc.stdin?.writable ?? false,
          written,
        });
      }

      const sentMessages: string[] = [];

      function writeUserMessage(text: string): void {
        const msg = JSON.stringify({
          type: "user",
          message: { role: "user", content: text },
        });
        proc.stdin?.write(`${msg}\n`);
        sentMessages.push(text);
        logger.debug("Sent user message via stdin", { pid, textLength: text.length });
      }

      const events =
        interactive && proc.stdout
          ? wrapTerminateOnEnd(
              generateInteractiveEvents(proc.stdout, sentMessages),
              proc,
              logger,
              pid,
            )
          : proc.stdout
            ? wrapTerminateOnEnd(streamEvents(proc.stdout), proc, logger, pid)
            : emptyEvents();

      return {
        events,

        sendMessage(text: string): void {
          if (!interactive) {
            logger.debug("sendMessage ignored (non-interactive mode)", { pid });
            return;
          }
          writeUserMessage(text);
        },

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
      proc.stdin?.end();
      proc.kill("SIGTERM");
      return;
    }
  }

  // Stream ended without a terminal event — the process crashed or was killed.
  // Synthesize an error so the runner doesn't treat this as success.
  const exitCode = proc.exitCode;
  const msg =
    exitCode != null
      ? `Claude process exited unexpectedly (code ${exitCode})`
      : "Claude event stream ended without completion";
  logger.warn(msg, { pid, exitCode });
  proc.stdin?.end();
  if (exitCode == null) proc.kill("SIGTERM");
  yield { type: "error", message: msg };
}

async function* emptyEvents(): AsyncGenerator<import("../types.js").AgentEvent> {
  yield { type: "error", message: "Claude process has no stdout stream" };
}
