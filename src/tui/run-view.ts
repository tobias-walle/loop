import { Container } from "@mariozechner/pi-tui";
import { createEventRouter } from "./event-router.js";

export type RunView = {
  readonly content: Container;
  readonly router: ReturnType<typeof createEventRouter>;
  hasContent(): boolean;
  render(width: number): string[];
  reset(): void;
};

export function createRunView(requestRender: () => void): RunView {
  const content = new Container();
  let router = createEventRouter(content, requestRender);

  return {
    content,
    get router() {
      return router;
    },
    hasContent: () => content.children.length > 0,
    render: (width) => content.render(width),
    reset(): void {
      content.clear();
      router = createEventRouter(content, requestRender);
    },
  };
}
