import { describe, expect, test } from "bun:test";
import { type Component, visibleWidth } from "@mariozechner/pi-tui";
import { PipeBox } from "./components/pipe-box.js";

const overflowingChild: Component = {
  invalidate() {},
  render: () => ["child output that exceeds the available width"],
};

describe("PipeBox", () => {
  test("constrains every rendered line to the available width", () => {
    const box = new PipeBox();
    box.setHeader("agent header that exceeds the available width");
    box.addChild(overflowingChild);
    box.setFooter("agent footer that exceeds the available width");

    const width = 12;
    const lines = box.render(width);

    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });
});
