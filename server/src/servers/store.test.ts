import { describe, expect, test } from "bun:test";

import type { HydratedServerInfo } from "../types";
import { parseServersJsonArchive } from "./store";

function server(
  overrides: Partial<HydratedServerInfo> = {},
): HydratedServerInfo {
  return {
    ip: "127.0.0.1:27015",
    steamid: "1",
    server: "127.0.0.1:27015",
    name: "Test Server",
    map: "cp_badlands",
    players: 1,
    maxPlayers: 24,
    bots: 0,
    visibility: 1,
    region: 0 as any,
    geoip: null,
    ...overrides,
  };
}

describe("servers.json archive validation", () => {
  test("loads the legacy category archive format", () => {
    const testServer = server();

    expect(parseServersJsonArchive({ vanilla: [testServer] })).toEqual({
      lastSteamQueryAt: -1,
      servers: { vanilla: [testServer] },
    });
  });

  test("loads the wrapped archive format", () => {
    const testServer = server({
      ip: "127.0.0.2:27015",
      server: "127.0.0.2:27015",
      name: "Wrapped Server",
      players: 2,
    });

    expect(
      parseServersJsonArchive({
        lastSteamQueryAt: 123,
        servers: { vanilla: [testServer] },
      }),
    ).toEqual({
      lastSteamQueryAt: 123,
      servers: { vanilla: [testServer] },
    });
  });

  test("falls back safely for malformed wrapped archives", () => {
    expect(
      parseServersJsonArchive({
        lastSteamQueryAt: 123,
        servers: { vanilla: "not an array" },
      }),
    ).toEqual({
      lastSteamQueryAt: -1,
      servers: {},
    });
  });
});
