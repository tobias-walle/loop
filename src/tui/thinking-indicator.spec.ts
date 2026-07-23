import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import { ThinkingIndicator } from "./components/thinking-indicator.js";

describe("ThinkingIndicator", () => {
  test("constrains every render to the available width", () => {
    const indicator = new ThinkingIndicator(() => {});
    indicator.setText("thinking");

    expect(visibleWidth(indicator.render(86)[0])).toBeLessThanOrEqual(86);
    expect(visibleWidth(indicator.render(1)[0])).toBeLessThanOrEqual(1);
  });
});
