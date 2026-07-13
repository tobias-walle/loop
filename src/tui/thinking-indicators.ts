import { ThinkingIndicator } from "./components/thinking-indicator.js";
import type { ChildContainer, LoopTUIState } from "./event-handlers.js";

export type ThinkingIndicators = {
  add(key: string, container: ChildContainer, label?: "waiting" | "thinking"): void;
  has(key: string): boolean;
  remove(key: string): void;
  removeAll(): void;
};

export function createThinkingIndicators(
  indicators: LoopTUIState["thinkingIndicators"],
  requestRender: () => void,
  canAdd: () => boolean,
): ThinkingIndicators {
  const remove = (key: string): void => {
    const indicator = indicators.get(key);
    if (!indicator) return;
    indicator.node.stop();
    indicator.parent.removeChild(indicator.node);
    indicators.delete(key);
  };

  return {
    add(key, container, label = "waiting"): void {
      if (!canAdd() || indicators.has(key)) return;
      const thinking = new ThinkingIndicator(requestRender);
      thinking.setText(label);
      container.addChild(thinking);
      thinking.start();
      indicators.set(key, { node: thinking, parent: container });
      requestRender();
    },
    has: (key) => indicators.has(key),
    remove,
    removeAll(): void {
      for (const key of indicators.keys()) remove(key);
    },
  };
}
