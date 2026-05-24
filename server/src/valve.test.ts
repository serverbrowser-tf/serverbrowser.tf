import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import fs from "fs";

import { buildDataloaders, buildUpdaterService } from "./db";
import type { HydratedServerInfo } from "./types";

function migrationSql() {
  return fs.readFileSync("./migrations/011-valve-servers.sql", "utf8");
}

function createDb() {
  const db = new Database(":memory:");
  db.run(`
CREATE TABLE maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    map TEXT NOT NULL UNIQUE
);
CREATE TABLE servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    steamid TEXT UNIQUE,
    name TEXT NOT NULL,
    keyword TEXT NOT NULL,
    region INTEGER NOT NULL,
    map_id INTEGER REFERENCES maps(id),
    visibility INTEGER,
    maxPlayers INTEGER,
    last_online INTEGER,
    is_valve INTEGER NOT NULL DEFAULT 0
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
`);
  return db;
}

function server(overrides: Partial<HydratedServerInfo>): HydratedServerInfo {
  return {
    ip: "127.0.0.1:27015",
    steamid: "1",
    server: "127.0.0.1:27015",
    name: "Test Server",
    map: "cp_badlands",
    keywords: "",
    players: 12,
    maxPlayers: 24,
    bots: 0,
    visibility: 0,
    region: 0 as any,
    geoip: null,
    ...overrides,
  };
}

describe("Valve server storage and analytics", () => {
  test("migration adds and backfills is_valve", () => {
    const db = new Database(":memory:");
    db.run(`
CREATE TABLE servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    name TEXT NOT NULL,
    keyword TEXT NOT NULL,
    region INTEGER NOT NULL
);
INSERT INTO servers (ip, name, keyword, region)
VALUES
  ('127.0.0.1:27015', 'Valve Matchmaking Server #1', 'ctf,valve,hidden', 0),
  ('127.0.0.2:27015', 'Valve Matchmaking Server #2', 'valve', 0),
  ('127.0.0.3:27015', 'Community', 'valve,hidden', 0);
`);

    db.run(migrationSql());

    const columns = db
      .query<{ name: string }, []>("PRAGMA table_info(servers)")
      .all();
    const rows = db
      .query<
        { ip: string; is_valve: 0 | 1 },
        []
      >("SELECT ip, is_valve FROM servers ORDER BY ip")
      .all();

    expect(columns.map((column) => column.name)).toContain("is_valve");
    expect(rows).toEqual([
      { ip: "127.0.0.1:27015", is_valve: 1 },
      { ip: "127.0.0.2:27015", is_valve: 0 },
      { ip: "127.0.0.3:27015", is_valve: 0 },
    ]);
  });

  test("updater persists the Valve marker from keywords", async () => {
    const db = createDb();
    const updater = buildUpdaterService(db);

    await updater.updateServers([
      server({
        name: "Valve Matchmaking Server #1",
        keywords: "ctf,valve,hidden",
      }),
    ]);

    const row = db
      .query<{ is_valve: 0 | 1 }, []>("SELECT is_valve FROM servers")
      .get();
    expect(row?.is_valve).toBe(1);
  });

  test("aggregates Valve player counts by timestamp and hours by map", () => {
    const db = createDb();
    const now = Math.floor(Date.now() / 1000);
    const timestamp = now - (now % (60 * 30));
    db.run(`
INSERT INTO maps (id, map) VALUES (1, 'cp_badlands'), (2, 'pl_upward');
INSERT INTO servers (id, ip, steamid, name, keyword, region, map_id, visibility, maxPlayers, last_online, is_valve)
VALUES
  (1, '127.0.0.1:27015', '1', 'Valve Matchmaking Server #1', 'valve,hidden', 0, 1, 0, 24, ${now}, 1),
  (2, '127.0.0.2:27015', '2', 'Valve Matchmaking Server #2', 'valve,hidden', 0, 1, 0, 24, ${now}, 1),
  (3, '127.0.0.3:27015', '3', 'Community', 'vanilla', 0, 2, 0, 24, ${now}, 0);
INSERT INTO server_players (server_id, map_id, timestamp, player_count, player_hours, raw_hours)
VALUES
  (1, 1, ${timestamp}, 10, 5.5, 0.5),
  (2, 1, ${timestamp}, 12, 6.5, 0.5),
  (3, 2, ${timestamp}, 20, 10.0, 0.5);
`);

    const details = buildDataloaders(db).valveDetails();

    expect(details.playerCountsByTimestamp).toEqual([
      {
        timestamp,
        player_count: 22,
        player_hours: 12,
        raw_hours: 1,
      },
    ]);
    expect(details.playerCountsByMap).toEqual([
      {
        map: "cp_badlands",
        timestamp,
        player_count: 22,
        player_hours: 12,
        raw_hours: 1,
      },
    ]);
  });

  test("per-server detail analytics stay scoped to one Valve server", async () => {
    const db = createDb();
    const timestamp = Math.floor(Date.now() / 1000);
    db.run(`
INSERT INTO maps (id, map) VALUES (1, 'cp_badlands');
INSERT INTO servers (id, ip, steamid, name, keyword, region, map_id, visibility, maxPlayers, last_online, is_valve)
VALUES
  (1, '127.0.0.1:27015', '1', 'Valve Matchmaking Server #1', 'valve,hidden', 0, 1, 0, 24, ${timestamp}, 1),
  (2, '127.0.0.2:27015', '2', 'Valve Matchmaking Server #2', 'valve,hidden', 0, 1, 0, 24, ${timestamp}, 1);
INSERT INTO server_players (server_id, map_id, timestamp, player_count, player_hours, raw_hours)
VALUES
  (1, 1, ${timestamp}, 10, 5, 0.5),
  (2, 1, ${timestamp}, 12, 6, 0.5);
`);

    const details = await buildDataloaders(db).playerCountWithMaps.load(1);

    expect(details).toEqual([
      {
        map: "cp_badlands",
        timestamp,
        player_count: 10,
        player_hours: 5,
        raw_hours: 0.5,
      },
    ]);
  });
});
