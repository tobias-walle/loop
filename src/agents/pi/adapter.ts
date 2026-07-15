import { type ChildProcess, spawn } from "node:child_process";
import { type AgentArgs, mergeAgentArgs, renderAgentArgs } from "../../lib/agent-args.js";
import { type Logger, noopLogger } from "../../lib/logging.js";
import {
  type ChildProcessController,
  captureChildStderr,
  childProcessFailure,
  createChildProcessController,
} from "../child-process.js";
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

      const getStderr = captureChildStderr(proc.stderr, (line) => {
        logger.warn("pi stderr", { pid, line });
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
          ? wrapPiEvents(proc.stdout, proc, controller, getStderr, logger, pid, startedAt)
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
  controller: ChildProcessController,
  getStderr: () => string,
  logger: Logger,
  pid: number | undefined,
  startedAt: number,
): AsyncGenerator<AgentEvent> {
  const state = createPiEventState();
  try {
    for await (const raw of readJsonLines(stdout as import("node:stream").Readable)) {
      const events = mapPiEvent(raw, state);
      for (const mappedEvent of events) {
        const event = withMeasuredDuration(mappedEvent, startedAt);
        if (event.type === "error") {
          logger.debug("Terminating pi JSON process after error event", { pid });
          controller.terminate();
          yield event;
          return;
        }
        if (event.type === "done") {
          yield await validatePiCompletion(event, controller, getStderr, logger, pid);
          return;
        }
        yield event;
      }
    }
  } catch (err) {
    controller.terminate();
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    return;
  }

  if (state.pendingDone) {
    const done = withMeasuredDuration(completePendingDone(state), startedAt);
    yield await validatePiCompletion(done, controller, getStderr, logger, pid);
    return;
  }

  const outcome = controller.getOutcome();
  const failure = outcome
    ? childProcessFailure("pi JSON process", outcome, getStderr())
    : undefined;
  const exitCode = outcome?.code ?? proc.exitCode;
  const message =
    failure ??
    (exitCode != null
      ? `pi JSON process exited unexpectedly (code ${exitCode})`
      : "pi JSON stream ended without completion");
  logger.warn(message, { pid, exitCode });
  controller.terminate();
  yield { type: "error", message };
}

async function validatePiCompletion(
  done: Extract<AgentEvent, { type: "done" }>,
  controller: ChildProcessController,
  getStderr: () => string,
  logger: Logger,
  pid: number | undefined,
): Promise<AgentEvent> {
  const outcome = await controller.outcome;
  const failure = childProcessFailure("pi JSON process", outcome, getStderr());
  if (!failure) return done;
  logger.warn(failure, { pid, code: outcome.code, signal: outcome.signal });
  return { type: "error", message: failure };
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

async function* noStdout(terminate: () => NodeJS.Signals): AsyncGenerator<AgentEvent> {
  terminate();
  yield { type: "error", message: "pi JSON process has no stdout stream" };
}
