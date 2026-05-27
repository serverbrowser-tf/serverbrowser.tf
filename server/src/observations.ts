import { Database } from "bun:sqlite";
import { createWriteStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { once } from "events";
import { createGzip } from "zlib";

import { scheduleDaily } from "./utils";

const ARCHIVE_HEADER = "observed_at,source,ip,name,steamid,region,map,players";
const DEFAULT_ARCHIVE_BATCH_SIZE = 5000;
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

class CsvGzipAppendWriter {
  private readonly gzip = createGzip();
  private readonly output: ReturnType<typeof createWriteStream>;
  private readonly finished: Promise<unknown[]>;
  private failed: Error | null = null;

  private constructor(filePath: string, includeHeader: boolean) {
    this.output = createWriteStream(filePath, { flags: "a" });
    this.finished = once(this.output, "finish");
    this.gzip.on("error", (error) => {
      this.failed = error;
      this.output.destroy(error);
    });
    this.output.on("error", (error) => {
      this.failed = error;
      this.gzip.destroy(error);
    });
    this.gzip.pipe(this.output);
    if (includeHeader) {
      this.write(`${ARCHIVE_HEADER}\n`);
    }
  }

  static async open(filePath: string) {
    const stat = await fs.stat(filePath).catch(() => null);
    return new CsvGzipAppendWriter(filePath, stat == null || stat.size === 0);
  }

  write(row: string) {
    if (this.failed) {
      throw this.failed;
    }
    if (!this.gzip.write(row)) {
      return once(this.gzip, "drain");
    }
    return null;
  }

  async writeRow(row: ArchiveRow) {
    await this.write(`${rowToCsv(row)}\n`);
  }

  async close() {
    this.gzip.end();
    await this.finished;
    if (this.failed) {
      throw this.failed;
    }
  }
}

async function getCsvGzipWriter(
  writers: Map<string, CsvGzipAppendWriter>,
  filePath: string,
) {
  let writer = writers.get(filePath);
  if (!writer) {
    writer = await CsvGzipAppendWriter.open(filePath);
    writers.set(filePath, writer);
  }
  return writer;
}

async function closeCsvGzipWriters(writers: Iterable<CsvGzipAppendWriter>) {
  for (const writer of writers) {
    await writer.close();
  }
}

export async function archiveServerObservations(args: {
  db: Database;
  archiveDir?: string;
  now?: Date;
  batchSize?: number;
}) {
  const archiveDir = args.archiveDir ?? defaultObservationArchiveDir();
  const cutoff = getArchiveCutoffUnix(args.now ?? new Date());
  const batchSize = Math.max(1, args.batchSize ?? DEFAULT_ARCHIVE_BATCH_SIZE);
  const selectRows = args.db.prepare<ArchiveRow, [number, number]>(
    `
SELECT so.id,
       so.observed_at,
       CASE WHEN s.is_valve = 1 THEN 'valve' ELSE 'community' END source,
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
ORDER BY s.steamid IS NULL, s.steamid, so.observed_at, so.id
LIMIT ?;
`,
  );

  const files = new Set<string>();
  let archivedRows = 0;
  let createdArchiveDir = false;

  while (true) {
    const writers = new Map<string, CsvGzipAppendWriter>();
    const ids: number[] = [];
    try {
      for (const row of selectRows.iterate(cutoff, batchSize)) {
        ids.push(row.id);

        if (!createdArchiveDir) {
          await fs.mkdir(archiveDir, { recursive: true });
          createdArchiveDir = true;
        }

        const week = archiveWeekForTimestamp(row.observed_at);
        const filePath = path.join(archiveDir, `${week}.csv.gz`);
        const writer = await getCsvGzipWriter(writers, filePath);
        await writer.writeRow(row);
        files.add(filePath);
      }
      if (ids.length === 0) {
        break;
      }
      await closeCsvGzipWriters(writers.values());
    } catch (error) {
      await Promise.allSettled(
        [...writers.values()].map((writer) => writer.close()),
      );
      throw error;
    }

    deleteArchivedRows(args.db, ids);
    archivedRows += ids.length;
  }

  return { archivedRows, files: [...files] };
}

export function scheduleServerObservationArchives(db: Database) {
  void archiveServerObservations({ db }).catch((error) => {
    console.error("archiveServerObservations startup", error);
  });

  void scheduleDaily(async () => {
    await archiveServerObservations({ db });
  });
}
