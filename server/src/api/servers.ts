import { NextFunction, Request, Response, Router } from "express";
import fs from "fs/promises";

import { buildDataloaders, buildUpdaterService, db } from "../db";
import { getAllServers, pingServers } from "../servers";
import { cleanupServerInfo, isServerNormal } from "../servers/slopfilter";
import { ServerInfo } from "../types";
import {
  assert,
  asyncify,
  CustomIterator,
  isDev,
  mapUpsert,
  sleep,
} from "../utils";

import { isLoggedIn, isLoggedInMiddleware } from "./login";

const multiplier = isDev ? 10 : 1;

let id = Math.random().toString(36).substring(2);
let lastRequestTime = -1;
let nextQueueTime = -1;
let blacklist = new Map<string, string>();
let allServersByBlacklist = new Map<string | null, Map<string, ServerInfo>>();
let allServersByIp = new Map<string, ServerInfo>();
let servers: Record<string, ServerInfo[]> = await (async () => {
  try {
    const file = await fs.readFile("./servers.json");
    const json = JSON.parse(file.toString("utf8"));
    if (Array.isArray(json)) {
      return {};
    }
    return json;
  } catch {
    return {};
  }
})();
let refreshPromise = Promise.withResolvers<void>();
let serverIterator: CustomIterator<ServerInfo> | undefined;

async function pingServersForever() {
  const dataloaders = buildDataloaders(db);
  const updater = buildUpdaterService(db);
  blacklist = dataloaders.blacklist();
  let lastQueriedAllServers = -1;
  const queryAllServersDelay = 1000 * 60 * 60 * 6;

  while (true) {
    const queriesAllServersThisLoop =
      lastQueriedAllServers + queryAllServersDelay < Date.now();
    if (queriesAllServersThisLoop) {
      console.time("all servers");
      const allServers = await dataloaders.allServers();
      console.log("Found", allServers.ipMapping.size, "servers from db");
      allServersByBlacklist = allServers.reasonMapping;
      allServersByIp = allServers.ipMapping;
      console.timeEnd("all servers");
    }

    console.time("Refreshing servers");
    const now = new Date();
    const pingedServers = await pingServers();
    updater.updateLastOnline(pingedServers.map((server) => server.ip));
    cleanupServerInfo(pingedServers);
    await updater.updateServers(pingedServers);
    await updater.updateServerPlayers(pingedServers, now);
    if (lastRequestTime > 0) {
      const diffInSeconds = Math.floor((Number(now) - lastRequestTime) / 1000);
      await updater.updateServerMapHours(pingedServers, diffInSeconds, now);
    }
    lastRequestTime = Number(now);

    const geoIps = await dataloaders.serverLocations.loadMany(
      pingedServers.map((server) => server.ip.split(":")[0]),
    );

    for (const server of allServersByIp.values()) {
      server.players = 0;
      server.bots = 0;
    }

    for (let i = 0; i < pingedServers.length; i++) {
      const server = pingedServers[i];
      const geoIp = geoIps[i];
      if (geoIp instanceof Error) {
        console.error(geoIp);
        server.geoip = null;
      } else if (geoIp) {
        server.geoip = [geoIp.long, geoIp.lat];
      } else {
        server.geoip = null;
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
          return server;
        },
        update(old) {
          return Object.assign(old, server);
        },
      });
    }

    let notFiltered: ServerInfo[] = [];
    servers = Object.fromEntries(
      [...allServersByBlacklist.entries()]
        .filter(([key, servers]) => {
          if (key == null) {
            notFiltered = [...servers.values()];
            return false;
          }
          return true;
        })
        .map(([key, value]) => {
          return [key, [...value.values()]];
        }),
    );
    for (const server of notFiltered) {
      if (isServerNormal(server)) {
        servers.vanilla.push(server);
      }
    }

    id = Math.random().toString(36).substring(2);
    fs.writeFile(`./servers.json`, JSON.stringify(servers));
    console.info("Got", pingedServers.length, "servers");
    console.timeEnd("Refreshing servers");

    const timeToSleep = 1000 * 60 * 2.5 * multiplier;
    nextQueueTime = Date.now() + timeToSleep;
    refreshPromise = Promise.withResolvers();
    setInterval(refreshPromise.resolve, timeToSleep);

    if (queriesAllServersThisLoop) {
      lastQueriedAllServers = Date.now();
      console.time("Querying all servers");
      const servers = await getAllServers();
      updater.updateLastOnline(servers);
      console.timeEnd("Querying all servers");
    }

    await refreshPromise.promise;
  }
}

