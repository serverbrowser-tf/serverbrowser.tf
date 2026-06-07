import { describe, expect, test } from "bun:test";

import {
  getNonValveQueryDelayMs,
  getRefreshDelayMs,
  shouldQueryNonValveServers,
} from "./refresh";

describe("server refresh scheduling", () => {
  test("throttles the non-Valve query from its last submission", () => {
    expect(shouldQueryNonValveServers(-1, 1_000)).toBe(true);
    expect(shouldQueryNonValveServers(1_000, 600_999)).toBe(false);
    expect(shouldQueryNonValveServers(1_000, 601_000)).toBe(true);
  });

  test("spaces the non-Valve query 60 seconds after the normal query", () => {
    expect(getNonValveQueryDelayMs(1_000, 1_000)).toBe(60_000);
    expect(getNonValveQueryDelayMs(1_000, 60_999)).toBe(1);
    expect(getNonValveQueryDelayMs(1_000, 61_000)).toBe(0);
    expect(getNonValveQueryDelayMs(1_000, 70_000)).toBe(0);
  });

  test("uses start-to-start refresh timing without a negative sleep", () => {
    expect(getRefreshDelayMs(1_000, 1_000, 60_000)).toBe(60_000);
    expect(getRefreshDelayMs(1_000, 60_000, 60_000)).toBe(1_000);
    expect(getRefreshDelayMs(1_000, 61_000, 60_000)).toBe(0);
    expect(getRefreshDelayMs(1_000, 70_000, 60_000)).toBe(0);
  });
});
