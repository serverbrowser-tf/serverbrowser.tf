import { Database } from "bun:sqlite";
import fs from "fs/promises";
import path from "path";
import { gzip } from "zlib";
import { promisify } from "util";

import { scheduleDaily } from "./utils";

const gzipAsync = promisify(gzip);
const ARCHIVE_HEADER = "observed_at,source,ip,name,steamid,region,map,players";
const TIME_ZONE = "America/New_York";
const REGION_NAMES = new Map<number, string>([
  [0, "US East"],
  [1, "US West"],
  [2, "South America"],
  [3, "Europe"],
  [4, "Asia"],
  [5, "Australia"],
  [6, "Middle East"],
  [7, "Africa"],
]);

interface ArchiveRow {
  id: number;
  observed_at: number;
  source: string;
  ip: string;
  name: string;
  steamid: string | null;
  region: number;
  map: string | null;
  players: number;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function defaultObservationArchiveDir() {
  const cwd = process.cwd();
  const repoRoot = path.basename(cwd) === "server" ? path.dirname(cwd) : cwd;
  return path.join(repoRoot, "public", "archives", "observations");
}

function getZonedParts(date: Date, timeZone = TIME_ZONE): DateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<keyof DateParts, number>;

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function zonedTimeToUtcMs(parts: DateParts, timeZone = TIME_ZONE): number {
  const guess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const actualParts = getZonedParts(new Date(guess), timeZone);
  const actualAsUtc = Date.UTC(
    actualParts.year,
    actualParts.month - 1,
    actualParts.day,
    actualParts.hour,
    actualParts.minute,
    actualParts.second,
  );
  const requestedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return guess - (actualAsUtc - requestedAsUtc);
}

export function getArchiveCutoffUnix(now = new Date()) {
  const parts = getZonedParts(now);
  return Math.floor(
    zonedTimeToUtcMs({
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: 0,
      minute: 0,
      second: 0,
    }) / 1000,
  );
}

function ymd(parts: Pick<DateParts, "year" | "month" | "day">) {
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

function addDays(
  parts: Pick<DateParts, "year" | "month" | "day">,
  days: number,
) {
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function archiveWeekForTimestamp(observedAt: number) {
  const parts = getZonedParts(new Date(observedAt * 1000));
  const dayOfWeek = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  ).getUTCDay();
  const start = addDays(parts, -dayOfWeek);
  const end = addDays(start, 6);

  return `${ymd(start)}_to_${ymd(end)}`;
}

function escapeCsv(value: string | number | null) {
  const str = value == null ? "" : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

export function regionName(region: number) {
  return REGION_NAMES.get(region) ?? null;
}

function rowToCsv(row: ArchiveRow) {
  return [
    row.observed_at,
    row.source,
    row.ip,
    row.name,
    row.steamid,
    regionName(row.region),
    row.map,
    row.players,
  ]
    .map(escapeCsv)
    .join(",");
}

function deleteArchivedRows(db: Database, ids: number[]) {
  const deleteRows = db.transaction((chunkedIds: number[]) => {
    const placeholders = Array(chunkedIds.length).fill("?").join(",");
    db.prepare(
      `DELETE FROM server_observations WHERE id IN (${placeholders})`,
    ).run(...chunkedIds);
  });

  for (let i = 0; i < ids.length; i += 500) {
    deleteRows(ids.slice(i, i + 500));
  }
}

async function gzipAppendCsv(filePath: string, csvRows: string[]) {
  const stat = await fs.stat(filePath).catch(() => null);
  const includeHeader = stat == null || stat.size === 0;
  const csv = `${includeHeader ? `${ARCHIVE_HEADER}\n` : ""}${csvRows.join("\n")}\n`;
  const compressed = await gzipAsync(csv as any);
  await fs.appendFile(filePath, compressed as any);
}

export async function archiveServerObservations(args: {
  db: Database;
  archiveDir?: string;
  now?: Date;
}) {
  const archiveDir = args.archiveDir ?? defaultObservationArchiveDir();
  const cutoff = getArchiveCutoffUnix(args.now ?? new Date());
  const rows = args.db
    .prepare<ArchiveRow, [number]>(
      `
SELECT so.id,
       so.observed_at,
       so.source,
       s.ip,
       s.name,
       s.steamid,
       s.region,
       m.map,
       so.players
FROM server_observations so
INNER JOIN servers s ON s.id = so.server_id
LEFT JOIN maps m ON m.id = so.map_id
WHERE so.observed_at < ?
ORDER BY so.observed_at, so.id;
`,
    )
    .all(cutoff);

  if (rows.length === 0) {
    return { archivedRows: 0, files: [] as string[] };
  }

  await fs.mkdir(archiveDir, { recursive: true });
  const byWeek = new Map<string, ArchiveRow[]>();
  for (const row of rows) {
    const week = archiveWeekForTimestamp(row.observed_at);
    const weekRows = byWeek.get(week) ?? [];
    weekRows.push(row);
    byWeek.set(week, weekRows);
  }

  const files: string[] = [];
  let archivedRows = 0;
  for (const [week, weekRows] of byWeek) {
    const filePath = path.join(archiveDir, `observations-${week}.csv.gz`);
    await gzipAppendCsv(
      filePath,
      weekRows.map((row) => rowToCsv(row)),
    );
    deleteArchivedRows(
      args.db,
      weekRows.map((row) => row.id),
    );
    files.push(filePath);
    archivedRows += weekRows.length;
  }

  return { archivedRows, files };
}

export function scheduleServerObservationArchives(db: Database) {
  void archiveServerObservations({ db }).catch((error) => {
    console.error("archiveServerObservations startup", error);
  });

  void scheduleDaily(async () => {
    await archiveServerObservations({ db });
  });
}
