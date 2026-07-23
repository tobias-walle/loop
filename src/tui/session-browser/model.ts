import type { SessionEvent, StoredInvocation } from "../../lib/session-event.js";
import type { SessionOverview } from "../../lib/session-store.js";

export type SessionBrowserDetail = {
  warnings: string[];
  events?: SessionEvent[];
  invocation?: StoredInvocation;
  lines?: string[];
};

export type HistoryViewport = {
  anchorEventId?: string;
  lineOffset: number;
  follow: boolean;
};

export type BrowserModel = {
  mode: "overview" | "detail";
  sessions: SessionOverview[];
  selectedIndex: number;
  detail?: {
    session: SessionOverview;
    content: SessionBrowserDetail;
    viewport: HistoryViewport;
    confirmDelete: boolean;
  };
};

export type BrowserResult =
  | { type: "resume"; session: SessionOverview }
  | { type: "exit"; exitCode: number };

export type BrowserAction =
  | { type: "up" }
  | { type: "down" }
  | { type: "pageUp"; lines?: number }
  | { type: "pageDown"; lines?: number }
  | { type: "first" }
  | { type: "last" }
  | { type: "open" }
  | { type: "back" }
  | { type: "resume" }
  | { type: "requestDelete" }
  | { type: "confirmDelete" }
  | { type: "cancelDelete" }
  | { type: "exit" };

export type BrowserEffect =
  | { type: "loadDetail"; session: SessionOverview }
  | { type: "deleteLock"; session: SessionOverview }
  | { type: "complete"; result: BrowserResult };

export function createBrowserModel(sessions: SessionOverview[]): BrowserModel {
  return { mode: "overview", sessions, selectedIndex: 0 };
}

export function withBrowserDetail(
  model: BrowserModel,
  content: SessionBrowserDetail,
): BrowserModel {
  if (!model.detail) return model;
  return { ...model, detail: { ...model.detail, content } };
}

export function replaceBrowserSession(model: BrowserModel, session: SessionOverview): BrowserModel {
  const sessions = model.sessions.map((item) =>
    item.sessionDir === session.sessionDir ? session : item,
  );
  return {
    ...model,
    sessions,
    ...(model.detail ? { detail: { ...model.detail, session } } : {}),
  };
}

export function updateBrowser(
  model: BrowserModel,
  action: BrowserAction,
): { model: BrowserModel; effect?: BrowserEffect } {
  if (model.mode === "overview") return updateOverview(model, action);
  return updateDetail(model, action);
}

function updateOverview(
  model: BrowserModel,
  action: BrowserAction,
): { model: BrowserModel; effect?: BrowserEffect } {
  const lastIndex = Math.max(0, model.sessions.length - 1);
  if (action.type === "up")
    return { model: { ...model, selectedIndex: Math.max(0, model.selectedIndex - 1) } };
  if (action.type === "down")
    return { model: { ...model, selectedIndex: Math.min(lastIndex, model.selectedIndex + 1) } };
  if (action.type === "first") return { model: { ...model, selectedIndex: 0 } };
  if (action.type === "last") return { model: { ...model, selectedIndex: lastIndex } };
  if (action.type === "open") {
    const session = model.sessions[model.selectedIndex];
    if (!session) return { model };
    const next: BrowserModel = {
      ...model,
      mode: "detail",
      detail: {
        session,
        content: { warnings: [] },
        viewport: { lineOffset: 0, follow: false },
        confirmDelete: false,
      },
    };
    return { model: next, effect: { type: "loadDetail", session } };
  }
  if (action.type === "exit" || action.type === "back")
    return { model, effect: { type: "complete", result: { type: "exit", exitCode: 0 } } };
  return { model };
}

function updateDetail(
  model: BrowserModel,
  action: BrowserAction,
): { model: BrowserModel; effect?: BrowserEffect } {
  const detail = model.detail;
  if (!detail) return { model: { ...model, mode: "overview" } };
  const viewport = detail.viewport;
  const move = (delta: number): BrowserModel => ({
    ...model,
    detail: {
      ...detail,
      viewport: {
        ...viewport,
        lineOffset: viewport.lineOffset + delta,
        follow: false,
      },
    },
  });
  if (action.type === "up") return { model: move(-1) };
  if (action.type === "down") return { model: move(1) };
  if (action.type === "pageUp") return { model: move(-(action.lines ?? 10)) };
  if (action.type === "pageDown") return { model: move(action.lines ?? 10) };
  if (action.type === "first")
    return {
      model: { ...model, detail: { ...detail, viewport: { lineOffset: 0, follow: false } } },
    };
  if (action.type === "last")
    return { model: { ...model, detail: { ...detail, viewport: { ...viewport, follow: true } } } };
  if (action.type === "back" || action.type === "exit")
    return { model: { ...model, mode: "overview", detail: undefined } };
  if (action.type === "resume" && detail.session.canResume)
    return {
      model,
      effect: { type: "complete", result: { type: "resume", session: detail.session } },
    };
  if (action.type === "requestDelete")
    return { model: { ...model, detail: { ...detail, confirmDelete: true } } };
  if (action.type === "cancelDelete")
    return { model: { ...model, detail: { ...detail, confirmDelete: false } } };
  if (action.type === "confirmDelete")
    return {
      model: { ...model, detail: { ...detail, confirmDelete: false } },
      effect: { type: "deleteLock", session: detail.session },
    };
  return { model };
}
