import { describe, expect, test } from "bun:test";
import { ENTER_ALT_SCREEN, ERASE_SCROLLBACK, LEAVE_ALT_SCREEN } from "./ansi.js";

describe("terminal controls", () => {
  test("centralizes alternate screen and scrollback controls", () => {
    expect(ENTER_ALT_SCREEN).toContain("1049h");
    expect(LEAVE_ALT_SCREEN).toContain("1049l");
    expect(ERASE_SCROLLBACK).toContain("3J");
  });
});
