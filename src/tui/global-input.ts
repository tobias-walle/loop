import { isKeyRelease, isKeyRepeat, matchesKey } from "@mariozechner/pi-tui";

export type GlobalInputResult = { consume: true } | undefined;

export function handleGlobalInput(data: string, onInterrupt: () => void): GlobalInputResult {
  if (!matchesKey(data, "ctrl+c")) return undefined;
  if (!(isKeyRepeat(data) || isKeyRelease(data))) onInterrupt();
  return { consume: true };
}
