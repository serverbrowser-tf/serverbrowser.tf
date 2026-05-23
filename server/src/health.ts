import { Database } from "bun:sqlite";

import { getDb } from "./db";
import {
  getRequestMetrics,
  getSteamServerBrowserMetrics,
} from "./metrics";
import { gitVersion, GitVersion } from "./version";

export interface HealthPayload {
  ok: boolean;
  version: GitVersion;
  timestamp: string;
  uptimeSeconds: number;
  requestsPastHour: ReturnType<typeof getRequestMetrics>;
  checks: {
    database: {
      ok: boolean;
    };
    steamServerBrowser: ReturnType<typeof getSteamServerBrowserMetrics>;
  };
}

export function checkDatabase(db: Database = getDb()) {
  try {
    db.query("SELECT 1").get();
    return true;
  } catch {
    return false;
  }
}

export function buildHealthPayload(args: {
  databaseOk: boolean;
  version: GitVersion;
  requestsPastHour: ReturnType<typeof getRequestMetrics>;
  steamServerBrowser: ReturnType<typeof getSteamServerBrowserMetrics>;
  now?: Date;
  uptimeSeconds?: number;
}): HealthPayload {
  const now = args.now ?? new Date();
  const uptimeSeconds = args.uptimeSeconds ?? Math.floor(process.uptime());
  const ok = args.databaseOk && args.steamServerBrowser.ok;

  return {
    ok,
    version: args.version,
    timestamp: now.toISOString(),
    uptimeSeconds,
    requestsPastHour: args.requestsPastHour,
    checks: {
      database: {
        ok: args.databaseOk,
      },
      steamServerBrowser: args.steamServerBrowser,
    },
  };
}

export function getHealthPayload() {
  return buildHealthPayload({
    databaseOk: checkDatabase(),
    version: gitVersion,
    requestsPastHour: getRequestMetrics(),
    steamServerBrowser: getSteamServerBrowserMetrics(),
  });
}
