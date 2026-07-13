import { type Component, Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { bold, boldCyan, boldRed, cyan, dim, dimGray, green, yellow } from "../lib/ansi.js";
import type { SessionEvent, StoredInvocation } from "../lib/session-events.js";
import type { SessionOverview } from "../lib/session-store.js";

export type SessionBrowserDetail = {
  warnings: string[];
  events?: SessionEvent[];
  invocation?: StoredInvocation;
  lines?: string[];
};

export type SessionBrowserOptions = {
  sessions: SessionOverview[];
  loadDetail(session: SessionOverview): SessionBrowserDetail;
  history: {
    replay(detail: SessionBrowserDetail): void;
    render(width: number): string[];
    reset(): void;
  };
  onResume(session: SessionOverview): void;
  onDeleteLock(session: SessionOverview): void;
  onExit(): void;
};

export function createSessionBrowser(options: SessionBrowserOptions): Component {
  let selectedIndex = 0;
  let selected: SessionOverview | undefined;
  let detail: SessionBrowserDetail | undefined;
  let scroll = 0;
  let scrollToEnd = false;
  let confirmDelete = false;

  return {
    render(width: number): string[] {
      const lines = selected
        ? renderDetail(
            selected,
            detail ?? { warnings: [] },
            confirmDelete,
            detail?.lines ?? options.history.render(width),
          )
        : renderOverview(options.sessions, selectedIndex);
      if (scrollToEnd) {
        scroll = Math.max(0, lines.length - 20);
        scrollToEnd = false;
      }
      scroll = Math.min(scroll, Math.max(0, lines.length - 1));
      return lines.slice(scroll).map((line) => truncateToWidth(line, width, "", true));
    },

    handleInput(data: string): void {
      if (confirmDelete) {
        if (data.toLowerCase() === "y") {
          confirmDelete = false;
          if (selected) options.onDeleteLock(selected);
        } else if (data.toLowerCase() === "n" || matchesKey(data, Key.escape)) {
          confirmDelete = false;
        }
        return;
      }

      if (!selected) {
        if (matchesKey(data, Key.up) || matchesKey(data, "k"))
          selectedIndex = Math.max(0, selectedIndex - 1);
        else if (matchesKey(data, Key.down) || matchesKey(data, "j"))
          selectedIndex = Math.min(options.sessions.length - 1, selectedIndex + 1);
        else if (matchesKey(data, "g")) selectedIndex = 0;
        else if (matchesKey(data, "shift+g"))
          selectedIndex = Math.max(0, options.sessions.length - 1);
        else if (
          (matchesKey(data, Key.enter) || matchesKey(data, "l")) &&
          options.sessions[selectedIndex]
        ) {
          selected = options.sessions[selectedIndex];
          detail = options.loadDetail(selected);
          options.history.replay(detail);
          scroll = 0;
        } else if (matchesKey(data, Key.escape) || matchesKey(data, "q")) options.onExit();
        return;
      }

      if (matchesKey(data, Key.escape) || matchesKey(data, "q") || matchesKey(data, "h")) {
        selected = undefined;
        detail = undefined;
        options.history.reset();
        scroll = 0;
      } else if (matchesKey(data, Key.enter)) {
        if (selected.canResume) options.onResume(selected);
      } else if (matchesKey(data, "shift+d") && selected.lock.health !== "unlocked") {
        confirmDelete = true;
      } else if (matchesKey(data, Key.up) || matchesKey(data, "k"))
        scroll = Math.max(0, scroll - 1);
      else if (matchesKey(data, Key.down) || matchesKey(data, "j")) scroll++;
      else if (matchesKey(data, Key.pageUp) || matchesKey(data, "ctrl+u"))
        scroll = Math.max(0, scroll - 10);
      else if (matchesKey(data, Key.pageDown) || matchesKey(data, "ctrl+d")) scroll += 10;
      else if (matchesKey(data, Key.home) || matchesKey(data, "g")) scroll = 0;
      else if (matchesKey(data, Key.end) || matchesKey(data, "shift+g")) scrollToEnd = true;
    },

    invalidate(): void {},
  };
}

function renderOverview(sessions: SessionOverview[], selectedIndex: number): string[] {
  const lines = [boldCyan("[resume]"), bold("Resume a session"), ""];
  if (sessions.length === 0) {
    return [...lines, dim("No sessions found."), "", footer("q/Esc exit")];
  }
  sessions.forEach((session, index) => {
    const selected = index === selectedIndex;
    const cursor = selected ? cyan("›") : " ";
    const project = session.projectRoot?.split(/[\\/]/).filter(Boolean).at(-1) ?? "unknown project";
    const title = selected ? bold(session.title) : session.title;
    lines.push(
      `${cursor} ${title} ${dim(`· ${project} · ${formatDate(session.updatedAt)}`)}`,
      `  ${statusLabel(session.status)} ${dim("·")} ${progress(session)}${session.agent ? ` ${dim("·")} ${cyan(session.agent)}` : ""} ${dim("·")} ${green(`$${session.totals.totalCostUsd.toFixed(2)}`)} ${dim("·")} ${session.canResume ? green("resumable") : dim("history only")}`,
      "",
    );
  });
  lines.push(footer("j/k select · g/G first/last · Enter/l inspect · q/Esc exit"));
  return lines;
}

function renderDetail(
  session: SessionOverview,
  detail: SessionBrowserDetail,
  confirmDelete: boolean,
  historyLines: string[],
): string[] {
  const lines = [...historyLines];
  if (historyLines.length === 0) lines.push(dim("No agent output was recorded."));
  if (session.disabledReason) lines.push("", boldRed(`Cannot resume: ${session.disabledReason}`));
  for (const warning of detail.warnings) lines.push("", yellow(`▲ ${warning}`));
  lines.push(
    "",
    footer(
      `j/k scroll · Ctrl+u/d page · g/G top/bottom · ${session.canResume ? "Enter resume · " : ""}q/h/Esc back${session.lock.health !== "unlocked" ? " · D delete lock" : ""}`,
    ),
  );
  if (confirmDelete) {
    lines.push(
      "",
      boldRed("Delete this session lock? This can allow concurrent writers and corrupt progress."),
      session.lock.health === "active"
        ? boldRed("WARNING: The owning Loop process appears active.")
        : "",
      yellow("Press y to delete or n to cancel."),
    );
  }
  return lines;
}

function statusLabel(status: SessionOverview["status"]): string {
  switch (status) {
    case "completed":
      return green("✓ completed");
    case "running":
      return cyan("● running");
    case "aborted":
      return yellow("▲ aborted");
    case "failed":
    case "corrupt":
      return boldRed(`✕ ${status}`);
    default:
      return dim(status);
  }
}

function footer(text: string): string {
  return `${dimGray("─")} ${dim(text)}`;
}

function progress(session: SessionOverview): string {
  return session.totalSteps === undefined
    ? `${session.completedSteps} completed steps`
    : `${session.completedSteps}/${session.totalSteps} steps`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toISOString().replace("T", " ").slice(0, 16);
}
