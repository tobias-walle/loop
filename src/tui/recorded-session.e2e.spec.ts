import { expect, test } from "bun:test";
import * as path from "node:path";
import { TUI, type Terminal, visibleWidth } from "@mariozechner/pi-tui";
import { loadSession } from "../lib/session-store.js";
import { StatusBar } from "./components/status-bar.js";
import { createRunView } from "./run-view.js";
import { replaySession } from "./session-replay.js";

const FIXTURE_DIR = path.join(import.meta.dir, "../testing/fixtures/tui-complex-session");
const WIDTHS = [120, 93, 86, 40, 12];

class TestTerminal implements Terminal {
  columns = WIDTHS[0];
  rows = 40;
  kittyProtocolActive = false;

  start(): void {}
  stop(): void {}
  drainInput(): Promise<void> {
    return Promise.resolve();
  }
  write(): void {}
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
}

test("recorded complex session stays within the terminal during incremental replay and resize", () => {
  const session = loadSession(FIXTURE_DIR);
  const invocation = session.aggregate.invocation;
  expect(invocation).toBeDefined();
  if (!invocation) return;

  for (let eventCount = 1; eventCount <= session.events.length; eventCount++) {
    const view = createRunView(() => {});
    const statusBar = new StatusBar();
    statusBar.setStatus({
      durationMs: 227_000,
      costUsd: 0.69,
      usage: {
        inputTokens: 60_000,
        outputTokens: 5_800,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
    });
    replaySession(view, session.events.slice(0, eventCount), invocation);

    const terminal = new TestTerminal();
    const tui = new TUI(terminal);
    tui.addChild(view.content);
    tui.addChild(statusBar);

    try {
      for (const width of WIDTHS) {
        const overflow = view
          .render(width)
          .map((line, index) => ({ index, width: visibleWidth(line) }))
          .filter((line) => line.width > width);
        if (overflow.length > 0) {
          throw new Error(
            `Fixture overflow after event ${eventCount} at terminal width ${width}: ${JSON.stringify(overflow)}`,
          );
        }

        terminal.columns = width;
        (tui as unknown as { doRender(): void }).doRender();
      }
    } finally {
      view.router.finishActiveSession();
      tui.stop();
    }
  }
});
