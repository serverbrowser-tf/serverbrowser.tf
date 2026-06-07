import { afterEach, describe, expect, spyOn, test } from "bun:test";

import type { SteamWebApiServerInfo } from "../types";
import { getListOfServers, getNonValveServers } from ".";

const originalSteamApiKey = process.env.STEAM_WEB_API_KEY;

afterEach(() => {
  if (originalSteamApiKey === undefined) {
    delete process.env.STEAM_WEB_API_KEY;
  } else {
    process.env.STEAM_WEB_API_KEY = originalSteamApiKey;
  }
});

function steamServers() {
  return [
    {
      addr: "203.0.113.1:27015",
      steamid: "1",
    },
  ] as SteamWebApiServerInfo[];
}

describe("Steam server list filters", () => {
  test("normal polling requests non-empty servers", async () => {
    const servers = steamServers();
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ response: { servers } })),
    );
    const infoSpy = spyOn(console, "info").mockImplementation(() => {});

    try {
      await expect(getListOfServers()).resolves.toEqual(servers);
      const url = new URL(String(fetchSpy.mock.calls[0][0]));
      expect(url.searchParams.get("filter")).toBe(
        "\\appid\\440\\secure\\1\\gamedir\\tf\\empty\\1",
      );
      expect(infoSpy).toHaveBeenCalledWith("Steam Web API returned 1 servers");
    } finally {
      fetchSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });

  test("special polling requests all non-Valve servers", async () => {
    const servers = steamServers();
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ response: { servers } })),
    );
    const infoSpy = spyOn(console, "info").mockImplementation(() => {});

    try {
      await expect(getNonValveServers()).resolves.toEqual(servers);
      const url = new URL(String(fetchSpy.mock.calls[0][0]));
      const filter = url.searchParams.get("filter");
      expect(filter).toBe(
        "\\appid\\440\\secure\\1\\gamedir\\tf\\ngametype\\valve",
      );
      expect(filter).not.toContain("\\empty\\1");
    } finally {
      fetchSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });

  test("failed requests are not represented as empty snapshots", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 500 }),
    );
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(getNonValveServers()).resolves.toBeNull();
      await expect(getListOfServers()).resolves.toBeNull();
    } finally {
      fetchSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
