import { describe, expect, test } from "bun:test";
import { handleGlobalInput } from "./global-input";

describe("handleGlobalInput", () => {
  test.each(["\x03", "\x1b[99;5u", "\x1b[99;5:1u", "\x1b[27;5;99~"])(
    "consumes terminal protocol ctrl+c %p",
    (input) => {
      let interrupts = 0;
      expect(handleGlobalInput(input, () => interrupts++)).toEqual({ consume: true });
      expect(interrupts).toBe(1);
    },
  );

  test.each(["\x1b[99;5:2u", "\x1b[99;5:3u"])(
    "ignores ctrl+c repeat and release events %p",
    (input) => {
      let interrupts = 0;
      expect(handleGlobalInput(input, () => interrupts++)).toEqual({ consume: true });
      expect(interrupts).toBe(0);
    },
  );

  test("leaves other input for the active screen", () => {
    let interrupts = 0;
    expect(handleGlobalInput("x", () => interrupts++)).toBeUndefined();
    expect(interrupts).toBe(0);
  });
});
