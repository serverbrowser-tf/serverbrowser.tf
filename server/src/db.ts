import { Database } from "bun:sqlite";
import DataLoader from "dataloader";
import fs from "fs/promises";
import geoIp2 from "geoip-lite2";
import { chunk, memoize } from "lodash";
import QuickLRU from "quick-lru";

import { HydratedServerInfo, ServerInfo, SteamId, UnhydratedServerInfo } from "./types";
import { mapUpsert, scheduleDaily } from "./utils";

interface ServerRow {
  id: number;
  ip: string;
  steamid: string | null;
  name: string;
  keyword: string;
  region: number;
  visiblity: 0 | 1 | null;
  maxPlayers: number | null;
}

const CACHE_MAX_AGE = 1 * 60 * 1000;

async function migrate(db: Database) {
  const { user_version: dbVersion } = db
    .prepare("PRAGMA user_version")
    .get() as { user_version: number };
  const migrationFiles = (await fs.readdir("./migrations")).filter((el) =>
    el.endsWith(".sql"),
  );

  if (migrationFiles.length === dbVersion) {
    return;
  }

  const runMigration = db.transaction((sql: string) => {
    db.run(sql);
  });

  migrationFiles.sort();
  for (let i = dbVersion; i < migrationFiles.length; i++) {
    const file = (
      await fs.readFile(`./migrations/${migrationFiles[i]}`)
    ).toString("utf8");

    runMigration(file);
  }
  db.run(`PRAGMA user_version = ${Math.max(dbVersion, migrationFiles.length)}`);
}

export var db: Database = getDb();
export function getDb(): Database {
  if (db == null) {
    db = new Database("./database.sqlite", {
      create: true,
    });
    migrate(db);
    db.run(`PRAGMA optimize=0x10002`);
  }

  return db;
}

export const scheduleDbOptimize = () => {
  scheduleDaily(async () => {
    db.run(`PRAGMA optimize`);
  });
};

const countChar = (str: string, char: string) => {
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === char) {
      count += 1;
    }
  }
  return count;
};

const buildQueryBindings = (
  insertQuery: string,
  columns: number | string,
  rows: number,
) => {
  let bindings: string;
  if (typeof columns === "string") {
    bindings = columns;
  } else {
    bindings = "(" + Array(columns).fill("?").join(",") + ")";
  }
  const rowsBinding = Array(rows).fill(bindings).join(",");

  console.assert(
    countChar(bindings, "?") * rows <= 500,
    `using too many bindings (${
      countChar(bindings, "?") * rows
    }). shit might get fucked. Query: ${insertQuery}`,
  );

  return insertQuery.replace("{}", rowsBinding);
};

function resetSequenceId(db: Database, table: string) {
  const updateSequenceId = `
UPDATE sqlite_sequence SET seq = (
    SELECT MAX(id) FROM {}
) WHERE name = '{}';
`;
  const query = db.query(updateSequenceId.replaceAll("{}", table));
  query.run();
}

