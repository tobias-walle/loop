import { type ChildProcess, spawn } from "node:child_process";
import { type AgentArgs, mergeAgentArgs, renderAgentArgs } from "../../lib/agent-args.js";
import { type Logger, noopLogger } from "../../lib/logging.js";
import { createChildProcessController } from "../child-process.js";
import type { AgentAdapter, AgentSession, AgentSpawnOptions } from "../types.js";
import { streamEvents } from "./stream.js";

const DEFAULT_CLAUDE_ARGS: AgentArgs = { "permission-mode": "auto" };

export interface ClaudeAdapterOptions {
  command?: string;
  model?: string;
  args?: AgentArgs;
  rawArgs?: string[];
  env?: Record<string, string>;
  logger?: Logger;
}

export function createClaudeAdapter(options?: ClaudeAdapterOptions): AgentAdapter {
  const logger = options?.logger ?? noopLogger;
  const command = options?.command ?? "claude";
  const configuredArgs = options?.args ?? {};
  const configuredRawArgs = options?.rawArgs ?? [];
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
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        ...renderAgentArgs(mergeAgentArgs(DEFAULT_CLAUDE_ARGS, configuredArgs, opts?.args)),
        ...configuredRawArgs,
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

      const controller = createChildProcessController(proc, {
        onExit: (code, signal) => {
          logger.info("Claude process exited", { pid, code, signal });
        },
        onForceKill: () => logger.warn("Force killing unresponsive Claude process", { pid }),
      });
      const terminate = () => controller.terminate();
      const events = proc.stdout
        ? wrapTerminateOnEnd(streamEvents(proc.stdout), proc, logger, pid, terminate)
        : emptyEvents(terminate);

      return {
        events,
        exited: controller.exited,
        abort(): void {
          const signal = terminate();
          logger.warn("Aborting claude process", { pid, signal });
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
  terminate: () => NodeJS.Signals,
): AsyncGenerator<import("../types.js").AgentEvent> {
  for await (const event of source) {
    if (event.type === "done" || event.type === "error") {
      logger.debug("Terminating claude process after event", { pid, eventType: event.type });
      terminate();
    }
    yield event;
    if (event.type === "done" || event.type === "error") return;
  }

  const exitCode = proc.exitCode;
  const msg =
    exitCode != null
      ? `Claude process exited unexpectedly (code ${exitCode})`
      : "Claude event stream ended without completion";
  logger.warn(msg, { pid, exitCode });
  terminate();
  yield { type: "error", message: msg };
}

async function* emptyEvents(
  terminate: () => NodeJS.Signals,
): AsyncGenerator<import("../types.js").AgentEvent> {
  terminate();
  yield { type: "error", message: "Claude process has no stdout stream" };
}
