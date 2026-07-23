import { describe, expect, test } from "bun:test";
import { createProcessRunOutput } from "./process-run-output.js";

class Stream {
  isTTY: boolean | undefined = true;
  columns = 120;
  rows = 40;
  text = "";
  listeners = new Set<() => void>();

  write(text: string): void {
    this.text += text;
  }

  on(_event: "resize", listener: () => void): void {
    this.listeners.add(listener);
  }

  off(_event: "resize", listener: () => void): void {
    this.listeners.delete(listener);
  }
}

describe("process run output", () => {
  test("forwards terminal dimensions, writes, and resize ownership", () => {
    const stream = new Stream();
    const output = createProcessRunOutput(stream);
    const resize = () => {};

    output.write("hello");
    output.on?.("resize", resize);
    stream.columns = 80;
    stream.rows = 24;

    expect(stream.text).toBe("hello");
    expect(output.columns).toBe(80);
    expect(output.rows).toBe(24);
    expect(stream.listeners.has(resize)).toBe(true);

    output.off?.("resize", resize);
    expect(stream.listeners.size).toBe(0);
  });

  test("normalizes missing TTY support to false", () => {
    const stream = new Stream();
    stream.isTTY = undefined;
    expect(createProcessRunOutput(stream).isTTY).toBe(false);
  });
});