export const buildDataloaders = memoize(function buildDataloaders(
  db: Database,
) {
  const serverId = new DataLoader<SteamId, number>(
    async function queryServerIds(steamids) {
      const queryStr = `
SELECT steamid, id FROM servers WHERE steamid in {}
`;
      const query = db.prepare<{ steamid: string; id: number }, string[]>(
        buildQueryBindings(queryStr, steamids.length, 1),
      );

      const recordsBySteamId: Record<string, number> = {};
      for (const row of query.iterate(...steamids)) {
        recordsBySteamId[row.steamid] = row.id;
      }

      return steamids.map(
        (steamid) =>
          recordsBySteamId[steamid] ??
          new Error(`Could not find steamid ${steamid}`),
      );
    },
    {
      cacheMap: new QuickLRU({ maxSize: 1000 }),
      maxBatchSize: 500,
    },
  );

  const serverIdByIp = new DataLoader<string, number>(
    async function queryServerIds(ips) {
      const queryStr = `
SELECT ip, id FROM servers WHERE ip in {}
`;
      const query = db.prepare<{ ip: string; id: number }, string[]>(
        buildQueryBindings(queryStr, ips.length, 1),
      );

      const recordsByIp: Record<string, number> = {};
      for (const row of query.iterate(...ips)) {
        recordsByIp[row.ip] = row.id;
      }

      return ips.map(
        (ip) => recordsByIp[ip] ?? new Error(`Could not find ip ${ip}`),
      );
    },
    {
      cacheMap: new QuickLRU({ maxSize: 1000 }),
      maxBatchSize: 500,
    },
  );

  const mapId = new DataLoader<string, number>(
    async function queryMapIds(maps) {
      const queryStr = `
SELECT map, id FROM maps WHERE map in {}
`;

      const query = db.prepare<{ map: string; id: number }, string[]>(
        buildQueryBindings(queryStr, maps.length, 1),
      );

      const recordsByMap: Record<string, number> = {};
      for (const row of query.iterate(...maps)) {
        recordsByMap[row.map] = row.id;
      }

      return maps.map(
        (map) => recordsByMap[map] ?? new Error(`Could not find map ${map}`),
      );
    },
    {
      cacheMap: new QuickLRU({ maxSize: 1000 }),
      maxBatchSize: 500,
    },
  );

  type MapHourResult = [string, number][];
  const mapHours = new DataLoader<SteamId, MapHourResult>(
    async function queryServerDetails(steamids) {
      const mapHoursQueryStr = `
    SELECT m.map,
           ROUND(SUM(smh.hours), 1) total_hours
    FROM servers s
    JOIN server_map_hours smh ON s.id = smh.server_id
    JOIN maps m ON m.id = smh.map_id
    WHERE s.steamid = ?
    AND s.last_online >= CAST(strftime('%s', date('now', '-28 days')) AS INTEGER)
    AND smh.date >= date('now', '-28 days')
    GROUP BY smh.map_id
    ORDER BY total_hours DESC
`;
      const result: Array<MapHourResult> = [];
      const mapHoursQuery = db.query<
        { map: string; total_hours: number },
        string[]
      >(mapHoursQueryStr);

      for (const steamid of steamids) {
        let steamidResult: MapHourResult = [];
        for (const row of mapHoursQuery.iterate(steamid)) {
          steamidResult.push([row.map, row.total_hours]);
        }
        result.push(steamidResult);
      }

      return result;
    },
    {
      cacheMap: new QuickLRU({ maxSize: 100, maxAge: CACHE_MAX_AGE }),
    },
  );

  type PlayerCountResult = Array<{ player_count: number; timestamp: number }>;
  const playerCount = new DataLoader<SteamId, PlayerCountResult>(
    async function queryServerDetails(steamids) {
      const playerCountQueryStr = `
SELECT s.steamid,
       MAX(sp.player_count) player_count,
       sp.timestamp
FROM server_players sp
INNER JOIN servers s ON s.id = sp.server_id
WHERE s.steamid IN {}
AND s.last_online >= CAST(strftime('%s', date('now', '-28 days')) AS INTEGER)
AND sp.timestamp >= CAST(strftime('%s', date('now', '-28 days')) AS INTEGER)
GROUP BY sp.server_id, sp.timestamp
ORDER BY s.steamid, sp.timestamp
`;
      const playerCounts = db.prepare<
        { steamid: string; player_count: number; timestamp: number },
        string[]
      >(buildQueryBindings(playerCountQueryStr, steamids.length, 1));

      const result: Record<string, PlayerCountResult> = Object.fromEntries(
        steamids.map((steamid) => [steamid, []]),
      );
      for (const playerCount of playerCounts.iterate(...steamids)) {
        result[playerCount.steamid].push({
          player_count: playerCount.player_count,
          timestamp: playerCount.timestamp,
        });
      }

      return Object.values(result);
    },
    {
      cacheMap: new QuickLRU({ maxSize: 100, maxAge: CACHE_MAX_AGE }),
    },
  );

  type PlayerCountWithMapsResult = Array<{
    map: string;
    player_count: number;
    player_hours: number;
    raw_hours: number;
    timestamp: number;
  }>;
  const playerCountWithMaps = new DataLoader<SteamId, PlayerCountResult>(
    async function queryServerDetails(steamids) {
      const playerCountQueryStr = `
SELECT s.steamid,
       s.steamid,
       m.map,
       sp.player_count,
       ROUND(sp.player_hours, 3) player_hours,
       ROUND(sp.raw_hours, 3) raw_hours,
       sp.timestamp
FROM server_players sp
INNER JOIN servers s ON s.id = sp.server_id
INNER JOIN maps m on m.id = sp.map_id
WHERE s.steamid in {}
AND s.last_online >= CAST(strftime('%s', date('now', '-28 days')) AS INTEGER)
AND sp.timestamp >= CAST(strftime('%s', date('now', '-28 days')) AS INTEGER)
ORDER BY s.steamid, sp.timestamp
`;
      const playerCounts = db.prepare<
        PlayerCountWithMapsResult[number] & { steamid: string },
        string[]
      >(buildQueryBindings(playerCountQueryStr, steamids.length, 1));

      const result: Record<string, PlayerCountWithMapsResult> =
        Object.fromEntries(steamids.map((steamid) => [steamid, []]));
      for (const playerCount of playerCounts.iterate(...steamids)) {
        const { steamid, ...rest } = playerCount;
        result[steamid].push(rest);
      }

      return Object.values(result);
    },
    {
      cacheMap: new QuickLRU({ maxSize: 100, maxAge: CACHE_MAX_AGE }),
    },
  );

  interface ServerMapHours {
    map: string;
    date: string;
    hours: number;
  }
  const serverMapHours = new DataLoader<SteamId, ServerMapHours[]>(
    async (steamids) => {
      const serverMapHoursQueryStr = `
SELECT s.steamid,
       m.map,
       smh.hours,
       smh.date
FROM servers s
INNER JOIN server_map_hours smh on smh.server_id = s.id
INNER JOIN maps m ON m.id = smh.map_id
WHERE s.steamid in ({})
AND s.last_online >= CAST(strftime('%s', date('now', '-28 days')) AS INTEGER)
AND smh.date >= date('now', '-28 days')
ORDER BY s.steamid, smh.date ASC
`;
      const serverMapHoursQuery = db.query<
        ServerMapHours & { steamid: string },
        string[]
      >(buildQueryBindings(serverMapHoursQueryStr, steamids.length, 1));

      const result = new Map<string, ServerMapHours[]>();
      for (const record of serverMapHoursQuery.all(...steamids)) {
        mapUpsert(result, record.steamid, {
          insert() {
            return [record];
          },
          update(old) {
            old.push(record);
            return old;
          },
        });
      }
      return steamids.map((steamid) => result.get(steamid) ?? []);
    },
  );

  const firstRecordedDate = new DataLoader<SteamId, number>(
    async (steamids) => {
      const firstRecordedDateQueryStr = `
SELECT s.steamid,
       MIN(sp.timestamp) AS first_timestamp
FROM server_players sp
INNER JOIN servers s on s.id = sp.server_id
WHERE s.steamid in ({})
GROUP BY sp.server_id
ORDER BY sp.server_id;
`;
      const query = db.query<
        { steamid: string; first_timestamp: number },
        string[]
      >(buildQueryBindings(firstRecordedDateQueryStr, steamids.length, 1));

      const mapping = new Map<string, number>();
      for (const { steamid, first_timestamp } of query.all(...steamids)) {
        mapping.set(steamid, first_timestamp);
      }

      return steamids.map(
        (steamid) =>
          mapping.get(steamid) ??
          new Error(`Could not find steamid ${steamid}`),
      );
    },
  );

  interface Location {
    long: number;
    lat: number;
  }

  const serverLocations = new DataLoader<
    string,
    {
      long: number;
      lat: number;
    } | null
  >(
    // NEEDS TO BE ip
    async function queryServerLocations(ips) {
      const map = new Map<string, Location>();
      const queryStr = `
SELECT ip, long, lat FROM server_locations WHERE ip in {}
`;
      const locations = db.prepare<{ ip: string } & Location, string[]>(
        buildQueryBindings(queryStr, ips.length, 1),
      );

      for (const server of locations.iterate(...ips)) {
        map.set(server.ip, server);
      }

      const inserts: (string | number)[] = [];

      const results = ips.map((ip) => {
        if (map.has(ip)) {
          return map.get(ip)!;
        }

        const data = geoIp2.lookup(ip);
        const long = data?.ll[0];
        const lat = data?.ll[1];
        if (long != null && lat != null) {
          inserts.push(ip, long, lat);
          return { long, lat };
        }
        return null;
      });

      if (inserts.length) {
        const queryStr = `
  INSERT OR IGNORE INTO server_locations (ip, long, lat)
  VALUES {}
  `;
        const insertQuery = db.prepare(
          buildQueryBindings(queryStr, 3, inserts.length / 3),
        );
        insertQuery.run(...inserts);
      }

      return results;
    },
    {
      cacheMap: new QuickLRU({ maxSize: 1500 }),
      maxBatchSize: 200,
    },
  );

  const servers = new DataLoader<string, UnhydratedServerInfo>(
    async (ips) => {
      const queryStr = `
    SELECT
      ip, steamid, name, keyword, map, visibility, maxPlayers, region
    FROM servers s 
    LEFT JOIN maps m on m.id = s.map_id
    WHERE ip in ({})`;
      type Result = Pick<
        ServerRow,
        "ip" | "steamid" | "name" | "keyword" | "visiblity" | "maxPlayers" | "region"
      > & { map?: string };
      const map = new Map<string, Result>();
      const serverLocationsPromise = serverLocations.loadMany(
        ips.map((ip) => ip.split(":")[0]),
      );
      const query = db.prepare<Result, string[]>(
        buildQueryBindings(queryStr, 1, ips.length),
      );

      for (const result of query.iterate(...ips)) {
        map.set(result.ip, result);
      }

      const geoips = await serverLocationsPromise;
      return ips.map((ip, i): UnhydratedServerInfo | Error => {
        const server = map.get(ip);
        if (server == null) {
          return new Error(`Could not find ip ${ip}`);
        }
        const geoip = geoips[i];

        return {
          ...server,
          maxPlayers: server.maxPlayers ?? undefined,
          server: server.ip,
          steamid: server.steamid ?? undefined,
          geoip:
            geoip instanceof Error || geoip == null
              ? null
              : [geoip.long, geoip.lat],
        };
      });
    },
    {
      cacheMap: new QuickLRU({ maxSize: 100, maxAge: CACHE_MAX_AGE }),
      maxBatchSize: 500,
    },
  );

  type MapServersResult = Array<{
    ip: string;
    name: string;
    hours: number;
    lastPlayed: Date;
    visibility: number;
  }>;
  const mapServers = new DataLoader<string, MapServersResult>(
    async (mapNames) => {
      const mapIds = await mapId.loadMany(mapNames);
      const queryStr = `
    SELECT smh.map_id, s.ip, s.name, s.visibility, ROUND(SUM(smh.hours), 1) hours, MAX(smh.date) lastPlayed
    FROM server_map_hours smh
    INNER JOIN servers s ON s.id = smh.server_id
    WHERE smh.map_id in ({})
    AND s.last_online >= CAST(strftime('%s', date('now', '-3 days')) AS INTEGER)
    AND smh.date >= date('now', '-28 days')
    GROUP BY smh.map_id, smh.server_id
    ORDER BY ip asc
    `;
      const mapping = new Map<number, MapServersResult>();
      const result = mapIds.map((mapId) => {
        if (mapId instanceof Error) {
          return mapId;
        }
        const result: MapServersResult = [];
        mapping.set(mapId, result);
        return result;
      });
      if (mapping.size === 0) {
        return result;
      }
      const query = db.query<
        {
          map_id: number;
          ip: string;
          visibility: number;
          name: string;
          hours: number;
          lastPlayed: Date;
        },
        number[]
      >(buildQueryBindings(queryStr, mapping.size, 1));
      for (const row of query.iterate(...mapping.keys())) {
        mapping.get(row.map_id)!.push({
          ip: row.ip,
          name: row.name,
          hours: row.hours,
          lastPlayed: row.lastPlayed,
          visibility: row.visibility,
        });
      }
      return result;
    },
    {
      cacheMap: new QuickLRU({ maxSize: 100, maxAge: CACHE_MAX_AGE }),
      maxBatchSize: 500,
    },
  );

  return {
    serverId,
    serverIdByIp,
    mapId,
    mapHours,
    playerCount,
    playerCountWithMaps,
    serverMapHours,
    firstRecordedDate,
    servers,
    serverLocations,
    mapServers,
    blacklist() {
      const queryStr = `
SELECT servers.ip, blacklist.reason
FROM servers
INNER JOIN blacklist on blacklist.server_id = servers.id
order by blacklist.reason
`;
      const query = db.prepare<{ ip: string; reason: string }, []>(queryStr);
      const blacklistByIp = new Map<string, string>();

      for (const { ip, reason } of query.iterate()) {
        mapUpsert(blacklistByIp, ip, {
          insert() {
            return reason;
          },
        });
      }

      return blacklistByIp;
    },
    adminView() {
      const queryStr = `
SELECT s.*, m.map, latest.hours
FROM servers s
LEFT JOIN blacklist ON s.id = blacklist.server_id
LEFT JOIN server_map_hours smh ON s.id = smh.server_id
INNER JOIN (
    SELECT server_id, MAX(id) as max_id, ROUND(SUM(hours), 1) as hours
    FROM server_map_hours
    GROUP BY server_id
) latest ON smh.server_id = latest.server_id 
    AND smh.id = latest.max_id
LEFT JOIN maps m ON m.id = smh.map_id
WHERE blacklist.server_id IS NULL
AND s.last_online >= CAST(strftime('%s', date('now', '-3 days')) AS INTEGER)
;
`;
      const query = db.prepare<ServerRow & { hours: number }, []>(queryStr);

      const rows = query.all();
      for (const row of rows) {
        const typed: UnhydratedServerInfo = row as any;
        typed.server = row.ip;
        typed.steamid = row.steamid ?? undefined;
        typed.keywords = row.keyword;
      }

      return rows as unknown as UnhydratedServerInfo[];
    },
    listMaps() {
      const queryStr = `SELECT
      m.map, ROUND(SUM(smh.hours), 1) hours, COUNT(distinct smh.server_id) servers
      FROM server_map_hours smh
      INNER JOIN maps m ON m.id = smh.map_id
      INNER JOIN servers s on s.id = smh.server_id
      WHERE s.last_online >= CAST(strftime('%s', date('now', '-3 days')) AS INTEGER)
      AND smh.date >= date('now', '-28 days')
      GROUP BY smh.map_id
      ORDER BY map asc`;
      const query = db.query<
        { map: string; hours: number; servers: number },
        []
      >(queryStr);

      return query.iterate();
    },
    async allServers() {
      const queryStr = `
      SELECT s.ip,
             s.steamid,
             s.name,
             s.keyword as keywords,
             s.region,
             s.visibility,
             s.maxPlayers,
             m.map,
             bl.reason,
             sa.active_hours
      FROM servers s
      LEFT JOIN maps m ON m.id = s.map_id
      LEFT JOIN blacklist bl ON bl.server_id = s.id
      LEFT JOIN (
        SELECT sp.server_id, (COUNT(DISTINCT sp.timestamp) * 0.5) active_hours
        FROM server_players sp
        WHERE sp.player_count >= 10
        AND sp.timestamp >= CAST(strftime('%s', date('now', '-28 days')) AS INTEGER)
        GROUP BY sp.server_id
      ) sa on sa.server_id = s.id
      WHERE s.last_online >= CAST(strftime('%s', date('now', '-3 days')) AS INTEGER)
      GROUP BY s.id
      `;

      const query = db.query<
        {
          ip: string;
          steamid: string | null;
          name: string;
          keywords: string;
          region: number;
          visibility: 0 | 1;
          maxPlayers: number;
          map: string;
          reason: string | null;
          active_hours: number;
        },
        []
      >(queryStr);

      const reasonMapping = new Map<
        string | null,
        Map<string, UnhydratedServerInfo>
      >();
      const ipMapping = new Map<string, UnhydratedServerInfo>();
      const steamidMapping = new Map<string, UnhydratedServerInfo>();
      const ips: string[] = [];

      for (const row of query.iterate()) {
        const server = {
          ip: row.ip,
          steamid: row.steamid ?? undefined,
          server: row.ip,
          name: row.name,
          map: row.map,
          keywords: row.keywords,
          players: 0,
          maxPlayers: row.maxPlayers,
          visibility: row.visibility,
          regions: row.region,
          region: row.region,
          geoip: null,
          active_hours: row.active_hours,
        };
        ips.push(row.ip);
        ipMapping.set(row.ip, server);
        if (row.steamid) {
          steamidMapping.set(row.steamid, server);
        }
        mapUpsert(reasonMapping, row.reason, {
          insert() {
            return new Map([[server.ip, server]]);
          },
          update(servers) {
            servers.set(server.ip, server);
            return servers;
          },
        });
      }

      const geoips = await serverLocations.loadMany(
        ips.map((ip) => ip.split(":")[0]),
      );
      for (let i = 0; i < ips.length; i++) {
        const ip = ips[i];
        const geoip = geoips[i];

        if (geoip instanceof Error || geoip == null) {
        } else {
          ipMapping.get(ip)!.geoip = [geoip.long, geoip.lat];
        }
      }

      return { reasonMapping, ipMapping, steamidMapping };
    },
  };
});
buildDataloaders.cache = new WeakMap();

