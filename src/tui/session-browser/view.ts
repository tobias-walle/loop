import { truncateToWidth } from "@mariozechner/pi-tui";
import { bold, boldCyan, boldRed, cyan, dim, green, yellow } from "../../lib/ansi.js";
import type { SessionOverview } from "../../lib/session-store.js";
import type { BrowserModel } from "./model.js";
import { renderTimeline } from "./timeline.js";

export type BrowserDimensions = { columns: number; rows: number };

export function stabilizeBrowserViewport(
  model: BrowserModel,
  dimensions: BrowserDimensions,
): BrowserModel {
  const detail = model.detail;
  if (!detail || detail.viewport.follow) return model;
  const flattened = flattenTimeline(model, Math.max(1, dimensions.columns));
  if (flattened.length === 0) return model;
  const start = resolveStart(model, flattened, Math.max(0, dimensions.rows - 2));
  const anchor = flattened[start];
  if (!anchor) return model;
  return {
    ...model,
    detail: {
      ...detail,
      viewport: {
        anchorEventId: anchor.eventId,
        lineOffset: anchor.index,
        follow: false,
      },
    },
  };
}

export function renderBrowser(model: BrowserModel, dimensions: BrowserDimensions): string[] {
  const columns = Math.max(1, dimensions.columns);
  const rows = Math.max(1, dimensions.rows);
  const content =
    model.mode === "detail" ? renderDetail(model, columns, rows) : renderOverview(model, rows);
  const footer = content.at(-1) ?? "";
  const body = content.slice(0, -1).slice(0, Math.max(0, rows - 1));
  const clipped = body.map((line) => clip(line, columns));
  while (clipped.length < Math.max(0, rows - 1)) clipped.push("");
  if (rows > 0) clipped.push(clip(footer, columns));
  return clipped;
}

function renderOverview(model: BrowserModel, rows: number): string[] {
  const footer = dim("j/k select · Enter inspect · q/Esc exit");
  if (model.sessions.length === 0)
    return [boldCyan("Resume a session"), dim("No sessions found."), footer];
  const visibleSessions = Math.max(1, Math.floor((Math.max(0, rows - 2) + 1) / 3));
  const start = Math.min(
    Math.max(0, model.selectedIndex - visibleSessions + 1),
    Math.max(0, model.sessions.length - visibleSessions),
  );
  const visible = model.sessions.slice(start, start + visibleSessions);
  return [
    boldCyan("Resume a session"),
    ...visible.flatMap((session, offset) => {
      const index = start + offset;
      const selected = index === model.selectedIndex;
      const separator = dim(" · ");
      const lines = [
        `${selected ? cyan(">") : " "} ${selected ? bold(session.title) : session.title}`,
        `  ${formatSessionStatus(session)}${separator}${cyan(`${session.completedSteps}/${session.totalSteps ?? "?"} steps`)}${session.canResume ? `${separator}${yellow("resumable")}` : ""}`,
      ];
      if (offset < visible.length - 1) lines.push("");
      return lines;
    }),
    footer,
  ];
}

function renderDetail(model: BrowserModel, columns: number, rows: number): string[] {
  const detail = model.detail;
  if (!detail) return ["Session unavailable", "q back"];
  const footer = detail.confirmDelete
    ? yellow("Delete lock? y confirm · n/Esc cancel")
    : dim(
        `q/h/Esc back · j/k line · u/d half page · PgUp/PgDn page${detail.session.canResume ? " · Enter resume" : ""}`,
      );
  const historyRows = Math.max(0, rows - 2);
  const flattened = flattenTimeline(model, columns);
  const start = resolveStart(model, flattened, historyRows);
  const history = flattened.slice(start, start + historyRows).map((item) => item.line);
  while (history.length < historyRows) history.push("");
  const warnings = detail.content.warnings.join(" · ");
  const title = warnings
    ? `${boldCyan(detail.session.title)}${dim(" · ")}${yellow(warnings)}`
    : boldCyan(detail.session.title);
  return [title, ...history, footer];
}

function flattenTimeline(model: BrowserModel, columns: number) {
  const blocks = model.detail ? renderTimeline(model.detail.content, columns) : [];
  return blocks.flatMap((block) =>
    block.lines.map((line, index) => ({ eventId: block.eventId, index, line })),
  );
}

function resolveStart(
  model: BrowserModel,
  flattened: ReturnType<typeof flattenTimeline>,
  historyRows: number,
): number {
  const viewport = model.detail?.viewport;
  if (!viewport) return 0;
  let start = viewport.lineOffset;
  if (viewport.anchorEventId) {
    const anchor = flattened.findIndex((line) => line.eventId === viewport.anchorEventId);
    if (anchor >= 0) start = anchor + viewport.lineOffset;
  }
  if (viewport.follow) start = Math.max(0, flattened.length - historyRows);
  return Math.min(Math.max(0, start), Math.max(0, flattened.length - historyRows));
}

function formatSessionStatus(session: SessionOverview): string {
  switch (session.status) {
    case "completed":
      return green("completed");
    case "failed":
    case "corrupt":
      return boldRed(session.status);
    case "aborted":
      return yellow("aborted");
    case "running":
      return cyan("running");
    case "legacy":
      return dim("legacy");
  }
}

function clip(text: string, width: number): string {
  return truncateToWidth(text, width, "");
}
