import { describe, expect, mock, test } from "bun:test";
import { Request, Response } from "express";

import { NotFoundError } from "./errors";
import { asyncify, sortedNumberIndex } from "./utils";

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

  test("turns NotFoundError rejections into 404 responses", async () => {
    const end = mock(() => undefined);
    const status = mock(() => response);
    const response = { status, end } as unknown as Response;
    const handler = asyncify(async () => {
      throw new NotFoundError("missing");
    });

    await handler({} as Request, response);

    expect(status).toHaveBeenCalledWith(404);
    expect(end).toHaveBeenCalledTimes(1);
  });
});
