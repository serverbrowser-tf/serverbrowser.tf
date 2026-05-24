import { describe, expect, test } from "bun:test";

import type { HydratedServerInfo, SteamWebApiServerInfo } from "../types";
import {
  getOnlineServers,
  mergeLiveServers,
  parseServersJsonArchive,
  replaceServerIndexes,
  setBlacklist,
} from "./store";
import { isValveServer } from "./valve";

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

function steamServer(
  overrides: Partial<SteamWebApiServerInfo> = {},
): SteamWebApiServerInfo {
  return {
    addr: "127.0.0.1:27015",
    gameport: 27015,
    steamid: "1",
    name: "Test Server",
    appid: 440,
    gamedir: "tf",
    version: "1",
    product: "tf",
    region: 0,
    players: 12,
    max_players: 24,
    bots: 0,
    map: "cp_badlands",
    secure: true,
    dedicated: true,
    os: "l",
    gametype: "",
    geoip: null,
    visibility: 0,
    ...overrides,
  };
}

describe("Valve server classification", () => {
  test("detects Valve matchmaking servers from name and hidden Valve keywords", () => {
    expect(
      isValveServer({
        name: "Valve Matchmaking Server #123",
        gametype: "cp,valve,hidden,secure",
      }),
    ).toBe(true);
    expect(
      isValveServer({
        name: "Valve Matchmaking Server #123",
        keywords: "tf,hidden,valve",
      }),
    ).toBe(true);
    expect(
      isValveServer({
        name: "Community Server",
        keyword: "valve,hidden",
      }),
    ).toBe(false);
    expect(
      isValveServer({
        name: "Valve Matchmaking Server #123",
        gametype: "notvalve,hidden",
      }),
    ).toBe(false);
    expect(
      isValveServer({
        name: "Valve Matchmaking Server #123",
        gametype: "valveish,hidden",
      }),
    ).toBe(false);
  });

  test("keeps Valve servers in their own category and out of all", () => {
    replaceServerIndexes({
      reasonMapping: new Map(),
      ipMapping: new Map(),
      steamidMapping: new Map(),
    });
    setBlacklist(new Map());

    mergeLiveServers([
      steamServer({
        addr: "127.0.0.1:27015",
        steamid: "1",
        name: "Valve Matchmaking Server #1",
        gametype: "ctf,valve,hidden",
      }),
      steamServer({
        addr: "127.0.0.2:27015",
        steamid: "2",
        name: "Community Server",
        gametype: "vanilla",
      }),
    ]);

    expect(
      getOnlineServers({
        category: "valve",
        hasUsersPlaying: false,
      }).map((server) => server.ip),
    ).toEqual(["127.0.0.1:27015"]);
    expect(
      getOnlineServers({
        category: "all",
        hasUsersPlaying: false,
      }).map((server) => server.ip),
    ).toEqual(["127.0.0.2:27015"]);
  });
});
