import { NextFunction, Request, Response, Router } from "express";
import * as v from "valibot";

import { buildDataloaders, buildUpdaterService, db } from "../db";
import { sendRefreshWorkerMessage } from "../refresh-worker-supervisor";
import { ServerInfo } from "../types";
import { asyncify } from "../utils";
import {
  applyBan,
  dedupeServersBySteamId,
  getCacheState,
  getHydratedServerByIp,
  getHydratedServersByIp,
  getOnlineServers as getOnlineServersFromStore,
  resolveSteamId,
} from "../servers/store";

import { isLoggedIn, isLoggedInMiddleware } from "./login";

const apiRouter = Router();

type ParseResult<T> = { success: true; output: T } | { success: false };

const banBodySchema = v.object({
  ip: v.string(),
  reason: v.string(),
});

const serverLookupQuerySchema = v.object({
  ip: v.string(),
});

const queryNumberInputSchema = v.union([v.string(), v.number()]);

const onlineServersQuerySchema = v.object({
  category: v.optional(v.string()),
  hasUsersPlaying: v.optional(queryNumberInputSchema),
  region: v.optional(v.union([v.string(), v.array(v.string())])),
});

const mapLimitQuerySchema = v.object({
  mapLimit: v.optional(queryNumberInputSchema),
});

export function parseBanBody(input: unknown) {
  return v.safeParse(banBodySchema, input);
}

export function parseServerLookupQuery(
  input: unknown,
): ParseResult<{ ip: string }> {
  const result = v.safeParse(serverLookupQuerySchema, input);
  if (!result.success || result.output.ip === "") {
    return { success: false };
  }
  return { success: true, output: result.output };
}

export function parseOnlineServersQuery(input: unknown): ParseResult<{
  category?: string;
  hasUsersPlaying: boolean;
  regions?: number[];
}> {
  const result = v.safeParse(onlineServersQuerySchema, input);
  if (!result.success) {
    return { success: false };
  }

  const hasUsersPlayingValue = Number(result.output.hasUsersPlaying ?? "1");
  if (!Number.isFinite(hasUsersPlayingValue)) {
    return { success: false };
  }

  let regions: number[] | undefined;
  if (result.output.region !== undefined) {
    const regionInputs = Array.isArray(result.output.region)
      ? result.output.region
      : [result.output.region];
    regions = regionInputs.map((region) => Number(region));
    if (regions.some((region) => !Number.isFinite(region))) {
      return { success: false };
    }
  }

  return {
    success: true,
    output: {
      category: result.output.category,
      hasUsersPlaying: hasUsersPlayingValue !== 0,
      regions,
    },
  };
}

export function parseMapLimitQuery(input: unknown, fallback = 10) {
  const result = v.safeParse(mapLimitQuerySchema, input);
  if (!result.success || result.output.mapLimit === undefined) {
    return fallback;
  }

  const limit = Number(result.output.mapLimit);
  return Number.isFinite(limit) ? limit : fallback;
}

const cacheMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const { id, nextQueueTime } = getCacheState();
  const etag = `w/"${id}"`;
  const ifNoneMatch = req.headers["if-none-match"]
    ?.split(",")
    .map((str) => str.trim());
  if (ifNoneMatch && ifNoneMatch.includes(etag)) {
    res.status(304).send();
    return;
  }
  res.setHeader("ETag", etag);

  let nextUpdate =
    nextQueueTime < 0
      ? 9
      : Math.round((nextQueueTime - Date.now()) / 1000) + 45;
  nextUpdate = Math.max(nextUpdate, 9);
  res.setHeader("Cache-Control", `public, max-age=${nextUpdate}`);

  next();
};

function getOnlineServersHandler(req: Request, res: Response) {
  const query = parseOnlineServersQuery(req.query);
  if (!query.success) {
    res.status(400).end();
    return;
  }

  res.status(200).json(getOnlineServersFromStore(query.output));
}

apiRouter.get("/api/servers/all", cacheMiddleware, getOnlineServersHandler);

apiRouter.get("/api/servers.json", cacheMiddleware, getOnlineServersHandler);

apiRouter.get(
  "/api/servers",
  cacheMiddleware,
  asyncify(async (req: Request, res: Response) => {
    const query = parseServerLookupQuery(req.query);
    if (!query.success) {
      res.status(400).end();
      return;
    }

    const dataloaders = buildDataloaders(db);
    const ips = query.output.ip.split(",");
    res.startTime("db", "");
    const servers = (await dataloaders.servers.loadMany(ips)).filter(
      (server): server is Exclude<typeof server, Error> => {
        if (server instanceof Error) {
          console.error(server);
          return false;
        }
        return true;
      },
    );
    res.endTime("db");
    res.startTime("hydration", "");
    const hydratedServers = getHydratedServersByIp();
    for (const server of servers) {
      const hydratedServer = hydratedServers.get(server.ip);
      if (hydratedServer != null) {
        Object.assign(server, hydratedServer);
      } else {
        server.players = 0;
      }
    }
    res.endTime("hydration");
    res.json(dedupeServersBySteamId(servers));
  }),
);

apiRouter.post(
  "/api/ban",
  isLoggedInMiddleware,
  asyncify(async (req, res) => {
    const body = parseBanBody(req.body);
    if (!body.success) {
      res.status(400).end();
      return;
    }

    const { ip, reason } = body.output;
    const updater = buildUpdaterService(db);
    if (reason) {
      await updater.updateBlacklist(ip, reason);
    } else {
      await updater.deleteServerFromBlacklist(ip);
    }
    await applyBan(ip, reason);
    sendRefreshWorkerMessage({ type: "ban", ip, reason });
    res.status(200).json({
      success: true,
    });
  }),
);

