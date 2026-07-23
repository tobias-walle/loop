import type { SessionEvent } from "./session-event.js";

export interface RunReporter extends Disposable, AsyncDisposable {
  report(event: SessionEvent): void;
  replay?(events: readonly SessionEvent[]): void;
}
