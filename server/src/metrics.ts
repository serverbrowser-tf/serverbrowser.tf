import { Gauge, Histogram } from "prom-client";
import { sortedNumberIndex } from "./utils";

const ONE_HOUR_MS = 60 * 60 * 1000;
const REQUEST_LATENCY_SAMPLE_LIMIT = 100;

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
  | "non_valve_server_list";

export type RefreshServerSource =
  | "steam_server_list"
  | "live_merged"
  | "all_servers_db"
  | "non_valve_server_list";

interface RequestMetric {
  statusCode: number;
  finishedAt: number;
}

interface RequestLatencyWindow {
  ringValues: number[];
  sortedValues: number[];
  nextSlot: number;
  count: number;
  sum: number;
}

export interface RequestLatencyStats {
  count: number;
  averageMs: number | null;
  medianMs: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

export interface RequestLatencyMetrics {
  total: RequestLatencyStats;
  paths: Record<string, RequestLatencyStats>;
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
const totalRequestLatencyWindow = createRequestLatencyWindow();
const requestLatencyWindows = new Map<string, RequestLatencyWindow>();
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
const refreshWorkerLastSnapshotAtSeconds = new Gauge({
  name: "serverbrowser_refresh_worker_last_snapshot_at_seconds",
  help: "Unix timestamp when the web process last applied a refresh worker snapshot.",
});
const refreshWorkerRestarts = new Gauge({
  name: "serverbrowser_refresh_worker_restarts",
  help: "Number of refresh worker starts observed by the web process.",
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

function createRequestLatencyWindow(): RequestLatencyWindow {
  return {
    ringValues: [],
    sortedValues: [],
    nextSlot: 0,
    count: 0,
    sum: 0,
  };
}

function insertSorted(values: number[], value: number) {
  values.splice(sortedNumberIndex(values, value), 0, value);
}

function removeSortedValue(values: number[], value: number) {
  const index = sortedNumberIndex(values, value);
  if (values[index] === value) {
    values.splice(index, 1);
  }
}

function recordRequestLatencyWindow(
  window: RequestLatencyWindow,
  durationMs: number,
) {
  if (window.count < REQUEST_LATENCY_SAMPLE_LIMIT) {
    window.ringValues.push(durationMs);
    window.count += 1;
  } else {
    const oldValue = window.ringValues[window.nextSlot];
    removeSortedValue(window.sortedValues, oldValue);
    window.sum -= oldValue;
    window.ringValues[window.nextSlot] = durationMs;
    window.nextSlot = (window.nextSlot + 1) % REQUEST_LATENCY_SAMPLE_LIMIT;
  }

  insertSorted(window.sortedValues, durationMs);
  window.sum += durationMs;
}

function getPercentile(values: number[], percentile: number) {
  if (values.length === 0) {
    return null;
  }

  const index = Math.ceil(percentile * values.length) - 1;
  return values[index];
}

function getMedian(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) {
    return values[middle];
  }
  return (values[middle - 1] + values[middle]) / 2;
}

function getRequestLatencyStats(
  window: RequestLatencyWindow,
): RequestLatencyStats {
  if (window.count === 0) {
    return {
      count: 0,
      averageMs: null,
      medianMs: null,
      p95Ms: null,
      p99Ms: null,
    };
  }

  return {
    count: window.count,
    averageMs: window.sum / window.count,
    medianMs: getMedian(window.sortedValues),
    p95Ms: getPercentile(window.sortedValues, 0.95),
    p99Ms: getPercentile(window.sortedValues, 0.99),
  };
}

export function normalizeMetricsPath(path: string) {
  if (path === "/api/server-details-v2") {
    return "/api/server-details-v2";
  }
  if (path.startsWith("/api/details/")) {
    return "/api/details/#ip";
  }
  if (path.startsWith("/api/server-details/")) {
    return "/api/server-details/#ip";
  }
  if (path.startsWith("/api/server-details-p2/")) {
    return "/api/server-details-p2/#ip";
  }
  if (path.startsWith("/api/server-details-v2/")) {
    return "/api/server-details-v2/#ip";
  }
  if (path.startsWith("/api/maps/details/")) {
    return "/api/maps/details/#map";
  }

  switch (path) {
    case "/api/health":
    case "/api/location":
    case "/api/login":
    case "/api/maps":
    case "/api/servers":
    case "/api/servers/all":
    case "/api/servers.json":
    case "/api/servers.json/admin-view":
    case "/api/ban":
    case "/api/valve/details":
      return path;
    default:
      return "unmatched";
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

export function recordRequestLatency(path: string, durationMs: number) {
  const normalizedPath = normalizeMetricsPath(path);
  let pathWindow = requestLatencyWindows.get(normalizedPath);
  if (pathWindow == null) {
    pathWindow = createRequestLatencyWindow();
    requestLatencyWindows.set(normalizedPath, pathWindow);
  }

  recordRequestLatencyWindow(totalRequestLatencyWindow, durationMs);
  recordRequestLatencyWindow(pathWindow, durationMs);
}

export function getRequestLatencyMetrics(): RequestLatencyMetrics {
  const paths: Record<string, RequestLatencyStats> = {};
  for (const [path, window] of requestLatencyWindows) {
    paths[path] = getRequestLatencyStats(window);
  }

  return {
    total: getRequestLatencyStats(totalRequestLatencyWindow),
    paths,
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
  durationMs: number,
  finishedAt = Date.now(),
) {
  if (shouldRecordRequestMetric(method, path)) {
    recordRequestStatus(statusCode, finishedAt);
    recordRequestLatency(path, durationMs);
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

export function recordRefreshWorkerSnapshot(snapshotAt = Date.now()) {
  refreshWorkerLastSnapshotAtSeconds.set(snapshotAt / 1000);
}

export function recordRefreshWorkerRestart(count: number) {
  refreshWorkerRestarts.set(count);
}

export function resetHealthMetricsForTests() {
  requestMetrics.length = 0;
  totalRequestLatencyWindow.ringValues.length = 0;
  totalRequestLatencyWindow.sortedValues.length = 0;
  totalRequestLatencyWindow.nextSlot = 0;
  totalRequestLatencyWindow.count = 0;
  totalRequestLatencyWindow.sum = 0;
  requestLatencyWindows.clear();
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