apiRouter.get(
  "/api/admin/blacklist",
  isLoggedInMiddleware,
  asyncify(async (_req, res) => {
    res.setHeader("Cache-Control", `private, max-age=30`);

    const dataloaders = buildDataloaders(db);
    const rows: ServerInfo[] = dataloaders.adminBlacklist();

    for (const row of rows) {
      const hydratedServer = getHydratedServerByIp(row.ip);
      if (hydratedServer != null) {
        Object.assign(row, hydratedServer, { category: row.category });
      }
    }

    res.json(rows);
  }),
);

apiRouter.get(
  "/api/servers.json/admin-view",
  isLoggedInMiddleware,
  asyncify(async (req, res) => {
    res.setHeader("Cache-Control", `private, max-age=600`);

    const dataloaders = buildDataloaders(db);
    res.startTime("db", "");
    const allServers: ServerInfo[] = dataloaders.adminView();
    res.endTime("db");
    res.startTime("geoip", "");
    const geoIps = await dataloaders.serverLocations.loadMany(
      allServers.map((server) => server.ip.split(":")[0]),
    );
    res.endTime("geoip");

    const hydratedServersById = getHydratedServersByIp();

    for (let i = 0; i < allServers.length; i++) {
      const server = allServers[i];
      const geoIp = geoIps[i];
      if (geoIp instanceof Error) {
        console.error(geoIp);
        server.geoip = null;
      } else if (geoIp) {
        server.geoip = [geoIp.long, geoIp.lat];
      } else {
        server.geoip = null;
      }

      const hydratedServer = hydratedServersById.get(server.ip);
      Object.assign(allServers[i], hydratedServer);
    }

    res.json(dedupeServersBySteamId(allServers));
  }),
);

// @deprecated
apiRouter.get(
  "/api/details/:ip",
  cacheMiddleware,
  asyncify(async (req, res) => {
    const dataloaders = buildDataloaders(db);
    const steamid = await resolveSteamId(req.params.ip);
    if (!steamid) {
      res.status(404).end();
      return;
    }
    const limit = parseMapLimitQuery(req.query);

    if (isLoggedIn(req)) {
      res.startTime("maps", "");
      const maps = await dataloaders.mapHours.load(steamid);
      res.endTime("maps");
      res.startTime("playerCounts", "");
      const playerCounts = await dataloaders.playerCount.load(steamid);
      res.endTime("playerCounts");

      res.json({
        maps: Object.fromEntries(maps.slice(0, limit)),
        playerCounts,
      });
    } else {
      const [maps, playerCounts] = await Promise.all([
        dataloaders.mapHours.load(steamid),
        dataloaders.playerCount.load(steamid),
      ]);
      res.json({
        maps: Object.fromEntries(maps.slice(0, limit)),
        playerCounts,
      });
    }
  }),
);

// delete after a while lol
// @deprecated
apiRouter.get(
  "/api/server-details/:ip",
  cacheMiddleware,
  asyncify(async (req, res) => {
    const dataloaders = buildDataloaders(db);
    const steamid = await resolveSteamId(req.params.ip);
    if (!steamid) {
      res.status(404).end();
      return;
    }

    const name = getHydratedServerByIp(req.params.ip)?.name ?? "";

    if (isLoggedIn(req)) {
      res.startTime("maps", "");
      const maps = await dataloaders.mapHours.load(steamid);
      res.endTime("maps");
      res.startTime("playerCounts", "");
      const playerCounts = await dataloaders.playerCount.load(steamid);
      res.endTime("playerCounts");

      res.json({
        name,
        maps: Object.fromEntries(maps.slice(0, 100)),
        playerCounts,
      });
    } else {
      const [maps, playerCounts] = await Promise.all([
        dataloaders.mapHours.load(steamid),
        dataloaders.playerCount.load(steamid),
      ]);
      res.json({
        name,
        maps: Object.fromEntries(maps.slice(0, 100)),
        playerCounts,
      });
    }
  }),
);

// delete after a while lol
// @deprecated
apiRouter.get(
  "/api/server-details-p2/:ip",
  cacheMiddleware,
  asyncify(async (req, res) => {
    const dataloaders = buildDataloaders(db);
    const steamid = await resolveSteamId(req.params.ip);
    if (!steamid) {
      res.status(404).end();
      return;
    }

    res.startTime("serverMapHours", "");
    const serverMapHours = await dataloaders.serverMapHours.load(steamid);
    res.endTime("serverMapHours");

    res.json({ serverMapHours });
  }),
);

apiRouter.get(
  "/api/server-details-v2/:ip",
  cacheMiddleware,
  asyncify(async (req, res) => {
    const dataloaders = buildDataloaders(db);
    const serverIdResult = (await dataloaders.serverIdByIp.load(
      req.params.ip,
    )) as number | Error;
    const serverId = serverIdResult;
    if (serverId instanceof Error) {
      res.status(404).end();
      return;
    }

    const name = getHydratedServerByIp(req.params.ip)?.name ?? "";
    res.startTime("playerCounts", "");
    const playerCounts = await dataloaders.playerCountWithMaps.load(serverId);
    res.endTime("playerCounts");
    res.json({
      name,
      playerCounts,
    });
  }),
);

apiRouter.get(
  "/api/valve/details",
  cacheMiddleware,
  asyncify(async (_req, res) => {
    const dataloaders = buildDataloaders(db);

    res.startTime("playerCounts", "");
    const details = dataloaders.valveDetails();
    res.endTime("playerCounts");

    res.json(details);
  }),
);

export default apiRouter;
