import { describe, expect, test } from "bun:test";

import { sortedNumberIndex } from "./utils";

describe("utils", () => {
  test("finds the sorted insertion index for numbers", () => {
    expect(sortedNumberIndex([], 5)).toBe(0);
    expect(sortedNumberIndex([10, 20, 30], 5)).toBe(0);
    expect(sortedNumberIndex([10, 20, 30], 20)).toBe(1);
    expect(sortedNumberIndex([10, 20, 30], 25)).toBe(2);
    expect(sortedNumberIndex([10, 20, 30], 35)).toBe(3);
  });

  test("returns the first matching duplicate index", () => {
    expect(sortedNumberIndex([1, 5, 5, 5, 10], 5)).toBe(1);
  });
});
