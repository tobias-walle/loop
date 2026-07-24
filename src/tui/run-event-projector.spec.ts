import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { visibleWidth } from "@mariozechner/pi-tui";
import type { SessionEvent } from "../lib/session-event.js";
import { RunEventProjector } from "./run-event-projector.js";

const FIXTURE_URL = new URL("../testing/fixtures/complex-session/events.jsonl", import.meta.url);
const WIDTHS = [120, 86, 40, 12, 1];

function loadFixture(): SessionEvent[] {
  return readFileSync(FIXTURE_URL, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as SessionEvent);
}

test("complex sessions honor the render width after every event", () => {
  const events = loadFixture();

  for (let eventCount = 1; eventCount <= events.length; eventCount++) {
    const projector = new RunEventProjector(() => {});
    projector.replay(events.slice(0, eventCount));

    for (const width of WIDTHS) {
      const overflowing = projector
        .render(width)
        .map((line, index) => ({ index, width: visibleWidth(line) }))
        .filter((line) => line.width > width);
      expect(overflowing, `event ${eventCount}, terminal width ${width}`).toEqual([]);
    }

    projector.finishActiveSession();
  }
});
