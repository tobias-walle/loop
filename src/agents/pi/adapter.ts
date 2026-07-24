import { type AgentArgs, mergeAgentArgs, renderAgentArgs } from "../../lib/agent-args.js";
import { type Logger, noopLogger } from "../../lib/logging.js";
import type { AgentAdapter, AgentEvent, AgentSession, AgentSpawnOptions } from "../types.js";
import {
  type ChildProcessHandle,
  childProcessFailure,
  spawnChildProcess,
} from "../utils/child-process.js";
import { completePendingSession, createPiEventState, mapPiEvent } from "./events.js";
import { readJsonLines } from "./json.js";

const PROCESS_NAME = "pi JSON process";

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
      const startedAt = Date.now();
      logger.debug("Spawning pi JSON process", {
        command,
        cwd: opts?.cwd,
        argCount: args.length,
      });
      const child = spawnChildProcess(command, args, {
        cwd: opts?.cwd,
        env: { ...configuredEnv, ...(opts?.env ?? {}) },
      });
      logLifecycle(child, logger);

      return {
        events: streamPiSession(streamPiEvents(child.stdout, startedAt), child, logger),
        exited: child.result.then(() => undefined),
        abort(): void {
          logger.warn("Aborting pi JSON process", { pid: child.pid });
          child.abort();
        },
      };
    },
  };
}

async function* streamPiEvents(
  stdout: import("node:stream").Readable,
  startedAt: number,
): AsyncGenerator<AgentEvent> {
  const state = createPiEventState();
  try {
    for await (const raw of readJsonLines(stdout)) {
      for (const event of mapPiEvent(raw, state)) yield withMeasuredDuration(event, startedAt);
    }
  } catch (error) {
    yield { type: "error", message: error instanceof Error ? error.message : String(error) };
    return;
  }
  if (state.pendingDone || state.pendingTurnError)
    yield withMeasuredDuration(completePendingSession(state), startedAt);
}

async function* streamPiSession(
  source: AsyncIterable<AgentEvent>,
  child: ChildProcessHandle,
  logger: Logger,
): AsyncGenerator<AgentEvent> {
  for await (const event of source) {
    if (event.type === "error") {
      child.abort();
      yield event;
      return;
    }
    if (event.type === "done") {
      const result = await child.result;
      const failure = childProcessFailure(PROCESS_NAME, result);
      if (failure) {
        logger.warn(failure, { pid: child.pid, code: result.exitCode, signal: result.signal });
        yield { type: "error", message: failure };
      } else yield event;
      return;
    }
    yield event;
  }

  const wasRunning = child.isRunning();
  if (wasRunning) child.abort();
  const result = await child.result;
  const failure =
    result.error || result.exitCode !== 0 || !wasRunning
      ? childProcessFailure(PROCESS_NAME, result)
      : undefined;
  const message = failure ?? "pi JSON stream ended without completion";
  logger.warn(message, { pid: child.pid, exitCode: result.exitCode });
  yield { type: "error", message };
}

function withMeasuredDuration(
  event: Extract<AgentEvent, { type: "done" }>,
  startedAt: number,
): Extract<AgentEvent, { type: "done" }>;
function withMeasuredDuration(event: AgentEvent, startedAt: number): AgentEvent;
function withMeasuredDuration(event: AgentEvent, startedAt: number): AgentEvent {
  if (event.type !== "done" || event.durationMs > 0) return event;
  return { ...event, durationMs: Math.max(1, Date.now() - startedAt) };
}

function logLifecycle(child: ChildProcessHandle, logger: Logger): void {
  if (child.pid == null) logger.warn("pi JSON process spawned without PID");
  else logger.info("pi JSON process spawned", { pid: child.pid });
  void child.result.then((result) => {
    logger.info("pi JSON process exited", {
      pid: child.pid,
      code: result.exitCode,
      signal: result.signal,
    });
  });
}
