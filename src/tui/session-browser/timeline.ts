import { RunEventProjector } from "../run-event-projector.js";
import type { SessionBrowserDetail } from "./model.js";

export type TimelineBlock = {
  eventId: string;
  lines: string[];
};

export function renderTimeline(detail: SessionBrowserDetail, width: number): TimelineBlock[] {
  const safeWidth = Math.max(1, width);
  if (detail.lines) {
    return detail.lines.map((line, index) => ({
      eventId: `legacy-${index}`,
      lines: wrap(line, safeWidth),
    }));
  }
  const events = detail.events ?? [];
  if (events.length === 0) return [];

  const projector = new RunEventProjector(() => {});
  projector.replay(events);
  const lines = projector.render(safeWidth);
  return lines.length > 0 ? [{ eventId: events[0].id, lines }] : [];
}

function wrap(text: string, width: number): string[] {
  if (text.length === 0) return [""];
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > width) {
    const candidate = remaining.slice(0, width + 1);
    const breakAt = candidate.lastIndexOf(" ");
    if (breakAt > 0) {
      lines.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt + 1);
    } else {
      lines.push(remaining.slice(0, width));
      remaining = remaining.slice(width);
    }
  }
  lines.push(remaining);
  return lines;
}
