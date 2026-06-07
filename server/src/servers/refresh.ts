import { buildDataloaders, buildUpdaterService, db } from "../db";
import { queryGameServerInfo } from "steam-server-query";
import type { SteamWebApiServerInfo } from "../types";
import { getListOfServers, getNonValveServers } from ".";
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
  removeEmptyValveServers,
  removeMissingNonValveServers,
  replaceServerIndexes,
  setServerVisibility,
  setBlacklist,
  setLastRequestTime,
  setLastSteamQueryAt,
} from "./store";
import { sleep } from "../utils";
import { isValveServer } from "./valve";

const refreshPeriod = Number(process.env.REFRESH_PERIOD ?? 1);
const refreshPeriodMs = 1000 * 60 * refreshPeriod;
const nonValveQueryPeriodMs = 1000 * 60 * 10;
const nonValveQueryDelayMs = 1000 * 60;
const visibilityQueryWorkers = 20;

let visibilityQueue = Promise.resolve();

function applyGeoIpResults(
  steamServers: SteamWebApiServerInfo[],
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

function applyStoredVisibility(steamServers: SteamWebApiServerInfo[]) {
  for (const server of steamServers) {
    if (isValveServer(server)) {
      server.visibility = 1;
      continue;
    }
    server.visibility = getVisibilityByIp(server.addr) ?? 0;
  }
}

async function refreshVisibility(steamServers: SteamWebApiServerInfo[]) {
  const serverAddresses = steamServers.values();
  const updates: Array<{ steamid: string; visibility: 0 | 1 }> = [];

  async function spawnWorker() {
    while (true) {
      const result = serverAddresses.next();
      if (result.done) {
        return;
      }

      if (isValveServer(result.value)) {
        continue;
      }

      try {
        const info = await queryGameServerInfo(result.value.addr, 1, 5000);
        updates.push({
          steamid: result.value.steamid,
          visibility: info.visibility === 1 ? 1 : 0,
        });
      } catch { }
    }
  }

  await Promise.all(
    Array.from({ length: visibilityQueryWorkers }, () => spawnWorker()),
  );
  return updates;
}

function queueVisibilityRefresh(args: {
  steamServers: SteamWebApiServerInfo[];
  updater: ReturnType<typeof buildUpdaterService>;
  onSnapshot?: () => void | Promise<void>;
}) {
  const { steamServers, updater, onSnapshot } = args;
  visibilityQueue = visibilityQueue
    .then(async () => {
      console.time("Refreshing visibility");
      try {
        const updates = await timeRefreshPhase("visibility", () =>
          refreshVisibility(steamServers),
        );
        updater.updateServerVisibilityBySteamId(updates);
        for (const update of updates) {
          setServerVisibility(update.steamid, update.visibility);
        }
        if (updates.length > 0) {
          bumpCacheVersion();
          await onSnapshot?.();
        }
      } finally {
        console.timeEnd("Refreshing visibility");
      }
    })
    .catch((error) => {
      console.error("Refreshing visibility", error);
    });
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
      await timeRefreshPhase("throttle_wait", () =>
        sleep(msUntilAllowedSteamQuery),
      );
      now = new Date();
    }

    const steamQueryStartedAt = Number(now);
    setLastSteamQueryAt(steamQueryStartedAt);
    await timeRefreshPhase("cache_persist", persistServersJson);

    const steamServers = await timeRefreshPhase(
      "steam_server_list",
      getListOfServers,
    );
    if (steamServers == null) {
      return steamQueryStartedAt;
    }
    recordRefreshServerCount("steam_server_list", steamServers.length);
    console.log("Found", steamServers.length, "servers from web api");

    const geoIps = await timeRefreshPhase("geoip", () =>
      dataloaders.serverLocations.loadMany(
        steamServers.map((server) => server.addr.split(":")[0]),
      ),
    );
    applyGeoIpResults(steamServers, geoIps);
    applyStoredVisibility(steamServers);

    clearMissingPlayerCounts();
    const endMergeTimer = startRefreshTimer("merge_live_servers");
    let legacyServers: ReturnType<typeof mergeLiveServers>;
    try {
      legacyServers = mergeLiveServers(steamServers);
      recordRefreshServerCount("live_merged", legacyServers.length);
    } finally {
      endMergeTimer();
    }
    const removedValveServers = removeEmptyValveServers();
    if (removedValveServers > 0) {
      console.info(`Removed ${removedValveServers} empty Valve servers`);
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
    return steamQueryStartedAt;
  } finally {
    endTotalTimer();
    console.timeEnd("Refreshing servers");
  }
}

