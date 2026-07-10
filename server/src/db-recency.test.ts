import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import fs from "fs";

import { buildDataloaders } from "./db";

function createMigratedDb() {
  const db = new Database(":memory:");
  const migrations = fs
    .readdirSync("./migrations")
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const migration of migrations) {
    db.run(fs.readFileSync(`./migrations/${migration}`, "utf8"));
  }
  return db;
}

describe("recent server queries", () => {
  test("exclude servers that have been offline for more than 30 minutes", async () => {
    const db = createMigratedDb();
    const now = Math.floor(Date.now() / 1000);
    const date = new Date().toISOString().slice(0, 10);
    db.run("INSERT INTO maps (id, map) VALUES (1, 'cp_badlands')");
    db.query(
      `INSERT INTO servers
        (id, ip, steamid, name, keyword, region, map_id, visibility, maxPlayers, last_online, is_valve)
       VALUES (?, ?, ?, ?, '', 0, 1, 0, 24, ?, 0)`,
    ).run(1, "203.0.113.1:27015", "1", "Recent", now - 29 * 60);
    db.query(
      `INSERT INTO servers
        (id, ip, steamid, name, keyword, region, map_id, visibility, maxPlayers, last_online, is_valve)
       VALUES (?, ?, ?, ?, '', 0, 1, 0, 24, ?, 0)`,
    ).run(2, "203.0.113.2:27015", "2", "Stale", now - 31 * 60);
    db.query(
      `INSERT INTO server_map_hours (server_id, map_id, hours, date)
       VALUES (?, 1, 1, ?)`,
    ).run(1, date);
    db.query(
      `INSERT INTO server_map_hours (server_id, map_id, hours, date)
       VALUES (?, 1, 1, ?)`,
    ).run(2, date);

    const dataloaders = buildDataloaders(db);
    const mapServers = await dataloaders.mapServers.load("cp_badlands");
    const adminServers = dataloaders.adminView();
    const maps = [...dataloaders.listMaps()];
    const allServers = await dataloaders.allServers();

    expect(mapServers.map((server) => server.ip)).toEqual([
      "203.0.113.1:27015",
    ]);
    expect(adminServers.map((server) => server.ip)).toEqual([
      "203.0.113.1:27015",
    ]);
    expect(maps).toEqual([{ map: "cp_badlands", hours: 1, servers: 1 }]);
    expect([...allServers.ipMapping.keys()]).toEqual(["203.0.113.1:27015"]);
  });

  test("lists blacklisted servers for admin category management", () => {
    const db = createMigratedDb();
    const now = Math.floor(Date.now() / 1000);
    db.run("INSERT INTO maps (id, map) VALUES (1, 'cp_badlands')");
    db.query(
      `INSERT INTO servers
        (id, ip, steamid, name, keyword, region, map_id, visibility, maxPlayers, last_online, is_valve)
       VALUES (?, ?, ?, ?, ?, 0, 1, 0, 24, ?, 0)`,
    ).run(1, "203.0.113.1:27015", "1", "Categorized", "nocrits", now);
    db.query(
      `INSERT INTO blacklist (server_id, reason)
       VALUES (?, ?)`,
    ).run(1, "dm");

    const dataloaders = buildDataloaders(db);
    const rows = dataloaders.adminBlacklist();

    expect(rows).toEqual([
      expect.objectContaining({
        ip: "203.0.113.1:27015",
        name: "Categorized",
        map: "cp_badlands",
        keywords: "nocrits",
        category: "dm",
        last_online: now,
      }),
    ]);
  });
});
