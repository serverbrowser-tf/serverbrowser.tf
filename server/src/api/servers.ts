import { NextFunction, Request, Response, Router } from "express";

import { buildDataloaders, buildUpdaterService, db } from "../db";
import { ServerInfo } from "../types";
import { assert, asyncify } from "../utils";
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
  const category =
    typeof req.query.category === "string" ? req.query.category : undefined;
  const hasUsersPlaying = Number(req.query.hasUsersPlaying ?? "1") !== 0;
  const regions =
    "region" in req.query
      ? (Array.isArray(req.query.region)
          ? req.query.region
          : [req.query.region]
        ).map((region) => Number(region))
      : undefined;

  res.status(200).json(
    getOnlineServersFromStore({
      category,
      hasUsersPlaying,
      regions,
    }),
  );
}

apiRouter.get("/api/servers/all", cacheMiddleware, getOnlineServersHandler);

apiRouter.get("/api/servers.json", cacheMiddleware, getOnlineServersHandler);

apiRouter.get(
  "/api/servers",
  cacheMiddleware,
  asyncify(async (req: Request, res: Response) => {
    const dataloaders = buildDataloaders(db);
    assert(typeof req.query.ip === "string", "Expected ip to be a string");
    if (req.query.ip === "") {
      res.status(400).end();
      return;
    }
    const ips = req.query.ip.split(",");
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
    const ip: string = req.body.ip;
    const reason: string = req.body.reason;
    const updater = buildUpdaterService(db);
    if (reason) {
      await updater.updateBlacklist(ip, reason);
    } else {
      await updater.deleteServerFromBlacklist(ip);
    }
    await applyBan(ip, reason);
    res.status(200).json({
      success: true,
    });
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
    let limit = req.query.mapLimit ? Number(req.query.mapLimit) : 10;
    if (Number.isNaN(limit)) {
      limit = 10;
    }

    if (isLoggedIn(req)) {
      res.startTime("maps", "");
      const maps = await dataloaders.mapHours.load(steamid);
      res.endTime("maps");
      res.startTime("playerCounts", "");
      const playerCounts = await dataloaders.playerCount.load(steamid);
      res.endTime("playerCounts");

      res.json({
        maps: Object.fromEntries(maps.slice(0, 10)),
        playerCounts,
      });
    } else {
      const [maps, playerCounts] = await Promise.all([
        dataloaders.mapHours.load(steamid),
        dataloaders.playerCount.load(steamid),
      ]);
      res.json({
        maps: Object.fromEntries(maps.slice(0, 10)),
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
    const steamid = await resolveSteamId(req.params.ip);
    if (!steamid) {
      res.status(404).end();
      return;
    }

    const name = getHydratedServerByIp(req.params.ip)?.name ?? "";
    res.startTime("playerCounts", "");
    const playerCounts = await dataloaders.playerCountWithMaps.load(steamid);
    res.endTime("playerCounts");
    res.json({
      name,
      playerCounts,
    });
  }),
);

export default apiRouter;
