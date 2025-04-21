import { getDb } from "../src/db";
import fastpathScum from "../src/servers/fastpath.json";

function deleteScum() {
  const blacklist = [...fastpathScum].map((server) => server.addr);
  const ips = [...new Set(blacklist)];
  const ipFilter = ips.map((ip) => `ip like "${ip}:%"`).join(" or ");
  const subQuery = `select id from servers where ${ipFilter}`;

  const db = getDb();
  db.query(
    `DELETE FROM server_map_hours WHERE server_id in (${subQuery})`,
  ).run();
  db.query(`DELETE FROM server_players WHERE server_id in (${subQuery})`).run();
  db.query(`DELETE FROM servers WHERE id in (${subQuery})`).run();
}

function main() {
  deleteScum();
}

main();
