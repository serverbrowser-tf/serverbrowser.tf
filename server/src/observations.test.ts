import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import fsSync from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { gzip, gunzip } from "zlib";
import { promisify } from "util";

import { buildDataloaders, buildUpdaterService } from "./db";
import {
  archiveServerObservations,
  getArchiveCutoffUnix,
} from "./observations";
import { HydratedServerInfo } from "./types";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

function createDb() {
  const db = new Database(":memory:");
  db.run(`
CREATE TABLE maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    map VARCHAR(32) NOT NULL UNIQUE,
    CONSTRAINT idx_map UNIQUE (map)
);
CREATE TABLE servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip VARCHAR(21) NOT NULL,
    steamid VARCHAR(32) UNIQUE,
    name TEXT NOT NULL,
    keyword TEXT NOT NULL,
    region TINYINT UNSIGNED NOT NULL,
    map_id INTEGER REFERENCES maps(id),
    visibility TINYINT,
    maxPlayers TINYINT,
    last_online DATETIME,
    is_valve INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT idx_steamid UNIQUE (steamid)
);
CREATE TABLE server_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    player_count INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    map_id INTEGER REFERENCES maps(id),
    player_hours REAL,
    raw_hours REAL
);
CREATE UNIQUE INDEX idx_server_players_unique ON server_players(server_id, timestamp, map_id);
CREATE TABLE server_map_hours (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    map_id INTEGER NOT NULL,
    hours REAL NOT NULL,
    raw_hours REAL,
    date DATE NOT NULL,
    FOREIGN KEY (server_id) REFERENCES servers(id),
    FOREIGN KEY (map_id) REFERENCES maps(id)
);
CREATE UNIQUE INDEX idx_server_map_hours_unique ON server_map_hours(map_id, server_id, date);
`);
  db.run(migrationSql());
  return db;
}

function migrationSql() {
  return [
    "./migrations/010-server-observations.sql",
    "./migrations/012-observation-source-derived.sql",
  ]
    .map((file) => fsSync.readFileSync(file, "utf8"))
    .join("\n");
}

function server(overrides: Partial<HydratedServerInfo>): HydratedServerInfo {
  return {
    ip: "127.0.0.1:27015",
    server: "127.0.0.1:27015",
    steamid: "1",
    name: "Test Server",
    map: "cp_badlands",
    keywords: "",
    players: 12,
    maxPlayers: 24,
    bots: 2,
    visibility: 1,
    region: 0 as any,
    geoip: null,
    ...overrides,
  };
}

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "observations-"));
  tempDirs.push(dir);
  return dir;
}

async function readGzipCsv(filePath: string) {
  const buffer = await fs.readFile(filePath);
  return String(await gunzipAsync(buffer as any));
}

