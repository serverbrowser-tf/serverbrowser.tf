import { buildDataloaders, buildUpdaterService, db } from "../db";
import { queryGameServerInfo } from "steam-server-query";
import { getAllServers, getListOfServers } from ".";
import {
  recordRefreshServerCount,
  startRefreshTimer,
  timeRefreshPhase,
} from "../metrics";
import {
  bumpCacheVersion,
  clearMissingPlayerCounts,
  getLastSteamQueryAt,
  getVisibilityByIp,
  getLastRequestTime,
  markRefreshScheduled,
  mergeLiveServers,
  persistServersJson,
  replaceServerIndexes,
  setBlacklist,
  setLastRequestTime,
  setLastSteamQueryAt,
} from "./store";
import { sleep } from "../utils";

const refreshPeriod = Number(process.env.REFRESH_PERIOD ?? 1);
const refreshPeriodMs = 1000 * 60 * refreshPeriod;
const visibilityRefreshPeriod = 1000 * 60 * 60;
const visibilityQueryWorkers = 20;

let lastVisibilityRefreshTime = -1;

function applyGeoIpResults(
  steamServers: Awaited<ReturnType<typeof getListOfServers>>,
  geoIps: Awaited<
    ReturnType<
      ReturnType<typeof buildDataloaders>["serverLocations"]["loadMany"]
    >
  >,
) {
  for (let i = 0; i < steamServers.length; i++) {
    const server = steamServers[i];
    const geoIp = geoIps[i];
    if (geoIp instanceof Error) {
      console.error(geoIp);
      server.geoip = null;
    } else if (geoIp) {
      server.geoip = [geoIp.long, geoIp.lat];
    } else {
      server.geoip = null;
    }
  }
}

function applyStoredVisibility(
  steamServers: Awaited<ReturnType<typeof getListOfServers>>,
) {
  for (const server of steamServers) {
    server.visibility = getVisibilityByIp(server.addr) ?? 0;
  }
}

async function refreshVisibility(
  steamServers: Awaited<ReturnType<typeof getListOfServers>>,
) {
  const serverAddresses = steamServers.values();

  async function spawnWorker() {
    while (true) {
      const result = serverAddresses.next();
      if (result.done) {
        return;
      }

      try {
        const info = await queryGameServerInfo(result.value.addr, 1, 5000);
        result.value.visibility = info.visibility === 1 ? 1 : 0;
      } catch {}
    }
  }

  await Promise.all(
    Array.from({ length: visibilityQueryWorkers }, () => spawnWorker()),
  );
}

async function refreshServersOnce(args: {
  dataloaders: ReturnType<typeof buildDataloaders>;
  updater: ReturnType<typeof buildUpdaterService>;
}) {
  const { dataloaders, updater } = args;
  console.time("Refreshing servers");
  const endTotalTimer = startRefreshTimer("total");
  try {
    let now = new Date();
    const msUntilAllowedSteamQuery =
      getLastSteamQueryAt() + refreshPeriodMs - Number(now);
    if (msUntilAllowedSteamQuery > 0) {
      markRefreshScheduled(msUntilAllowedSteamQuery);
      await timeRefreshPhase("throttle_wait", () =>
        sleep(msUntilAllowedSteamQuery),
      );
      now = new Date();
    }

    setLastSteamQueryAt(Number(now));
    await timeRefreshPhase("cache_persist", persistServersJson);

    const steamServers = await timeRefreshPhase(
      "steam_server_list",
      getListOfServers,
    );
    recordRefreshServerCount("steam_server_list", steamServers.length);
    console.log("Found", steamServers.length, "servers from web api");

    const geoIps = await timeRefreshPhase("geoip", () =>
      dataloaders.serverLocations.loadMany(
        steamServers.map((server) => server.addr.split(":")[0]),
      ),
    );
    applyGeoIpResults(steamServers, geoIps);
    applyStoredVisibility(steamServers);

    const shouldRefreshVisibility =
      lastVisibilityRefreshTime < 0 ||
      lastVisibilityRefreshTime + visibilityRefreshPeriod < Date.now();
    if (shouldRefreshVisibility) {
      console.time("Refreshing visibility");
      await timeRefreshPhase("visibility", () =>
        refreshVisibility(steamServers),
      );
      lastVisibilityRefreshTime = Date.now();
      console.timeEnd("Refreshing visibility");
    }

    clearMissingPlayerCounts();
    const endMergeTimer = startRefreshTimer("merge_live_servers");
    let legacyServers: ReturnType<typeof mergeLiveServers>;
    try {
      legacyServers = mergeLiveServers(steamServers);
      recordRefreshServerCount("live_merged", legacyServers.length);
    } finally {
      endMergeTimer();
    }

    await timeRefreshPhase("update_last_online", async () => {
      updater.updateLastOnlineBySteamId(
        steamServers.map((server) => server.steamid),
      );
    });
    await timeRefreshPhase("update_servers", () =>
      updater.updateServers(legacyServers),
    );
    await timeRefreshPhase("update_observations", () =>
      updater.updateServerObservations(legacyServers, now),
    );

    await timeRefreshPhase("update_player_history", async () => {
      const lastRequestTime = getLastRequestTime();
      if (lastRequestTime > 0) {
        const diffInSeconds = Math.floor(
          (Number(now) - lastRequestTime) / 1000,
        );
        await updater.updateServerPlayers(legacyServers, diffInSeconds, now);
        await updater.updateServerMapHours(legacyServers, diffInSeconds, now);
      } else {
        await updater.updateServerPlayers(legacyServers, 0, now);
      }
    });
    setLastRequestTime(Number(now));

    bumpCacheVersion();
    await timeRefreshPhase("cache_persist", persistServersJson);
    console.info("Got", steamServers.length, "servers");
  } finally {
    endTotalTimer();
    console.timeEnd("Refreshing servers");
  }
}

export async function startServerRefreshLoop() {
  const dataloaders = buildDataloaders(db);
  const updater = buildUpdaterService(db);
  setBlacklist(dataloaders.blacklist());

  let lastQueriedAllServers = -1;
  const queryAllServersDelay = 1000 * 60 * 60 * 6;

  while (true) {
    const queriesAllServersThisLoop =
      lastQueriedAllServers + queryAllServersDelay < Date.now();

    if (queriesAllServersThisLoop) {
      console.time("all servers");
      const allServers = await timeRefreshPhase("all_servers_db", () =>
        dataloaders.allServers(),
      );
      recordRefreshServerCount("all_servers_db", allServers.ipMapping.size);
      console.log("Found", allServers.ipMapping.size, "servers from db");
      replaceServerIndexes(allServers);
      setBlacklist(dataloaders.blacklist());
      console.timeEnd("all servers");
    }

    await refreshServersOnce({ dataloaders, updater });

    markRefreshScheduled(refreshPeriodMs);

    if (queriesAllServersThisLoop) {
      lastQueriedAllServers = Date.now();
      console.time("Querying all servers");
      const servers = await timeRefreshPhase(
        "all_servers_steam",
        getAllServers,
      );
      recordRefreshServerCount("all_servers_steam", servers.length);
      await timeRefreshPhase("update_last_online", async () => {
        updater.updateLastOnlineBySteamId(
          servers.map((server) => server.steamid),
        );
      });
      console.timeEnd("Querying all servers");
    }

    await new Promise<void>((resolve) => setTimeout(resolve, refreshPeriodMs));
  }
}
