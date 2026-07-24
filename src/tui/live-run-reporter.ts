import type { RunReporter } from "../lib/run-reporter.js";
import type { SessionEvent } from "../lib/session-event.js";
import { StatusBar } from "./components/status-bar.js";
import { openInlineTerminalSession } from "./inline-terminal-session.js";
import { RunEventProjector } from "./run-event-projector.js";
import { containLiveOutput, type LiveRunOutput } from "./safe-live-output.js";

const ANIMATION_INTERVAL_MS = 120;

export interface AnimationClock {
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export type { LiveRunOutput } from "./safe-live-output.js";

export interface LiveRunReporterOptions {
  animation?: AnimationClock;
}

export type LiveRunReporter = RunReporter;

const systemAnimation: AnimationClock = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

class TuiLiveRunReporter implements LiveRunReporter {
  private readonly session;
  private readonly statusBar = new StatusBar();
  private readonly projector;
  private readonly animation: AnimationClock;
  private readonly animationHandle: unknown;
  private disabled = false;
  private disposed = false;

  constructor(output: LiveRunOutput, options: LiveRunReporterOptions) {
    this.animation = options.animation ?? systemAnimation;
    this.session = openInlineTerminalSession({ stdout: containLiveOutput(output) });
    this.projector = new RunEventProjector(() => this.session.tui.requestRender(), this.statusBar);
    this.session.tui.addChild(this.projector.view.content);
    this.session.tui.addChild(this.statusBar);
    this.statusBar.setStartTime(Date.now());
    this.session.tui.requestRender();
    this.animationHandle = this.animation.setInterval(
      () => this.session.tui.requestRender(),
      ANIMATION_INTERVAL_MS,
    );
  }

  report(event: SessionEvent): void {
    if (this.disposed || this.disabled) return;
    try {
      this.projector.report(event);
    } catch {
      this.disabled = true;
    }
  }

  replay(events: readonly SessionEvent[]): void {
    if (this.disposed || this.disabled) return;
    try {
      this.projector.replay(events);
    } catch {
      this.disabled = true;
    }
  }

  [Symbol.dispose](): void {
    if (!this.prepareDisposal()) return;
    this.session[Symbol.dispose]();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (!this.prepareDisposal()) return;
    try {
      await this.session.flushRender();
    } finally {
      this.session[Symbol.dispose]();
    }
  }

  private prepareDisposal(): boolean {
    if (this.disposed) return false;
    this.disposed = true;
    this.animation.clearInterval(this.animationHandle);
    this.projector.finishActiveSession();
    this.statusBar.hide();
    return true;
  }
}

export function createLiveRunReporter(
  output: LiveRunOutput,
  options: LiveRunReporterOptions = {},
): LiveRunReporter {
  return new TuiLiveRunReporter(output, options);
}
