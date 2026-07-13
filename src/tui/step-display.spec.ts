import { expect, test } from "bun:test";
import { describeStep } from "./step-display.js";

test("describes task and group steps consistently", () => {
  expect(describeStep({ type: "task", task: "Review", until: "approved", max: 4 })).toEqual({
    task: "Review",
    isLoop: true,
    max: 4,
  });
  expect(describeStep({ type: "group", tasks: ["Review", "Fix"], repeat: 3 })).toEqual({
    task: "Review, Fix",
    isLoop: true,
    max: 3,
  });
  expect(describeStep({ type: "task", task: "Ship" })).toEqual({
    task: "Ship",
    isLoop: false,
    max: undefined,
  });
});
