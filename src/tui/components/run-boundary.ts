import { type Container, Spacer, Text } from "@mariozechner/pi-tui";
import { Separator } from "./separator.js";

export function appendRunBoundary(root: Container, text: string): void {
  root.addChild(new Spacer());
  root.addChild(new Text(text, 0, 0));
  root.addChild(new Spacer());
  root.addChild(new Separator());
}
