import { type Component, Key, matchesKey } from "@mariozechner/pi-tui";
import type { SessionHistory, SessionOverview } from "../../lib/session-store.js";
import {
  type TerminalSession,
  type TerminalSessionOptions,
  openTerminalSession,
} from "../terminal-session.js";
import {
  type BrowserAction,
  type BrowserEffect,
  type BrowserModel,
  type BrowserResult,
  createBrowserModel,
  replaceBrowserSession,
  updateBrowser,
  withBrowserDetail,
} from "./model.js";
import { renderBrowser, stabilizeBrowserViewport } from "./view.js";

export type { BrowserResult, SessionBrowserDetail } from "./model.js";

export type BrowseSessionsOptions = {
  sessions: SessionOverview[];
  loadDetail(session: SessionOverview): SessionHistory;
  deleteLock(session: SessionOverview): SessionOverview | undefined;
  signal?: AbortSignal;
  terminal?: TerminalSessionOptions;
  openTerminal?: (options?: TerminalSessionOptions) => TerminalSession;
};

export async function browseSessions(options: BrowseSessionsOptions): Promise<BrowserResult> {
  using terminalSession = (options.openTerminal ?? openTerminalSession)(options.terminal);
  return await runBrowser(terminalSession, options);
}

async function runBrowser(
  terminalSession: TerminalSession,
  options: BrowseSessionsOptions,
): Promise<BrowserResult> {
  let model = createBrowserModel(options.sessions);
  let settled = false;
  let resolveResult: (result: BrowserResult) => void = () => {};
  const result = new Promise<BrowserResult>((resolve) => {
    resolveResult = resolve;
  });
  const complete = (value: BrowserResult): void => {
    if (settled) return;
    settled = true;
    resolveResult(value);
  };
  const execute = (effect: BrowserEffect | undefined): void => {
    if (!effect) return;
    if (effect.type === "complete") complete(effect.result);
    else if (effect.type === "loadDetail") {
      try {
        model = withBrowserDetail(model, options.loadDetail(effect.session));
      } catch (error) {
        model = withBrowserDetail(model, {
          warnings: [
            `Could not load session: ${error instanceof Error ? error.message : String(error)}`,
          ],
        });
      }
    } else if (effect.type === "deleteLock") {
      try {
        const refreshed = options.deleteLock(effect.session);
        if (refreshed) model = replaceBrowserSession(model, refreshed);
      } catch (error) {
        model = withBrowserDetail(model, {
          ...model.detail?.content,
          warnings: [
            ...(model.detail?.content.warnings ?? []),
            `Could not delete lock: ${error instanceof Error ? error.message : String(error)}`,
          ],
        });
      }
    }
  };
  const dimensions = () => ({
    columns: terminalSession.terminal.columns,
    rows: terminalSession.terminal.rows,
  });
  const dispatch = (action: BrowserAction): void => {
    model = stabilizeBrowserViewport(model, dimensions());
    const transition = updateBrowser(model, action);
    model = stabilizeBrowserViewport(transition.model, dimensions());
    execute(transition.effect);
    terminalSession.tui.requestRender();
  };
  const component: Component = {
    render(width) {
      return renderBrowser(model, { columns: width, rows: terminalSession.terminal.rows });
    },
    handleInput(data) {
      if (data === "\u0003") {
        complete({ type: "exit", exitCode: 130 });
        return;
      }
      const action = inputAction(data, model, terminalSession.terminal.rows);
      if (action) dispatch(action);
    },
    invalidate() {},
  };
  terminalSession.tui.addChild(component);
  terminalSession.tui.setFocus(component);
  terminalSession.tui.requestRender();

  const abort = (): void => complete({ type: "exit", exitCode: 130 });
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  try {
    return await result;
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
}

function inputAction(data: string, model: BrowserModel, rows: number): BrowserAction | undefined {
  if (model.detail?.confirmDelete) {
    if (data.toLowerCase() === "y") return { type: "confirmDelete" };
    if (data.toLowerCase() === "n" || matchesKey(data, Key.escape)) return { type: "cancelDelete" };
    return undefined;
  }
  if (matchesKey(data, Key.up) || matchesKey(data, "k")) return { type: "up" };
  if (matchesKey(data, Key.down) || matchesKey(data, "j")) return { type: "down" };
  const pageLines = Math.max(1, rows - 2);
  const halfPageLines = Math.max(1, Math.floor(pageLines / 2));
  if (matchesKey(data, Key.pageUp)) return { type: "pageUp", lines: pageLines };
  if (matchesKey(data, Key.pageDown)) return { type: "pageDown", lines: pageLines };
  if (matchesKey(data, "ctrl+u") || matchesKey(data, "u"))
    return { type: "pageUp", lines: halfPageLines };
  if (matchesKey(data, "ctrl+d") || matchesKey(data, "d"))
    return { type: "pageDown", lines: halfPageLines };
  if (matchesKey(data, Key.home) || matchesKey(data, "g")) return { type: "first" };
  if (matchesKey(data, Key.end) || matchesKey(data, "shift+g")) return { type: "last" };
  if (matchesKey(data, Key.enter) || (model.mode === "overview" && matchesKey(data, "l")))
    return model.mode === "overview" ? { type: "open" } : { type: "resume" };
  if (matchesKey(data, "shift+d") && model.mode === "detail") return { type: "requestDelete" };
  if (matchesKey(data, Key.escape) || matchesKey(data, "q") || matchesKey(data, "h"))
    return model.mode === "overview" ? { type: "exit" } : { type: "back" };
  return undefined;
}