describe("server observations", () => {
  test("migration creates the table and indexes", () => {
    const db = new Database(":memory:");
    db.run(`
CREATE TABLE maps (id INTEGER PRIMARY KEY AUTOINCREMENT, map TEXT NOT NULL UNIQUE);
CREATE TABLE servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  is_valve INTEGER NOT NULL DEFAULT 0
);
`);
    db.run(migrationSql());

    const table = db
      .query<
        { name: string },
        []
      >("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'server_observations'")
      .get();
    const indexes = db
      .query<{ name: string }, []>("PRAGMA index_list(server_observations)")
      .all()
      .map((row) => row.name);
    const columns = db
      .query<{ name: string }, []>("PRAGMA table_info(server_observations)")
      .all()
      .map((row) => row.name);

    expect(table?.name).toBe("server_observations");
    expect(columns).not.toContain("source");
    expect(indexes).toContain("idx_server_observations_server_observed_at");
    expect(indexes).toContain("idx_server_observations_map_observed_at");
    expect(indexes).toContain("idx_server_observations_observed_at");
  });

  test("updater inserts exact one-row-per-server observations", async () => {
    const db = createDb();
    const updater = buildUpdaterService(db);
    const servers = [
      server({
        ip: "127.0.0.1:27015",
        server: "127.0.0.1:27015",
        steamid: "1",
      }),
      server({
        ip: "127.0.0.2:27015",
        server: "127.0.0.2:27015",
        steamid: "2",
        players: 5,
        bots: 1,
        map: "pl_upward",
      }),
    ];
    const observedAt = new Date("2026-05-22T13:14:15.900Z");

    await updater.updateServers(servers);
    await updater.updateServerObservations(servers, observedAt);

    const rows = db
      .query<{ observed_at: number; players: number; map: string }, []>(
        `
SELECT so.observed_at, so.players, m.map
FROM server_observations so
INNER JOIN maps m ON m.id = so.map_id
ORDER BY so.id
`,
      )
      .all();

    expect(rows).toEqual([
      {
        observed_at: 1_779_455_655,
        players: 10,
        map: "cp_badlands",
      },
      {
        observed_at: 1_779_455_655,
        players: 4,
        map: "pl_upward",
      },
    ]);
  });

  test("updater skips map history for servers without maps", async () => {
    const db = createDb();
    const updater = buildUpdaterService(db);
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const servers = [
      server({
        ip: "127.0.0.1:27015",
        server: "127.0.0.1:27015",
        steamid: "1",
        map: "",
      }),
    ];

    try {
      await updater.updateServers(servers);
      await updater.updateServerPlayers(
        servers,
        60,
        new Date("2026-05-22T13:14:15.900Z"),
      );
      await updater.updateServerObservations(
        servers,
        new Date("2026-05-22T13:14:15.900Z"),
      );
      await updater.updateServerMapHours(
        servers,
        60,
        new Date("2026-05-22T13:14:15.900Z"),
      );
    } finally {
      errorSpy.mockRestore();
    }

    const serverRow = db
      .query<{ map_id: number | null }, []>("SELECT map_id FROM servers")
      .get();
    const playerRow = db
      .query<{ count: number }, []>("SELECT COUNT(*) count FROM server_players")
      .get();
    const observationRow = db
      .query<
        { count: number },
        []
      >("SELECT COUNT(*) count FROM server_observations")
      .get();
    const mapHoursRow = db
      .query<
        { count: number },
        []
      >("SELECT COUNT(*) count FROM server_map_hours")
      .get();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(serverRow?.map_id).toBeNull();
    expect(playerRow?.count).toBe(0);
    expect(observationRow?.count).toBe(0);
    expect(mapHoursRow?.count).toBe(0);
  });

  test("archives previous-day rows into Sunday-Saturday gzip CSVs", async () => {
    const db = createDb();
    const updater = buildUpdaterService(db);
    const archiveDir = await createTempDir();
    const servers = [
      server({
        ip: "127.0.0.3:27015",
        server: "127.0.0.3:27015",
        steamid: "3",
        name: 'A "quoted", server',
        region: 1 as any,
      }),
    ];
    await updater.updateServers(servers);
    const serverId = await buildDataloaders(db).serverId.load("3" as any);
    const mapId = await buildDataloaders(db).mapId.load("cp_badlands");

    db.prepare(
      `
INSERT INTO server_observations (server_id, map_id, observed_at, players)
VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)
`,
    ).run(
      serverId,
      mapId,
      Date.parse("2026-05-16T16:00:00Z") / 1000,
      7,
      serverId,
      mapId,
      Date.parse("2026-05-17T16:00:00Z") / 1000,
      8,
      serverId,
      mapId,
      Date.parse("2026-05-23T14:00:00Z") / 1000,
      9,
    );

    const result = await archiveServerObservations({
      db,
      archiveDir,
      now: new Date("2026-05-23T16:00:00Z"),
    });

    expect(result.archivedRows).toBe(2);
    expect(getArchiveCutoffUnix(new Date("2026-05-23T16:00:00Z"))).toBe(
      Date.parse("2026-05-23T04:00:00Z") / 1000,
    );
    const previousWeek = await readGzipCsv(
      path.join(archiveDir, "2026-05-10_to_2026-05-16.csv.gz"),
    );
    const currentWeek = await readGzipCsv(
      path.join(archiveDir, "2026-05-17_to_2026-05-23.csv.gz"),
    );

    expect(previousWeek).toBe(
      [
        "observed_at,source,ip,name,steamid,region,map,players",
        '1778947200,community,127.0.0.3:27015,"A ""quoted"", server",3,US West,cp_badlands,7',
        "",
      ].join("\n"),
    );
    expect(currentWeek).toBe(
      [
        "observed_at,source,ip,name,steamid,region,map,players",
        '1779033600,community,127.0.0.3:27015,"A ""quoted"", server",3,US West,cp_badlands,8',
        "",
      ].join("\n"),
    );

    const remaining = db
      .query<
        { count: number },
        []
      >("SELECT COUNT(*) count FROM server_observations")
      .get();
    expect(remaining?.count).toBe(1);
  });

  test("appends to existing weekly gzip archives without another header", async () => {
    const db = createDb();
    const updater = buildUpdaterService(db);
    const archiveDir = await createTempDir();
    await updater.updateServers([
      server({
        ip: "127.0.0.4:27015",
        server: "127.0.0.4:27015",
        steamid: "4",
      }),
    ]);
    const serverId = await buildDataloaders(db).serverId.load("4" as any);
    const mapId = await buildDataloaders(db).mapId.load("cp_badlands");
    const archiveFile = path.join(
      archiveDir,
      "2026-05-17_to_2026-05-23.csv.gz",
    );
    await fs.writeFile(
      archiveFile,
      (await gzipAsync(
        "observed_at,source,ip,name,steamid,region,map,players\nold,row\n",
      )) as any,
    );
    db.prepare(
      `
INSERT INTO server_observations (server_id, map_id, observed_at, players)
VALUES (?, ?, ?, ?)
`,
    ).run(serverId, mapId, Date.parse("2026-05-18T16:00:00Z") / 1000, 11);

    await archiveServerObservations({
      db,
      archiveDir,
      now: new Date("2026-05-23T16:00:00Z"),
    });

    const csv = await readGzipCsv(archiveFile);
    expect(
      csv.match(/observed_at,source,ip,name,steamid,region,map,players/g),
    ).toHaveLength(1);
    expect(csv).toContain("old,row\n1779120000,community,127.0.0.4:27015");
  });

  test("derives archived source from server is_valve", async () => {
    const db = createDb();
    const updater = buildUpdaterService(db);
    const archiveDir = await createTempDir();
    await updater.updateServers([
      server({
        ip: "127.0.0.9:27015",
        server: "127.0.0.9:27015",
        steamid: "9",
      }),
      server({
        ip: "127.0.0.10:27015",
        server: "127.0.0.10:27015",
        steamid: "10",
        name: "Valve Matchmaking Server #10",
        keywords: "valve,hidden",
      }),
    ]);
    const dataloaders = buildDataloaders(db);
    const communityServerId = await dataloaders.serverId.load("9" as any);
    const valveServerId = await dataloaders.serverId.load("10" as any);
    const mapId = await dataloaders.mapId.load("cp_badlands");

    db.prepare(
      `
INSERT INTO server_observations (server_id, map_id, observed_at, players)
VALUES (?, ?, ?, ?), (?, ?, ?, ?)
`,
    ).run(
      communityServerId,
      mapId,
      Date.parse("2026-05-18T16:00:00Z") / 1000,
      11,
      valveServerId,
      mapId,
      Date.parse("2026-05-18T16:00:00Z") / 1000,
      22,
    );

    await archiveServerObservations({
      db,
      archiveDir,
      now: new Date("2026-05-23T16:00:00Z"),
    });

    const csv = await readGzipCsv(
      path.join(archiveDir, "2026-05-17_to_2026-05-23.csv.gz"),
    );
    expect(csv).toContain("1779120000,community,127.0.0.9:27015");
    expect(csv).toContain("1779120000,valve,127.0.0.10:27015");
  });

  test("archives unknown region numbers as empty CSV fields", async () => {
    const db = createDb();
    const updater = buildUpdaterService(db);
    const archiveDir = await createTempDir();
    await updater.updateServers([
      server({
        ip: "127.0.0.6:27015",
        server: "127.0.0.6:27015",
        steamid: "6",
        region: 255 as any,
      }),
    ]);
    const serverId = await buildDataloaders(db).serverId.load("6" as any);
    const mapId = await buildDataloaders(db).mapId.load("cp_badlands");

    db.prepare(
      `
INSERT INTO server_observations (server_id, map_id, observed_at, players)
VALUES (?, ?, ?, ?)
`,
    ).run(serverId, mapId, Date.parse("2026-05-18T16:00:00Z") / 1000, 11);

    await archiveServerObservations({
      db,
      archiveDir,
      now: new Date("2026-05-23T16:00:00Z"),
    });

    const csv = await readGzipCsv(
      path.join(archiveDir, "2026-05-17_to_2026-05-23.csv.gz"),
    );
    expect(csv).toContain(
      "1779120000,community,127.0.0.6:27015,Test Server,6,,cp_badlands,11",
    );
  });

  test("orders archived rows by steamid", async () => {
    const db = createDb();
    const updater = buildUpdaterService(db);
    const archiveDir = await createTempDir();
    await updater.updateServers([
      server({
        ip: "127.0.0.7:27015",
        server: "127.0.0.7:27015",
        steamid: "2",
      }),
      server({
        ip: "127.0.0.8:27015",
        server: "127.0.0.8:27015",
        steamid: "1",
      }),
    ]);
    const dataloaders = buildDataloaders(db);
    const serverId2 = await dataloaders.serverId.load("2" as any);
    const serverId1 = await dataloaders.serverId.load("1" as any);
    const mapId = await dataloaders.mapId.load("cp_badlands");

    db.prepare(
      `
INSERT INTO server_observations (server_id, map_id, observed_at, players)
VALUES (?, ?, ?, ?), (?, ?, ?, ?)
`,
    ).run(
      serverId2,
      mapId,
      Date.parse("2026-05-18T16:00:00Z") / 1000,
      22,
      serverId1,
      mapId,
      Date.parse("2026-05-18T16:00:00Z") / 1000,
      11,
    );

    await archiveServerObservations({
      db,
      archiveDir,
      now: new Date("2026-05-23T16:00:00Z"),
    });

    const csv = await readGzipCsv(
      path.join(archiveDir, "2026-05-17_to_2026-05-23.csv.gz"),
    );
    const lines = csv.trimEnd().split("\n");
    expect(lines[1]).toContain(",1,US East,");
    expect(lines[2]).toContain(",2,US East,");
  });

  test("keeps rows when archive write fails", async () => {
    const db = createDb();
    const updater = buildUpdaterService(db);
    const archiveDir = await createTempDir();
    await updater.updateServers([
      server({
        ip: "127.0.0.5:27015",
        server: "127.0.0.5:27015",
        steamid: "5",
      }),
    ]);
    const serverId = await buildDataloaders(db).serverId.load("5" as any);
    const mapId = await buildDataloaders(db).mapId.load("cp_badlands");
    db.prepare(
      `
INSERT INTO server_observations (server_id, map_id, observed_at, players)
VALUES (?, ?, ?, ?)
`,
    ).run(serverId, mapId, Date.parse("2026-05-18T16:00:00Z") / 1000, 11);
    await fs.writeFile(
      path.join(archiveDir, "2026-05-17_to_2026-05-23.csv.gz"),
      "not a directory",
    );

    await expect(
      archiveServerObservations({
        db,
        archiveDir: path.join(archiveDir, "2026-05-17_to_2026-05-23.csv.gz"),
        now: new Date("2026-05-23T16:00:00Z"),
      }),
    ).rejects.toThrow();
    const remaining = db
      .query<
        { count: number },
        []
      >("SELECT COUNT(*) count FROM server_observations")
      .get();
    expect(remaining?.count).toBe(1);
  });
});
