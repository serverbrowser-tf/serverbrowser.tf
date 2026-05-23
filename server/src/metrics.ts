const ONE_HOUR_MS = 60 * 60 * 1000;

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