async function refreshNonValveServers(args: {
  dataloaders: ReturnType<typeof buildDataloaders>;
  updater: ReturnType<typeof buildUpdaterService>;
  onSnapshot?: () => void | Promise<void>;
}) {
  const { dataloaders, updater, onSnapshot } = args;
  const observedAt = new Date();
  const steamServers = await timeRefreshPhase(
    "non_valve_server_list",
    getNonValveServers,
  );
  if (steamServers == null) {
    return;
  }
  recordRefreshServerCount("non_valve_server_list", steamServers.length);
  console.log("Found", steamServers.length, "non-Valve servers from web api");

  const geoIps = await timeRefreshPhase("geoip", () =>
    dataloaders.serverLocations.loadMany(
      steamServers.map((server) => server.addr.split(":")[0]),
    ),
  );
  applyGeoIpResults(steamServers, geoIps);
  applyStoredVisibility(steamServers);

  const removedNonValveServers = removeMissingNonValveServers(steamServers);
  if (removedNonValveServers > 0) {
    console.info(`Removed ${removedNonValveServers} missing non-Valve servers`);
  }
  const legacyServers = mergeLiveServers(steamServers);
  await timeRefreshPhase("update_servers", () =>
    updater.updateServers(legacyServers),
  );
  await timeRefreshPhase("update_last_online", async () => {
    updater.updateLastOnlineBySteamId(
      steamServers.map((server) => server.steamid),
    );
  });
  await timeRefreshPhase("update_observations", () =>
    updater.updateServerObservations(legacyServers, observedAt),
  );

  bumpCacheVersion();
  queueVisibilityRefresh({ steamServers, updater, onSnapshot });
}

export function getRefreshDelayMs(
  loopStartedAt: number,
  now = Date.now(),
  periodMs = refreshPeriodMs,
) {
  return Math.max(0, loopStartedAt + periodMs - now);
}

export function shouldQueryNonValveServers(
  lastQueryAt: number,
  now = Date.now(),
) {
  return lastQueryAt < 0 || lastQueryAt + nonValveQueryPeriodMs <= now;
}

export function getNonValveQueryDelayMs(
  steamQueryStartedAt: number,
  now = Date.now(),
) {
  return Math.max(0, steamQueryStartedAt + nonValveQueryDelayMs - now);
}

export async function startServerRefreshLoop(
  args: {
    onSnapshot?: () => void | Promise<void>;
  } = {},
) {
  const { onSnapshot } = args;
  const dataloaders = buildDataloaders(db);
  const updater = buildUpdaterService(db);
  setBlacklist(dataloaders.blacklist());

  console.time("all servers");
  const allServers = await timeRefreshPhase("all_servers_db", () =>
    dataloaders.allServers(),
  );
  recordRefreshServerCount("all_servers_db", allServers.ipMapping.size);
  console.log("Found", allServers.ipMapping.size, "servers from db");
  replaceServerIndexes(allServers);
  setBlacklist(dataloaders.blacklist());
  await onSnapshot?.();
  console.timeEnd("all servers");

  let lastNonValveQueryAt = -1;

  while (true) {
    const loopStartedAt = Date.now();
    markRefreshScheduled(refreshPeriodMs);
    const queriesNonValveServersThisLoop = shouldQueryNonValveServers(
      lastNonValveQueryAt,
      loopStartedAt,
    );

    const steamQueryStartedAt = await refreshServersOnce({
      dataloaders,
      updater,
    });

    if (queriesNonValveServersThisLoop) {
      await sleep(getNonValveQueryDelayMs(steamQueryStartedAt));
      lastNonValveQueryAt = Date.now();
      await refreshNonValveServers({ dataloaders, updater, onSnapshot });
    }

    const refreshDelayMs = getRefreshDelayMs(loopStartedAt);
    markRefreshScheduled(refreshDelayMs);
    await onSnapshot?.();
    await sleep(refreshDelayMs);
  }
}
