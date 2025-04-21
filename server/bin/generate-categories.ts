import { getDb } from "../src/db";
import path from "path";
import fs from "fs/promises";

async function main() {
  const output_dir = path.join(__dirname, "..", "..", "data");
  await fs.mkdir(output_dir, { recursive: true });
  const output_file = path.join(output_dir, "categories");

  const db = getDb();
  const queryStr = `
SELECT b.reason, s.ip
FROM servers s
INNER JOIN blacklist b ON b.server_id = s.id
WHERE date(s.last_online, "unixepoch") >= date('now', '-28 days')
`;
  const query = db.query<{ reason: string; ip: string }, []>(queryStr);

  let output =
    `
# This file contains all of the manually set categories for serverbrowser.tf
# Provided in hopes it may be useful to someone eventually, but probably not
`.trim() + "\n\n";
  for (const { reason, ip } of query.all()) {
    output += `${ip.padEnd(21)} - ${reason}\n`;
  }
  fs.writeFile(output_file, output);
  query.finalize();
}

main();
