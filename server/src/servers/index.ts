import { SteamWebApiServerInfo } from "../types";
import {
  recordSteamServerBrowserFailure,
  recordSteamServerBrowserSuccess,
} from "../metrics";
import fastpath from "./fastpath.json";

const ipBan = new Set(fastpath.map((server) => server.addr));

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
    const ip = server.addr.split(":")[0];
    if (ipBan.has(ip)) {
      return false;
    }
    return true;
  });
}

const commonFilters = "\\appid\\440\\secure\\1\\gamedir\\tf";

async function fetchSteamServers(
  url: URL,
): Promise<SteamWebApiServerInfo[]> {
  const timeout = AbortSignal.timeout(180_000);
  const response = await fetch(url.toString(), {
    signal: timeout,
  });

  if (!response.ok) {
    throw new Error(`Steam server browser returned HTTP ${response.status}`);
  }

  const json = (await response.json()) as {
    response?: { servers?: unknown };
  };
  const servers = json.response?.servers;
  if (!Array.isArray(servers)) {
    throw new Error("Steam server browser response did not include servers");
  }

  recordSteamServerBrowserSuccess();
  return servers;
}

export async function getAllServers() {
  try {
    const url = getServerListUrl();
    url.searchParams.set("filter", commonFilters);

    const servers = await fetchSteamServers(url);
    return filterHidden(servers);
  } catch (e) {
    recordSteamServerBrowserFailure(e);
    console.error(e);
  }
  return [];
}

export async function getListOfServers(): Promise<SteamWebApiServerInfo[]> {
  try {
    const url = getServerListUrl();
    url.searchParams.set("filter", `${commonFilters}\\empty\\1`);

    const servers = await fetchSteamServers(url);
    return filterHidden(servers);
  } catch (e) {
    recordSteamServerBrowserFailure(e);
    console.error(e);
  }
  return [];
}
