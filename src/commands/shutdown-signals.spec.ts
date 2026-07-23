import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createShutdownSignals } from "./shutdown-signals.js";

class FakeProcess extends EventEmitter {}

describe("shutdown signals", () => {
  test.each([
    ["SIGINT", 130],
    ["SIGHUP", 129],
    ["SIGTERM", 143],
  ] as const)("maps %s to conventional exit code", (name, code) => {
    const process = new FakeProcess();
    using signals = createShutdownSignals(process);
    process.emit(name);
    expect(signals.signal.aborted).toBe(true);
    expect(signals.exitCode).toBe(code);
  });

  test("removes listeners exactly once", () => {
    const process = new FakeProcess();
    const signals = createShutdownSignals(process);
    expect(process.listenerCount("SIGINT")).toBe(1);
    signals[Symbol.dispose]();
    signals[Symbol.dispose]();
    expect(process.listenerCount("SIGINT")).toBe(0);
    expect(process.listenerCount("SIGTERM")).toBe(0);
    expect(process.listenerCount("SIGHUP")).toBe(0);
  });
});
