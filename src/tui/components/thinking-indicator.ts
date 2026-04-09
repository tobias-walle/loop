import type { Component } from "@mariozechner/pi-tui";
import { ITALIC, RESET, rgbFg } from "../../lib/ansi.js";

const MAX_TEXT_LEN = "Thinking...".length;

/** Duration of one full shimmer sweep (ms). */
const SWEEP_MS = 2000;
/** Half-width of the shimmer band in characters. */
const BAND_HALF_WIDTH = 2.5;
/** Time (ms) between animation frames. */
const FRAME_INTERVAL = 80;

/** RGB for the dim (base) state. */
const DIM_RGB: [number, number, number] = [100, 100, 100];
/** RGB for the bright (shimmer peak) state. */
const BRIGHT_RGB: [number, number, number] = [200, 200, 200];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/**
 * Animated "Thinking..." indicator with a shimmer sweep effect.
 *
 * A bright band sweeps across the text from left to right on a 2-second
 * cycle, using a cosine falloff for smooth intensity transitions.
 * Uses 24-bit RGB colors to avoid width shifts from DIM/BOLD modifiers.
 */
export class ThinkingIndicator implements Component {
  private text = "Waiting...";
  private startTime = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private requestRender: () => void;
  private cachedLine: string | null = null;
  private cachedTime = -1;

  constructor(requestRender: () => void) {
    this.requestRender = requestRender;
  }

  setText(text: string): void {
    this.text = text;
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
    const quantised = Math.floor(elapsed / FRAME_INTERVAL);
    if (this.cachedLine != null && this.cachedTime === quantised) {
      return [this.cachedLine];
    }

    const period = this.text.length;
    const pos = ((elapsed % SWEEP_MS) / SWEEP_MS) * period;

    // Build per-character colored string
    let out = ITALIC;
    let prevR = -1;
    let prevG = -1;
    let prevB = -1;
    for (let i = 0; i < this.text.length; i++) {
      const dist = Math.abs(i - pos);
      const t =
        dist <= BAND_HALF_WIDTH ? 0.5 * (1 + Math.cos(Math.PI * (dist / BAND_HALF_WIDTH))) : 0;

      const r = lerp(DIM_RGB[0], BRIGHT_RGB[0], t);
      const g = lerp(DIM_RGB[1], BRIGHT_RGB[1], t);
      const b = lerp(DIM_RGB[2], BRIGHT_RGB[2], t);

      // Only emit a new color code when the color actually changes
      if (r !== prevR || g !== prevG || b !== prevB) {
        out += rgbFg(r, g, b);
        prevR = r;
        prevG = g;
        prevB = b;
      }
      out += this.text[i];
    }
    // Pad to full width using the longest text so switching labels doesn't cause reflow
    const pad = Math.max(0, width - MAX_TEXT_LEN);
    out += RESET + " ".repeat(pad);

    this.cachedLine = out;
    this.cachedTime = quantised;
    return [out];
  }
}
