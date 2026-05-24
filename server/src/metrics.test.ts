import { beforeEach, describe, expect, test } from "bun:test";
import { register } from "prom-client";

import {
  getRequestMetrics,
  getSteamServerBrowserMetrics,
  recordRefreshServerCount,
  recordExpressResponse,
  recordRequestStatus,
  recordSteamServerBrowserFailure,
  recordSteamServerBrowserSuccess,
  resetHealthMetricsForTests,
  shouldRecordRequestMetric,
  startRefreshTimer,
} from "./metrics";

const hourMs = 60 * 60 * 1000;
const now = Date.parse("2026-05-23T22:30:00.000Z");

beforeEach(() => {
  resetHealthMetricsForTests();
});

describe("health metrics", () => {
  test("counts exact request statuses over the last hour", () => {
    recordRequestStatus(200, now - 1_000);
    recordRequestStatus(200, now - 500);
    recordRequestStatus(304, now - 250);
    recordRequestStatus(500, now);

    expect(getRequestMetrics(now)).toEqual({
      total: 4,
      statuses: {
        "200": 2,
        "304": 1,
        "500": 1,
      },
    });
  });

  test("prunes and excludes request entries older than one hour", () => {
    recordRequestStatus(200, now - hourMs - 1);
    recordRequestStatus(500, now - hourMs);
    recordRequestStatus(200, now);

    expect(getRequestMetrics(now)).toEqual({
      total: 2,
      statuses: {
        "200": 1,
        "500": 1,
      },
    });
  });

  test("excludes GET /api/health through the middleware helper", () => {
    expect(shouldRecordRequestMetric("GET", "/api/health")).toBe(false);
    expect(shouldRecordRequestMetric("POST", "/api/health")).toBe(true);
    expect(shouldRecordRequestMetric("GET", "/api/location")).toBe(true);

    recordExpressResponse("GET", "/api/health", 200, now);
    recordExpressResponse("GET", "/api/location", 200, now);

    expect(getRequestMetrics(now)).toEqual({
      total: 1,
      statuses: {
        "200": 1,
      },
    });
  });

  test("counts Steam errors only over the last hour", () => {
    recordSteamServerBrowserFailure("old failure", now - hourMs - 1);
    recordSteamServerBrowserSuccess(now - 10_000);
    recordSteamServerBrowserFailure(new Error("fresh failure"), now);

    expect(getSteamServerBrowserMetrics(now)).toEqual({
      ok: false,
      lastCallAt: "2026-05-23T22:30:00.000Z",
      lastSuccessful: false,
      errorsPastHour: 1,
      lastError: "fresh failure",
    });
  });

  test("reports initial Steam state as healthy", () => {
    expect(getSteamServerBrowserMetrics(now)).toEqual({
      ok: true,
      lastCallAt: null,
      lastSuccessful: null,
      errorsPastHour: 0,
      lastError: null,
    });
  });

  test("records refresh phase duration and server counts", async () => {
    const endTimer = startRefreshTimer("total");
    const duration = endTimer();
    recordRefreshServerCount("steam_server_list", 123);

    const metrics = await register.metrics();
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(metrics).toContain(
      'serverbrowser_refresh_last_duration_seconds{phase="total"}',
    );
    expect(metrics).toContain(
      'serverbrowser_refresh_servers{source="steam_server_list"} 123',
    );
  });
});
