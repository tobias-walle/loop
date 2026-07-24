import { describe, expect, test } from "bun:test";
import { type Component, visibleWidth } from "@mariozechner/pi-tui";
import { dim } from "../lib/ansi.js";
import { PipeBox } from "./components/pipe-box.js";

const overflowingChild: Component = {
  invalidate() {},
  render: () => ["child output that exceeds the available width"],
};

function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching control chars
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("PipeBox", () => {
  test("keeps agents without nested output on one compact row", () => {
    const box = new PipeBox();
    box.setHeader("agent  Review code");

    expect(box.render(80)).toHaveLength(1);
    expect(stripAnsi(box.render(80)[0])).toContain("◈ agent  Review code · running");

    box.setFooter(dim("✓ done"));

    expect(box.render(80)).toHaveLength(1);
    expect(stripAnsi(box.render(80)[0])).toContain("◈ agent  Review code · ✓ done");
  });

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
