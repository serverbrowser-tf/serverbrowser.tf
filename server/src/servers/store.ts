import fs from "fs/promises";
import { omit } from "lodash";
import * as v from "valibot";

import { buildDataloaders, db } from "../db";
import { inferServerCategory } from "./inferCategory";
import {
  ServerInfo,
  SteamId,
  SteamWebApiServerInfo,
  steamWebApiServerInfoToLegacy,
} from "../types";
import { mapUpsert } from "../utils";

let id = Math.random().toString(36).substring(2);
let lastRequestTime = -1;
let lastSteamQueryAt = -1;
let nextQueueTime = -1;
let blacklist = new Map<string, string>();
let allServersByBlacklist = new Map<string | null, Map<string, ServerInfo>>();
let allServersByIp = new Map<string, ServerInfo>();
let allServersBySteamId = new Map<string, ServerInfo>();
let servers: Record<string, ServerInfo[]> = {};

interface ServersJsonArchive {
  lastSteamQueryAt?: number;
  servers: Record<string, ServerInfo[]>;
}

const serversByCategoryArchiveSchema = v.record(
  v.string(),
  v.array(v.unknown()),
);
const wrappedServersJsonArchiveSchema = v.object({
  lastSteamQueryAt: v.optional(v.number()),
  servers: serversByCategoryArchiveSchema,
});

function cleanupString(str: string | undefined) {
  if (!str) {
    return "";
  }
  str = str.replaceAll("\u0001", "");
  str = str.replaceAll("█", "");
  return str;
}

function cleanupServerInfo(servers: SteamWebApiServerInfo[]) {
  for (const server of servers) {
    server.name = cleanupString(server.name);
    server.gametype = cleanupString(server.gametype);
  }
}

export async function loadInitialServersJson() {
  try {
    const file = await fs.readFile("./servers.json");
    const json = JSON.parse(file.toString("utf8"));
    const archive = parseServersJsonArchive(json);
    servers = archive.servers;
    lastSteamQueryAt = archive.lastSteamQueryAt;
  } catch {
    servers = {};
    lastSteamQueryAt = -1;
  }
}

export function parseServersJsonArchive(input: unknown): {
  lastSteamQueryAt: number;
  servers: Record<string, ServerInfo[]>;
} {
  if (Array.isArray(input)) {
    return { lastSteamQueryAt: -1, servers: {} };
  }

  if (input && typeof input === "object" && "servers" in input) {
    const result = v.safeParse(wrappedServersJsonArchiveSchema, input);
    if (!result.success) {
      return { lastSteamQueryAt: -1, servers: {} };
    }
    return {
      lastSteamQueryAt: result.output.lastSteamQueryAt ?? -1,
      servers: result.output.servers as Record<string, ServerInfo[]>,
    };
  }

  const result = v.safeParse(serversByCategoryArchiveSchema, input);
  if (!result.success) {
    return { lastSteamQueryAt: -1, servers: {} };
  }
  return {
    lastSteamQueryAt: -1,
    servers: result.output as Record<string, ServerInfo[]>,
  };
}

export function getLastRequestTime() {
  return lastRequestTime;
}

export function setLastRequestTime(time: number) {
  lastRequestTime = time;
}

export function getLastSteamQueryAt() {
  return lastSteamQueryAt;
}

export function setLastSteamQueryAt(time: number) {
  lastSteamQueryAt = time;
}

export function setBlacklist(nextBlacklist: Map<string, string>) {
  blacklist = nextBlacklist;
}

export function replaceServerIndexes(next: {
  reasonMapping: Map<string | null, Map<string, ServerInfo>>;
  ipMapping: Map<string, ServerInfo>;
  steamidMapping: Map<string, ServerInfo>;
}) {
  allServersByBlacklist = next.reasonMapping;
  allServersByIp = next.ipMapping;
  allServersBySteamId = next.steamidMapping;
}

export function clearMissingPlayerCounts() {
  for (const server of allServersByIp.values()) {
    server.players = 0;
    server.bots = 0;
  }
}

