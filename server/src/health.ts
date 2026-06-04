import { Database } from "bun:sqlite";

import { getDb } from "./db";
import {
  getRequestLatencyMetrics,
  getRequestMetrics,
  getSteamServerBrowserMetrics,
} from "./metrics";
import { getRefreshWorkerHealth } from "./refresh-worker-supervisor";
import { gitVersion, GitVersion } from "./version";

export interface HealthPayload {
  ok: boolean;
  version: GitVersion;
  timestamp: string;
  uptimeSeconds: number;
  requests: {
    hour: ReturnType<typeof getRequestMetrics>;
    latencyPast100: ReturnType<typeof getRequestLatencyMetrics>;
  };
  checks: {
    database: {
      ok: boolean;
    };
    refreshWorker: ReturnType<typeof getRefreshWorkerHealth>;
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
  requests: HealthPayload["requests"];
  refreshWorker: ReturnType<typeof getRefreshWorkerHealth>;
  steamServerBrowser: ReturnType<typeof getSteamServerBrowserMetrics>;
  now?: Date;
  uptimeSeconds?: number;
}): HealthPayload {
  const now = args.now ?? new Date();
  const uptimeSeconds = args.uptimeSeconds ?? Math.floor(process.uptime());
  const ok =
    args.databaseOk && args.refreshWorker.ok && args.steamServerBrowser.ok;

  return {
    ok,
    version: args.version,
    timestamp: now.toISOString(),
    uptimeSeconds,
    requests: args.requests,
    checks: {
      database: {
        ok: args.databaseOk,
      },
      refreshWorker: args.refreshWorker,
      steamServerBrowser: args.steamServerBrowser,
    },
  };
}

export function getHealthPayload() {
  return buildHealthPayload({
    databaseOk: checkDatabase(),
    version: gitVersion,
    requests: {
      hour: getRequestMetrics(),
      latencyPast100: getRequestLatencyMetrics(),
    },
    refreshWorker: getRefreshWorkerHealth(),
    steamServerBrowser: getSteamServerBrowserMetrics(),
  });
}