export const buildUpdaterService = memoize(function buildUpdaterService(
  db: Database,
) {
  const dataloaders = buildDataloaders(db);
  const CHUNKED = 100;
  const isValidMap = (map: unknown): map is string =>
    typeof map === "string" && map.length > 0;

  const loadMapIdsForServers = async (servers: HydratedServerInfo[]) => {
    const maps = servers.map((server) =>
      isValidMap(server.map) ? server.map : null,
    );
    const validMaps = maps.filter((map): map is string => map != null);
    if (validMaps.length) {
      upsertMaps(validMaps);
    }

    const loadedMapIds = validMaps.length
      ? await dataloaders.mapId.loadMany(validMaps)
      : [];
    let loadedMapIdIndex = 0;

    return maps.map((map) => {
      if (map == null) {
        return new Error("Missing map");
      }
      const mapId = loadedMapIds[loadedMapIdIndex];
      loadedMapIdIndex += 1;
      return mapId;
    });
  };

  const resolveServerId = async (server: HydratedServerInfo) => {
    if (server.steamid) {
      return dataloaders.serverId.load(server.steamid as SteamId);
    }
    return dataloaders.serverIdByIp.load(server.ip);
  };
  const upsertMaps = (maps: string[]) => {
    db.transaction(() => {
      const insertQueryStr = `
INSERT OR IGNORE INTO maps (map)
VALUES {}
`;
      for (const chunked of chunk(maps, 500)) {
        const insertQuery = db.prepare(
          buildQueryBindings(insertQueryStr, 1, chunked.length),
        );
        insertQuery.run(...chunked);
      }
      resetSequenceId(db, "maps");
    })();
  };
  return {
    async updateServers(servers: HydratedServerInfo[]) {
      const mapIds = await loadMapIdsForServers(servers);
      const valuesWithSteamId: Array<(string | number | null)[]> = [];
      const valuesForIpBackfill: Array<(string | number | null)[]> = [];
      const steamids = servers
        .map((server) => server.steamid)
        .filter((steamid): steamid is string => !!steamid);

      let existingSteamids = new Set<string>();
      if (steamids.length) {
        const queryStr = `
SELECT steamid FROM servers WHERE steamid in {}
`;
        for (const chunked of chunk(steamids, 500)) {
          const query = db.prepare<{ steamid: string }, string[]>(
            buildQueryBindings(queryStr, chunked.length, 1),
          );
          for (const row of query.iterate(...chunked)) {
            existingSteamids.add(row.steamid);
          }
        }
      }

      for (let i = 0; i < servers.length; i++) {
        const server = servers[i];
        if (!server.steamid) {
          continue;
        }
        const mapId = mapIds[i];
        const row: Array<string | number | null> = [
          server.server,
          server.steamid,
          server.name,
          server.keywords ?? "",
          Number(server.region),
          mapId instanceof Error ? null : mapId,
          server.visibility,
          server.maxPlayers,
        ];
        if (existingSteamids.has(server.steamid)) {
          valuesWithSteamId.push(row);
        } else {
          valuesForIpBackfill.push(row);
        }
      }

      const queryBySteamId = `
INSERT INTO servers (ip, steamid, name, keyword, region, map_id, visibility, maxPlayers)
VALUES {}
ON CONFLICT(steamid) DO UPDATE SET
    ip = excluded.ip,
    name = excluded.name,
    keyword = excluded.keyword,
    region = excluded.region,
    map_id = excluded.map_id,
    visibility = excluded.visibility,
    maxPlayers = excluded.maxPlayers;
`;
      if (valuesWithSteamId.length) {
        for (const chunked of chunk(valuesWithSteamId, CHUNKED / 2)) {
          db.transaction(() => {
            const prepared = db.prepare(
              buildQueryBindings(queryBySteamId, 8, chunked.length),
            );
            prepared.run(...chunked.flat());
            resetSequenceId(db, "servers");
          })();
        }
      }

      const backfillByIpWhenNull = db.prepare(`
UPDATE servers
SET steamid = ?,
    name = ?,
    keyword = ?,
    region = ?,
    map_id = ?,
    visibility = ?,
    maxPlayers = ?
WHERE ip = ?
  AND steamid IS NULL;
`);
      const queryInsertBySteamId = `
INSERT OR IGNORE INTO servers (ip, steamid, name, keyword, region, map_id, visibility, maxPlayers)
VALUES {}
`;
      if (valuesForIpBackfill.length) {
        for (const chunked of chunk(valuesForIpBackfill, CHUNKED / 2)) {
          db.transaction(() => {
            for (const row of chunked) {
              backfillByIpWhenNull.run(
                row[1],
                row[2],
                row[3],
                row[4],
                row[5],
                row[6],
                row[7],
                row[0],
              );
            }

            const prepared = db.prepare(
              buildQueryBindings(queryInsertBySteamId, 8, chunked.length),
            );
            prepared.run(...chunked.flat());
            resetSequenceId(db, "servers");
          })();
        }
      }
    },
    async updateServerPlayers(
      servers: HydratedServerInfo[],
      seconds: number,
      queryTime: Date,
    ) {
      const [serverIds, mapIds] = await Promise.all([
        Promise.all(servers.map(resolveServerId)),
        loadMapIdsForServers(servers),
      ]);

      const hours = seconds / 60 / 60;
      let normalizedTime = Math.floor(Number(queryTime) / 1000);
      normalizedTime -= normalizedTime % (60 * 30);
      const values = servers
        .map((server, i) => [
          serverIds[i],
          mapIds[i],
          normalizedTime,
          servers[i].players - servers[i].bots,
          hours * (server.players - server.bots),
          hours,
        ])
        .filter((info): info is number[] => {
          if (info[0] instanceof Error) {
            console.error("updateServerPlayers", info[0]);
            return false;
          }
          if (info[1] instanceof Error) {
            console.error("updateServerPlayers", info[1]);
            return false;
          }
          return true;
        });

      const queryStr = `
INSERT INTO server_players (server_id, map_id, timestamp, player_count, player_hours, raw_hours)
VALUES {}
ON CONFLICT(server_id, timestamp, map_id) DO UPDATE SET
    player_count = MAX(server_players.player_count, excluded.player_count),
    player_hours = server_players.player_hours + excluded.player_hours,
    raw_hours = server_players.raw_hours + excluded.raw_hours;
`;
      for (const chunked of chunk(values, Math.floor(400 / 6))) {
        db.transaction(() => {
          const prepared = db.prepare(
            buildQueryBindings(queryStr, 6, chunked.length),
          );
          prepared.run(...chunked.flat());
          resetSequenceId(db, "server_players");
        })();
      }
    },
    async updateServerMapHours(
      servers: HydratedServerInfo[],
      seconds: number,
      date: Date,
    ) {
      const [serverIds, mapIds] = await Promise.all([
        Promise.all(servers.map(resolveServerId)),
        loadMapIdsForServers(servers),
      ]);

      const hours = seconds / 60 / 60;
      const values = servers
        .map((server, i) => [
          serverIds[i],
          mapIds[i],
          hours * (server.players - server.bots),
          hours,
          Math.floor(+date / 1000),
        ])
        .filter((info): info is number[] => {
          if (info[0] instanceof Error) {
            console.error("updateServerMapHours", info[0]);
            return false;
          }
          if (info[1] instanceof Error) {
            console.error("updateServerMapHours", info[1]);
            return false;
          }
          return true;
        });

      const queryStr = `
INSERT INTO server_map_hours (server_id, map_id, hours, raw_hours, date)
VALUES {}
ON CONFLICT(map_id, server_id, date) DO UPDATE SET
    hours = server_map_hours.hours + excluded.hours,
    raw_hours = server_map_hours.raw_hours + excluded.raw_hours;
`;

      for (const chunked of chunk(values, CHUNKED)) {
        db.transaction(() => {
          const prepared = db.prepare(
            buildQueryBindings(
              queryStr,
              '(?, ?, ?, ?, date(?, "unixepoch", "start of day"))',
              chunked.length,
            ),
          );
          prepared.run(...chunked.flat());
          resetSequenceId(db, "server_map_hours");
        })();
      }
    },
    async updateBlacklist(ip: string, reason: string) {
      const queryStr = `
INSERT INTO blacklist (server_id, reason)
VALUES (?, ?)
ON CONFLICT(server_id) DO UPDATE SET
    reason = excluded.reason;
`;
      const serverId = await dataloaders.serverIdByIp.load(ip);

      const blacklist = db.query(queryStr);
      blacklist.run(serverId, reason);
    },
    async deleteServerFromBlacklist(ip: string) {
      const queryStr = `DELETE FROM blacklist WHERE server_id = ?`;

      try {
        const serverId = await dataloaders.serverIdByIp.load(ip);
        const query = await db.query(queryStr);
        query.run(serverId);
      } catch {}
    },
    updateLastOnlineByIp(ips: string[]) {
      const queryStr = `
UPDATE servers 
SET last_online = strftime('%s', 'now')
WHERE ip IN {};
`;
      for (const chunked of chunk(ips, 500)) {
        const query = db.prepare(
          buildQueryBindings(queryStr, chunked.length, 1),
        );
        query.run(...chunked);
      }
    },
    updateLastOnlineBySteamId(steamids: string[]) {
      const queryStr = `
UPDATE servers 
SET last_online = strftime('%s', 'now')
WHERE steamid IN {};
`;
      for (const chunked of chunk(steamids, 500)) {
        const query = db.prepare(
          buildQueryBindings(queryStr, chunked.length, 1),
        );
        query.run(...chunked);
      }
    },
    updateRetardedDipshitServers(retardedDipshitServers: ServerInfo[]) {
      let grouped: Record<
        string,
        {
          totalPorts: number;
          name: string;
        }
      > = {};

      for (const server of retardedDipshitServers) {
        const key = server.ip.split(":")[0];
        if (grouped[key]) {
          grouped[key].totalPorts += 1;
        } else {
          grouped[key] = {
            totalPorts: 1,
            name: server.name,
          };
        }
      }

      const retardedDipshitQuery = `
INSERT INTO banned_ip (ip, last_total_ports, last_name)
VALUES {}
ON CONFLICT(server_id) DO UPDATE SET
    last_total_ports = excluded.last_total_ports,
    last_name = excluded.last_name,
    `;
    },
  };
});
buildUpdaterService.cache = new WeakMap();
