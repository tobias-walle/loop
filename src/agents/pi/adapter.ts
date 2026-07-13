import { type ChildProcess, spawn } from "node:child_process";
import { type AgentArgs, mergeAgentArgs, renderAgentArgs } from "../../lib/agent-args.js";
import { type Logger, noopLogger } from "../../lib/logging.js";
import { createChildProcessController } from "../child-process.js";
import type { AgentAdapter, AgentEvent, AgentSession, AgentSpawnOptions } from "../types.js";
import { completePendingDone, createPiEventState, mapPiEvent } from "./events.js";
import { readJsonLines } from "./json.js";

export interface PiAdapterOptions {
  command?: string;
  model?: string;
  args?: AgentArgs;
  rawArgs?: string[];
  env?: Record<string, string>;
  logger?: Logger;
}

export function createPiAdapter(options: PiAdapterOptions = {}): AgentAdapter {
  const command = options.command ?? "pi";
  const model = options.model;
  const configuredArgs = options.args ?? {};
  const configuredRawArgs = options.rawArgs ?? [];
  const configuredEnv = options.env ?? {};
  const logger = options.logger ?? noopLogger;

  if (
    configuredArgs.mode !== undefined ||
    configuredRawArgs.some((arg) => arg === "--mode" || arg.startsWith("--mode="))
  ) {
    throw new Error('pi adapter does not allow "--mode" in args because it must enforce JSON mode');
  }

  const sessionArgs =
    configuredArgs["no-session"] === true || configuredRawArgs.includes("--no-session")
      ? []
      : ["--no-session"];

  return {
    spawn(prompt: string, opts?: AgentSpawnOptions): AgentSession {
      const renderedArgs = renderAgentArgs(mergeAgentArgs(configuredArgs, opts?.args));
      if (opts?.args?.mode !== undefined) {
        throw new Error(
          'pi adapter does not allow "--mode" in step args because it must enforce JSON mode',
        );
      }
      const args = [
        ...(model ? ["--model", model] : []),
        ...renderedArgs,
        ...configuredRawArgs,
        ...sessionArgs,
        "--print",
        "--mode",
        "json",
        prompt,
      ];
      logger.debug("Spawning pi JSON process", { command, cwd: opts?.cwd, argCount: args.length });

      const startedAt = Date.now();
      const proc: ChildProcess = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: opts?.cwd,
        env: { ...process.env, ...configuredEnv, ...(opts?.env ?? {}) },
      });
      const pid = proc.pid;
      if (pid == null) logger.warn("pi JSON process spawned without PID");
      else logger.info("pi JSON process spawned", { pid });

      let stderrBuf = "";
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString();
        let idx = stderrBuf.indexOf("\n");
        while (idx !== -1) {
          const line = stderrBuf.slice(0, idx).trim();
          if (line) logger.warn("pi stderr", { pid, line });
          stderrBuf = stderrBuf.slice(idx + 1);
          idx = stderrBuf.indexOf("\n");
        }
      });
      proc.stderr?.on("end", () => {
        if (stderrBuf.trim()) logger.warn("pi stderr", { pid, line: stderrBuf.trim() });
      });
      proc.on("error", (err) => logger.error("pi JSON process error", { pid, error: err.message }));

      const controller = createChildProcessController(proc, {
        onExit: (code, signal) => {
          logger.info("pi JSON process exited", { pid, code, signal });
        },
        onForceKill: () => logger.warn("Force killing unresponsive pi JSON process", { pid }),
      });
      const terminate = () => controller.terminate();

      return {
        events: proc.stdout
          ? wrapPiEvents(proc.stdout, proc, logger, pid, startedAt, terminate)
          : noStdout(terminate),
        exited: controller.exited,
        abort(): void {
          const signal = terminate();
          logger.warn("Aborting pi JSON process", { pid, signal });
        },
      };
    },
  };
}

async function* wrapPiEvents(
  stdout: NodeJS.ReadableStream,
  proc: ChildProcess,
  logger: Logger,
  pid: number | undefined,
  startedAt: number,
  terminate: () => NodeJS.Signals,
): AsyncGenerator<AgentEvent> {
  const state = createPiEventState();
  try {
    for await (const raw of readJsonLines(stdout as import("node:stream").Readable)) {
      const events = mapPiEvent(raw, state);
      for (const mappedEvent of events) {
        const event = withMeasuredDuration(mappedEvent, startedAt);
        if (event.type === "done" || event.type === "error") {
          logger.debug("Terminating pi JSON process after event", { pid, eventType: event.type });
          terminate();
        }
        yield event;
        if (event.type === "done" || event.type === "error") return;
      }
    }
  } catch (err) {
    terminate();
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    return;
  }

  if (state.pendingDone) {
    terminate();
    yield withMeasuredDuration(completePendingDone(state), startedAt);
    return;
  }

  const exitCode = proc.exitCode;
  const message =
    exitCode != null
      ? `pi JSON process exited unexpectedly (code ${exitCode})`
      : "pi JSON stream ended without completion";
  logger.warn(message, { pid, exitCode });
  terminate();
  yield { type: "error", message };
}

function withMeasuredDuration(event: AgentEvent, startedAt: number): AgentEvent {
  if (event.type !== "done" || event.durationMs > 0) return event;
  return { ...event, durationMs: Math.max(1, Date.now() - startedAt) };
}

async function* noStdout(terminate: () => NodeJS.Signals): AsyncGenerator<AgentEvent> {
  terminate();
  yield { type: "error", message: "pi JSON process has no stdout stream" };
}
