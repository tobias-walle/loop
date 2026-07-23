import type { EventEmitter } from "node:events";

export interface ShutdownSignals extends Disposable {
  readonly signal: AbortSignal;
  readonly exitCode: number | undefined;
}

type SignalProcess = Pick<EventEmitter, "on" | "off">;
type SignalName = "SIGINT" | "SIGTERM" | "SIGHUP";

const EXIT_CODES: Record<SignalName, number> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
};

class ProcessShutdownSignals implements ShutdownSignals {
  private readonly controller = new AbortController();
  private disposed = false;
  private code: number | undefined;
  private readonly handlers = new Map<SignalName, () => void>();

  constructor(private readonly process: SignalProcess) {
    for (const name of Object.keys(EXIT_CODES) as SignalName[]) {
      const handler = (): void => {
        if (this.controller.signal.aborted) return;
        this.code = EXIT_CODES[name];
        this.controller.abort(name);
      };
      this.handlers.set(name, handler);
      process.on(name, handler);
    }
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get exitCode(): number | undefined {
    return this.code;
  }

  [Symbol.dispose](): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [name, handler] of this.handlers) this.process.off(name, handler);
    this.handlers.clear();
  }
}

export function createShutdownSignals(
  process: SignalProcess = globalThis.process,
): ShutdownSignals {
  return new ProcessShutdownSignals(process);
}