pingServersForever();

const apiRouter = Router();

const cacheMiddleware = (req: Request, res: Response, next: NextFunction) => {
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

function getOnlineServers(req: Request, res: Response) {
  const category = req.query.category;
  const hasUsersPlaying = Number(req.query.hasUsersPlaying ?? "1");

  let copy = servers[String(category ?? "vanilla")];
  if (hasUsersPlaying) {
    copy = copy.filter((server) => {
      const players = (server.players ?? 0) - (server.bots ?? 0);
      return players !== 0;
    });
  }
  if ("region" in req.query) {
    const regionStr = Array.isArray(req.query.region)
      ? req.query.region
      : [req.query.region];
    const regionsFilter = regionStr.map((region) => Number(region));

    copy = copy.filter((server) => regionsFilter.includes(server.region));
  }

  res.status(200).json(copy);
}

apiRouter.get("/api/servers/all", cacheMiddleware, getOnlineServers);

apiRouter.get("/api/servers.json", cacheMiddleware, getOnlineServers);

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
    const hydratedServers = allServersByIp;
    for (const server of servers) {
      const hydratedServer = hydratedServers.get(server.ip);
      if (hydratedServer != null) {
        Object.assign(server, hydratedServer);
      } else {
        server.players = 0;
      }
    }
    res.endTime("hydration");
    res.json(servers);
  }),
);

apiRouter.post(
  "/api/ban",
  isLoggedInMiddleware,
  asyncify(async (req, res) => {
    const ip: string = req.body.ip;
    const reason: string = req.body.reason;
    const updater = buildUpdaterService(db);
    await updater.updateBlacklist(ip, reason);
    let activeServer: ServerInfo | undefined;
    for (const servers of allServersByBlacklist.values()) {
      if (servers.has(ip)) {
        activeServer = servers.get(ip)!;
      }
      servers.delete(ip);
    }
    if (activeServer) {
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

    const hydratedServersById = allServersByIp;

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

    res.json(allServers);
  }),
);

// @deprecated
apiRouter.get(
  "/api/details/:ip",
  cacheMiddleware,
  asyncify(async (req, res) => {
    const dataloaders = buildDataloaders(db);
    let limit = req.query.mapLimit ? Number(req.query.mapLimit) : 10;
    if (Number.isNaN(limit)) {
      limit = 10;
    }

    if (isLoggedIn(req)) {
      res.startTime("maps", "");
      const maps = await dataloaders.mapHours.load(req.params.ip);
      res.endTime("maps");
      res.startTime("playerCounts", "");
      const playerCounts = await dataloaders.playerCount.load(req.params.ip);
      res.endTime("playerCounts");

      res.json({
        maps: Object.fromEntries(maps.slice(0, 10)),
        playerCounts,
      });
    } else {
      const [maps, playerCounts] = await Promise.all([
        dataloaders.mapHours.load(req.params.ip),
        dataloaders.playerCount.load(req.params.ip),
      ]);
      res.json({
        maps: Object.fromEntries(maps.slice(0, 10)),
        playerCounts,
      });
    }
  }),
);

apiRouter.get(
  "/api/server-details/:ip",
  cacheMiddleware,
  asyncify(async (req, res) => {
    const dataloaders = buildDataloaders(db);

    const name = allServersByIp.get(req.params.ip)?.name ?? "";

    if (isLoggedIn(req)) {
      res.startTime("maps", "");
      const maps = await dataloaders.mapHours.load(req.params.ip);
      res.endTime("maps");
      res.startTime("playerCounts", "");
      const playerCounts = await dataloaders.playerCount.load(req.params.ip);
      res.endTime("playerCounts");

      res.json({
        name,
        maps: Object.fromEntries(maps.slice(0, 100)),
        playerCounts,
      });
    } else {
      const [maps, playerCounts] = await Promise.all([
        dataloaders.mapHours.load(req.params.ip),
        dataloaders.playerCount.load(req.params.ip),
      ]);
      res.json({
        name,
        maps: Object.fromEntries(maps.slice(0, 100)),
        playerCounts,
      });
    }
  }),
);

apiRouter.get(
  "/api/server-details-p2/:ip",
  cacheMiddleware,
  asyncify(async (req, res) => {
    const dataloaders = buildDataloaders(db);

    res.startTime("serverMapHours", "");
    const serverMapHours = await dataloaders.serverMapHours.load(req.params.ip);
    res.endTime("serverMapHours");

    res.json({ serverMapHours });
  }),
);

export default apiRouter;