export function mergeLiveServers(steamServers: SteamWebApiServerInfo[]) {
  cleanupServerInfo(steamServers);
  const legacyServers = steamWebApiServerInfoToLegacy(steamServers);

  for (const server of legacyServers) {
    const steamid = server.steamid;
    if (steamid && allServersBySteamId.has(steamid)) {
      const existing = allServersBySteamId.get(steamid)!;
      const oldIp = existing.ip;
      Object.assign(existing, server);
      if (oldIp !== server.ip) {
        allServersByIp.delete(oldIp);
        allServersByIp.set(server.ip, existing);
        for (const serversByReason of allServersByBlacklist.values()) {
          if (serversByReason.has(oldIp)) {
            serversByReason.delete(oldIp);
            serversByReason.set(server.ip, existing);
          }
        }
      }
      continue;
    }

    mapUpsert(allServersByIp, server.ip, {
      insert() {
        const reason = blacklist.get(server.ip) ?? null;
        mapUpsert(allServersByBlacklist, reason, {
          insert() {
            return new Map([[server.ip, server]]);
          },
          update(old) {
            old.set(server.ip, server);
            return old;
          },
        });
        if (steamid) {
          allServersBySteamId.set(steamid, server);
        }
        return server;
      },
      update(old) {
        if (steamid) {
          allServersBySteamId.set(steamid, old);
        }
        return Object.assign(old, server);
      },
    });
  }

  rebuildServerBuckets();
  return legacyServers;
}

function rebuildServerBuckets() {
  const nextServers: Record<string, ServerInfo[]> = {};

  for (const server of allServersByIp.values()) {
    const finalCategory =
      blacklist.get(server.ip) ?? inferServerCategory(server);
    const bucket = finalCategory ?? "vanilla";

    server.category = bucket === "vanilla" ? undefined : bucket;
    const bucketServers = nextServers[bucket] ?? [];
    bucketServers.push(server);
    nextServers[bucket] = bucketServers;
  }

  servers = nextServers;
}

export async function persistServersJson() {
  await fs.writeFile(
    "./servers.json",
    JSON.stringify({
      lastSteamQueryAt,
      servers,
    } satisfies ServersJsonArchive),
  );
}

export function markRefreshScheduled(delayMs: number) {
  nextQueueTime = Date.now() + delayMs;
}

export function bumpCacheVersion() {
  id = Math.random().toString(36).substring(2);
}

export function getCacheState() {
  return { id, nextQueueTime };
}

export async function resolveSteamId(ip: string): Promise<SteamId | null> {
  const cached = allServersByIp.get(ip)?.steamid;
  if (cached) {
    return cached as SteamId;
  }
  const dataloaders = buildDataloaders(db);
  const server = await dataloaders.servers.load(ip);
  if (server instanceof Error) {
    return null;
  }
  return (server.steamid as SteamId | undefined) ?? null;
}

export function getServerName(ip: string) {
  return allServersByIp.get(ip)?.name ?? "";
}

export function getHydratedServerByIp(ip: string) {
  return allServersByIp.get(ip);
}

export function getVisibilityByIp(ip: string): 0 | 1 | undefined {
  const visibility = allServersByIp.get(ip)?.visibility;
  if (visibility === 0 || visibility === 1) {
    return visibility;
  }
  return undefined;
}

export function getHydratedServersByIp() {
  return allServersByIp;
}

export function getOnlineServers(input: {
  category?: string;
  hasUsersPlaying: boolean;
  regions?: number[];
}) {
  const { category, hasUsersPlaying, regions } = input;
  let copy: ServerInfo[];
  if (category === "all") {
    copy = Object.values(omit(servers, "fake players")).flat();
  } else {
    copy = servers[String(category ?? "vanilla")] ?? [];
  }

  if (hasUsersPlaying) {
    copy = copy.filter((server) => {
      const players = (server.players ?? 0) - (server.bots ?? 0);
      return players !== 0;
    });
  }

  if (regions && regions.length > 0) {
    copy = copy.filter((server) => regions.includes(server.region));
  }

  return dedupeServersBySteamId(copy);
}

export async function applyBan(ip: string, reason: string) {
  let activeServer: ServerInfo | undefined;
  for (const servers of allServersByBlacklist.values()) {
    if (servers.has(ip)) {
      activeServer = servers.get(ip)!;
    }
    servers.delete(ip);
  }

  if (reason) {
    blacklist.set(ip, reason);
  } else {
    blacklist.delete(ip);
  }

  if (activeServer && reason !== "") {
    mapUpsert(allServersByBlacklist, reason, {
      insert() {
        return new Map([[ip, activeServer]]);
      },
      update(old) {
        old.set(ip, activeServer);
        return old;
      },
    });
  }

  rebuildServerBuckets();
}

export function dedupeServersBySteamId<T extends ServerInfo>(
  servers: T[],
): T[] {
  const seenSteamIds = new Set<string>();
  return servers.filter((server) => {
    if (!server.steamid) {
      return true;
    }
    if (seenSteamIds.has(server.steamid)) {
      return false;
    }
    seenSteamIds.add(server.steamid);
    return true;
  });
}
