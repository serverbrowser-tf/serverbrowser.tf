import { Gauge, Histogram } from "prom-client";

const ONE_HOUR_MS = 60 * 60 * 1000;

export type RefreshPhase =
  | "total"
  | "throttle_wait"
  | "steam_server_list"
  | "geoip"
  | "visibility"
  | "merge_live_servers"
  | "update_last_online"
  | "update_servers"
  | "update_observations"
  | "update_player_history"
  | "cache_persist"
  | "all_servers_db"
  | "all_servers_steam";

export type RefreshServerSource =
  | "steam_server_list"
  | "live_merged"
  | "all_servers_db"
  | "all_servers_steam";

interface RequestMetric {
  statusCode: number;
  finishedAt: number;
}

interface SteamServerBrowserMetric {
  finishedAt: number;
  successful: boolean;
  error: string | null;
}

export interface SteamServerBrowserMetrics {
  ok: boolean;
  lastCallAt: string | null;
  lastSuccessful: boolean | null;
  errorsPastHour: number;
  lastError: string | null;
}

const requestMetrics: RequestMetric[] = [];
const steamServerBrowserMetrics: SteamServerBrowserMetric[] = [];
const refreshDurationSeconds = new Histogram<"phase">({
  name: "serverbrowser_refresh_duration_seconds",
  help: "Duration of server refresh phases in seconds.",
  labelNames: ["phase"],
  buckets: [0.003, 0.03, 0.1, 0.3, 1, 3, 10, 30, 60, 180, 300],
});
const refreshLastDurationSeconds = new Gauge<"phase">({
  name: "serverbrowser_refresh_last_duration_seconds",
  help: "Most recent duration of each server refresh phase in seconds.",
  labelNames: ["phase"],
});
const refreshLastCompletedAtSeconds = new Gauge<"phase">({
  name: "serverbrowser_refresh_last_completed_at_seconds",
  help: "Unix timestamp when each server refresh phase last completed.",
  labelNames: ["phase"],
});
const refreshServerCount = new Gauge<"source">({
  name: "serverbrowser_refresh_servers",
  help: "Most recent server count seen during refresh.",
  labelNames: ["source"],
});

function prune<T extends { finishedAt: number }>(metrics: T[], now: number) {
  const oldestAllowed = now - ONE_HOUR_MS;
  let removeCount = 0;
  while (
    removeCount < metrics.length &&
    metrics[removeCount].finishedAt < oldestAllowed
  ) {
    removeCount += 1;
  }
  if (removeCount > 0) {
    metrics.splice(0, removeCount);
  }
}

export function shouldRecordRequestMetric(method: string, path: string) {
  return !(method === "GET" && path === "/api/health");
}

export function recordRequestStatus(
  statusCode: number,
  finishedAt = Date.now(),
) {
  prune(requestMetrics, finishedAt);
  requestMetrics.push({ statusCode, finishedAt });
}

export function getRequestMetrics(now = Date.now()) {
  prune(requestMetrics, now);

  const statuses: Record<string, number> = {};
  for (const metric of requestMetrics) {
    const key = String(metric.statusCode);
    statuses[key] = (statuses[key] ?? 0) + 1;
  }

  return {
    total: requestMetrics.length,
    statuses,
  };
}

export function recordSteamServerBrowserSuccess(finishedAt = Date.now()) {
  prune(steamServerBrowserMetrics, finishedAt);
  steamServerBrowserMetrics.push({
    finishedAt,
    successful: true,
    error: null,
  });
}

export function recordSteamServerBrowserFailure(
  error: unknown,
  finishedAt = Date.now(),
) {
  prune(steamServerBrowserMetrics, finishedAt);
  steamServerBrowserMetrics.push({
    finishedAt,
    successful: false,
    error: getErrorMessage(error),
  });
}

export function getSteamServerBrowserMetrics(
  now = Date.now(),
): SteamServerBrowserMetrics {
  prune(steamServerBrowserMetrics, now);

  const lastCall =
    steamServerBrowserMetrics[steamServerBrowserMetrics.length - 1];
  const errorsPastHour = steamServerBrowserMetrics.filter(
    (metric) => !metric.successful,
  ).length;
  const lastErrorMetric = steamServerBrowserMetrics
    .toReversed()
    .find((metric) => !metric.successful);

  return {
    ok: lastCall?.successful ?? true,
    lastCallAt: lastCall ? new Date(lastCall.finishedAt).toISOString() : null,
    lastSuccessful: lastCall?.successful ?? null,
    errorsPastHour,
    lastError: lastErrorMetric?.error ?? null,
  };
}

export function recordExpressResponse(
  method: string,
  path: string,
  statusCode: number,
  finishedAt = Date.now(),
) {
  if (shouldRecordRequestMetric(method, path)) {
    recordRequestStatus(statusCode, finishedAt);
  }
}

export function startRefreshTimer(phase: RefreshPhase) {
  const end = refreshDurationSeconds.startTimer({ phase });
  return () => {
    const durationSeconds = end();
    refreshLastDurationSeconds.set({ phase }, durationSeconds);
    refreshLastCompletedAtSeconds.set({ phase }, Date.now() / 1000);
    return durationSeconds;
  };
}

export async function timeRefreshPhase<T>(
  phase: RefreshPhase,
  callback: () => Promise<T>,
) {
  const end = startRefreshTimer(phase);
  try {
    return await callback();
  } finally {
    end();
  }
}

export function recordRefreshServerCount(
  source: RefreshServerSource,
  count: number,
) {
  refreshServerCount.set({ source }, count);
}

export function resetHealthMetricsForTests() {
  requestMetrics.length = 0;
  steamServerBrowserMetrics.length = 0;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown Steam server-browser error";
}
