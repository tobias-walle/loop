import type { LoopRuntimeConfig } from "../lib/config/index.js";
import { ConfigError, loadLoopConfig } from "../lib/config/index.js";
import { createEvent, type StoredInvocation } from "../lib/session-event.js";
import { appendSessionEvent } from "../lib/session-event-store.js";
import { invalidateSessionLock } from "../lib/session-lock.js";
import {
  discoverSessions,
  loadSession,
  loadSessionHistory,
  type SessionOverview,
} from "../lib/session-store.js";
import type { RunOutput } from "../output/run-reporter.js";
import { browseSessions } from "../tui/session-browser/index.js";
import { executeSession } from "./execute-session.js";
import { createRunReporter } from "./run-reporter.js";

export interface ResumeCommandIO {
  stdout: RunOutput;
  signal?: AbortSignal;
  writeError(message: string): void;
}

type ResumeDependencies = {
  browseSessions: typeof browseSessions;
  executeSession: typeof executeSession;
};

const defaultDependencies: ResumeDependencies = { browseSessions, executeSession };

export function buildResumeRuntimeConfig(
  invocation: StoredInvocation,
  current: LoopRuntimeConfig,
): LoopRuntimeConfig {
  const name = invocation.agent.name;
  return {
    ...current,
    agent: name,
    agents: {
      ...current.agents,
      [name]: {
        ...current.agents[name],
        command: invocation.agent.command,
        model: invocation.agent.model,
        args: { ...invocation.agent.args },
        env: { ...current.agents[name].env },
      },
    },
  };
}

export async function resumeCommand(
  io: ResumeCommandIO,
  dependencies: ResumeDependencies = defaultDependencies,
): Promise<number> {
  const cwd = process.cwd();
  const choice = await dependencies.browseSessions({
    sessions: discoverSessions(process.env, cwd),
    loadDetail: loadSessionHistory,
    signal: io.signal,
    deleteLock: (session) => deleteSessionLock(session, cwd),
  });
  if (choice.type === "exit") return choice.exitCode;

  const loaded = loadSession(choice.session.sessionDir);
  const invocation = loaded.aggregate.invocation;
  if (!(invocation && loaded.aggregate.resumable)) {
    io.writeError("Error: This session is no longer resumable.");
    return 1;
  }
  if (!invocation.projectRoot) {
    io.writeError("Error: The stored project path is missing.");
    return 1;
  }

  let current: LoopRuntimeConfig;
  try {
    current = loadLoopConfig({ cwd: invocation.projectRoot }).config;
  } catch (error) {
    if (error instanceof ConfigError) {
      io.writeError(`Error: ${error.message}`);
      return 1;
    }
    throw error;
  }

  await using reporter = createRunReporter(io.stdout);
  try {
    return await dependencies.executeSession({
      config: {
        steps: invocation.steps,
        agent: invocation.agent.name,
        passthroughArgs: invocation.agent.passthroughArgs,
      },
      runtimeConfig: buildResumeRuntimeConfig(invocation, current),
      template: { source: invocation.template.source, template: invocation.template.content },
      projectRoot: invocation.projectRoot,
      resumeSession: loaded,
      reporter,
      signal: io.signal,
    });
  } catch (error) {
    io.writeError(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function deleteSessionLock(session: SessionOverview, cwd: string): SessionOverview | undefined {
  const ownerId = session.lock.lock?.ownerId;
  if (!ownerId) throw new Error("The lock has no valid owner.");
  invalidateSessionLock(session.sessionDir, ownerId, (invalidatedOwner) => {
    appendSessionEvent(
      session.sessionDir,
      createEvent("lock_invalidated", { ownerId: invalidatedOwner }),
    );
  });
  return discoverSessions(process.env, cwd).find(
    (candidate) => candidate.sessionDir === session.sessionDir,
  );
}
