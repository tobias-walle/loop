import type { LoopRuntimeConfig } from "../lib/config/index.js";
import { ConfigError, loadLoopConfig } from "../lib/config/index.js";
import { type StoredInvocation, appendSessionEvent, createEvent } from "../lib/session-events.js";
import { invalidateSessionLock } from "../lib/session-lock.js";
import {
  type SessionOverview,
  discoverSessions,
  loadSession,
  loadSessionHistory,
} from "../lib/session-store.js";
import { createLoopTUI } from "../tui/loop-tui.js";
import { executeSession } from "./execute-session.js";

export interface ResumeCommandIO {
  writeError(message: string): void;
}

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

export async function resumeCommand(io: ResumeCommandIO): Promise<number> {
  const sessions = discoverSessions(process.env, process.cwd());
  let activeInterrupt: (() => void) | undefined;
  let settled = false;
  let resolveResult: (code: number) => void = () => {};

  const result = new Promise<number>((resolve) => {
    resolveResult = resolve;
  });
  const finish = (code: number): void => {
    if (settled) return;
    settled = true;
    resolveResult(code);
  };

  const tui = createLoopTUI({
    onInterrupt: () => {
      if (activeInterrupt) activeInterrupt();
      else {
        tui.stop();
        finish(130);
      }
    },
    sessionBrowser: {
      sessions,
      loadDetail: loadSessionHistory,
      onResume: (session) => {
        void continueSession(session);
      },
      onDeleteLock: (session) => {
        try {
          const ownerId = session.lock.lock?.ownerId;
          if (!ownerId) throw new Error("The lock has no valid owner.");
          invalidateSessionLock(session.sessionDir, ownerId, (invalidatedOwner) => {
            appendSessionEvent(
              session.sessionDir,
              createEvent("lock_invalidated", { ownerId: invalidatedOwner }),
            );
          });
          const refreshed = discoverSessions(process.env, process.cwd()).find(
            (candidate) => candidate.sessionDir === session.sessionDir,
          );
          if (refreshed) Object.assign(session, refreshed);
        } catch (error) {
          io.writeError(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      onExit: () => {
        tui.stop();
        finish(0);
      },
    },
  });

  async function continueSession(session: SessionOverview): Promise<void> {
    if (settled) return;
    const loaded = loadSession(session.sessionDir);
    const invocation = loaded.aggregate.invocation;
    if (!(invocation && loaded.aggregate.resumable)) {
      io.writeError("Error: This session is no longer resumable.");
      return;
    }
    if (!invocation.projectRoot) {
      io.writeError("Error: The stored project path is missing.");
      return;
    }

    let current: LoopRuntimeConfig;
    try {
      current = loadLoopConfig({ cwd: invocation.projectRoot }).config;
    } catch (error) {
      if (error instanceof ConfigError) {
        io.writeError(`Error: ${error.message}`);
        return;
      }
      throw error;
    }

    try {
      const exitCode = await executeSession({
        config: {
          steps: invocation.steps,
          agent: invocation.agent.name,
          passthroughArgs: invocation.agent.passthroughArgs,
        },
        runtimeConfig: buildResumeRuntimeConfig(invocation, current),
        template: {
          source: invocation.template.source,
          template: invocation.template.content,
        },
        projectRoot: invocation.projectRoot,
        resumeSession: loaded,
        tui,
        registerInterrupt: (handler) => {
          activeInterrupt = handler;
        },
      });
      finish(exitCode);
    } catch (error) {
      tui.stop();
      io.writeError(`Error: ${error instanceof Error ? error.message : String(error)}`);
      finish(1);
    }
  }

  tui.start();
  return result;
}
