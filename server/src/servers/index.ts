import fs from "fs/promises";
import { SteamWebApiServerInfo } from "../types";
import fastpath from "./fastpath.json";

const ipBan = new Set([...fastpath.map((server) => server.addr)]);

// https://developer.valvesoftware.com/wiki/Master_Server_Query_Protocol#Filter

const getServerListUrl = () => {
  const url = new URL(
    "https://api.steampowered.com/IGameServersService/GetServerList/v1/",
  );
  url.searchParams.set("key", process.env.STEAM_WEB_API_KEY || "");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "50000");

  return url;
};

function filterHidden(servers: SteamWebApiServerInfo[]) {
  return servers.filter((server) => {
    if (ipBan.has(server.addr)) {
      return false;
    }
    return true;
  });
}

const commonFilters = "\\appid\\440\\secure\\1\\gamedir\\tf\\ngametype\\valve";

export async function getAllServers() {
  try {
    const timeout = AbortSignal.timeout(180_000);
    const url = getServerListUrl();
    url.searchParams.set("filter", commonFilters);

    const response = await fetch(url.toString(), {
      signal: timeout,
    });
    const json = await response.json();
    const servers: SteamWebApiServerInfo[] = json.response.servers;
    return filterHidden(servers);
  } catch (e) {
    console.error(e);
  }
  return [];
}

export async function getListOfServers(): Promise<SteamWebApiServerInfo[]> {
  try {
    const timeout = AbortSignal.timeout(180_000);
    const url = getServerListUrl();
    url.searchParams.set("filter", `${commonFilters}\\empty\\1`);

    const response = await fetch(url.toString(), {
      signal: timeout,
    });
    const json = await response.json();

    const servers: SteamWebApiServerInfo[] = json.response.servers;
    return filterHidden(servers);
  } catch (e) {
    console.error(e);
  }
  return [];
}
