import type { Component } from "@mariozechner/pi-tui";
import { dim, magenta } from "../../lib/ansi.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_INTERVAL = 120;
const MAX_LINE_LEN = 2 + "thinking".length;

export class ThinkingIndicator implements Component {
  private text = "waiting";
  private startTime = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private requestRender: () => void;
  private cachedLine: string | null = null;
  private cachedFrame = -1;

  constructor(requestRender: () => void) {
    this.requestRender = requestRender;
  }

  setText(text: string): void {
    this.text = normalizeState(text);
    this.cachedLine = null;
  }

  start(): void {
    this.startTime = Date.now();
    this.intervalId = setInterval(() => {
      this.cachedLine = null;
      this.requestRender();
    }, FRAME_INTERVAL);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  invalidate(): void {
    this.cachedLine = null;
  }

  render(width: number): string[] {
    const elapsed = Date.now() - this.startTime;
    const frame = Math.floor(elapsed / FRAME_INTERVAL) % FRAMES.length;
    if (this.cachedLine != null && this.cachedFrame === frame) {
      return [this.cachedLine];
    }

    const spinner = magenta(FRAMES[frame]);
    const line = `${spinner} ${dim(this.text)}`;
    const pad = Math.max(0, width - MAX_LINE_LEN);
    const out = `${line}${" ".repeat(pad)}`;

    this.cachedLine = out;
    this.cachedFrame = frame;
    return [out];
  }
}

function normalizeState(text: string): string {
  const normalized = text.toLowerCase().replace(/\.+$/, "").trim();
  if (normalized === "thinking") return "thinking";
  if (normalized === "waiting") return "waiting";
  return normalized || "waiting";
}
