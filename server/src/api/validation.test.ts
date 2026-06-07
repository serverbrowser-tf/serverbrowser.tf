import { describe, expect, test } from "bun:test";

import { parseLoginBody } from "./login";
import {
  parseBanBody,
  parseMapLimitQuery,
  parseOnlineServersQuery,
  parseServerLookupQuery,
} from "./servers";

describe("request validation", () => {
  test("accepts valid login bodies and rejects invalid ones", () => {
    expect(
      parseLoginBody({ password: "secret" }).success,
    ).toBe(true);
    expect(parseLoginBody({}).success).toBe(false);
    expect(parseLoginBody({ password: 1 }).success).toBe(false);
  });

  test("rejects invalid ban bodies", () => {
    expect(
      parseBanBody({ ip: "127.0.0.1:27015", reason: "fake players" }).success,
    ).toBe(true);
    expect(parseBanBody({ ip: "127.0.0.1:27015" }).success).toBe(false);
    expect(parseBanBody({ ip: "127.0.0.1:27015", reason: 1 }).success).toBe(
      false,
    );
  });

  test("requires a non-empty server lookup ip query", () => {
    expect(parseServerLookupQuery({ ip: "127.0.0.1:27015" }).success).toBe(
      true,
    );
    expect(parseServerLookupQuery({ ip: "" }).success).toBe(false);
    expect(parseServerLookupQuery({}).success).toBe(false);
  });

  test("parses online server filters and rejects invalid numeric filters", () => {
    const parsed = parseOnlineServersQuery({
      category: "all",
      hasUsersPlaying: "0",
      region: ["1", "2"],
    });

    expect(parsed).toEqual({
      success: true,
      output: {
        category: "all",
        hasUsersPlaying: false,
        regions: [1, 2],
      },
    });
    expect(parseOnlineServersQuery({ hasUsersPlaying: "abc" }).success).toBe(
      false,
    );
    expect(parseOnlineServersQuery({ region: "abc" }).success).toBe(false);
  });

  test("falls back to 10 for invalid map limits", () => {
    expect(parseMapLimitQuery({ mapLimit: "25" })).toBe(25);
    expect(parseMapLimitQuery({ mapLimit: "abc" })).toBe(10);
    expect(parseMapLimitQuery({})).toBe(10);
  });
});
