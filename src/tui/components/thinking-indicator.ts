import { type Component, truncateToWidth } from "@mariozechner/pi-tui";
import { dim, magenta } from "../../lib/ansi.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_INTERVAL = 120;

export class ThinkingIndicator implements Component {
  private text = "waiting";
  private startTime = 0;

  constructor(private readonly requestRender: () => void) {}

  setText(text: string): void {
    this.text = normalizeState(text);
  }

  start(): void {
    this.startTime = Date.now();
    this.requestRender();
  }

  stop(): void {}

  invalidate(): void {}

  render(width: number): string[] {
    const elapsed = Date.now() - this.startTime;
    const frame = Math.floor(elapsed / FRAME_INTERVAL) % FRAMES.length;
    const line = `${magenta(FRAMES[frame])} ${dim(this.text)}`;
    return [truncateToWidth(line, width, "", true)];
  }
}

function normalizeState(text: string): string {
  const normalized = text.toLowerCase().replace(/\.+$/, "").trim();
  if (normalized === "thinking") return "thinking";
  if (normalized === "waiting") return "waiting";
  return normalized || "waiting";
}
