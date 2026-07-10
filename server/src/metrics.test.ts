import { beforeEach, describe, expect, test } from "bun:test";
import { register } from "prom-client";

import {
  getRequestLatencyMetrics,
  getRequestMetrics,
  getSteamServerBrowserMetrics,
  normalizeMetricsPath,
  recordRefreshServerCount,
  recordExpressResponse,
  recordRequestLatency,
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
  test("reports empty request latency stats", () => {
    expect(getRequestLatencyMetrics()).toEqual({
      total: {
        count: 0,
        averageMs: null,
        medianMs: null,
        p95Ms: null,
        p99Ms: null,
      },
      paths: {},
    });
  });

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

    recordExpressResponse("GET", "/api/health", 200, 10, now);
    recordExpressResponse("GET", "/api/location", 200, 20, now);

    expect(getRequestMetrics(now)).toEqual({
      total: 1,
      statuses: {
        "200": 1,
      },
    });
    expect(getRequestLatencyMetrics()).toEqual({
      total: {
        count: 1,
        averageMs: 20,
        medianMs: 20,
        p95Ms: 20,
        p99Ms: 20,
      },
      paths: {
        "/api/location": {
          count: 1,
          averageMs: 20,
          medianMs: 20,
          p95Ms: 20,
          p99Ms: 20,
        },
      },
    });
  });

  test("normalizes request paths for metrics", () => {
    expect(normalizeMetricsPath("/api/servers.json/admin-view")).toBe(
      "/api/servers.json/admin-view",
    );
    expect(normalizeMetricsPath("/api/admin/blacklist")).toBe(
      "/api/admin/blacklist",
    );
    expect(normalizeMetricsPath("/api/details/127.0.0.1:27015")).toBe(
      "/api/details/#ip",
    );
    expect(normalizeMetricsPath("/api/server-details/127.0.0.1:27015")).toBe(
      "/api/server-details/#ip",
    );
    expect(normalizeMetricsPath("/api/server-details-p2/127.0.0.1:27015")).toBe(
      "/api/server-details-p2/#ip",
    );
    expect(normalizeMetricsPath("/api/server-details-v2/127.0.0.1:27015")).toBe(
      "/api/server-details-v2/#ip",
    );
    expect(normalizeMetricsPath("/api/maps/details/cp_badlands")).toBe(
      "/api/maps/details/#map",
    );
    expect(normalizeMetricsPath("/wp-login.php")).toBe("unmatched");
  });

  test("groups request latency by normalized path", () => {
    recordRequestLatency("/api/server-details-v2/127.0.0.1:27015", 30);
    recordRequestLatency("/api/server-details-v2/192.168.0.1:27015", 10);
    recordRequestLatency("/api/maps/details/cp_badlands", 50);

    expect(getRequestLatencyMetrics()).toEqual({
      total: {
        count: 3,
        averageMs: 30,
        medianMs: 30,
        p95Ms: 50,
        p99Ms: 50,
      },
      paths: {
        "/api/server-details-v2/#ip": {
          count: 2,
          averageMs: 20,
          medianMs: 20,
          p95Ms: 30,
          p99Ms: 30,
        },
        "/api/maps/details/#map": {
          count: 1,
          averageMs: 50,
          medianMs: 50,
          p95Ms: 50,
          p99Ms: 50,
        },
      },
    });
  });

  test("keeps only the latest 100 total latency samples in FIFO order", () => {
    for (let i = 1; i <= 101; i++) {
      recordRequestLatency(`/api/test-${i}`, i);
    }

    expect(getRequestLatencyMetrics().total).toEqual({
      count: 100,
      averageMs: 51.5,
      medianMs: 51.5,
      p95Ms: 96,
      p99Ms: 100,
    });
  });

  test("keeps only the latest 100 per-path latency samples in FIFO order", () => {
    for (let i = 1; i <= 101; i++) {
      recordRequestLatency("/api/servers", i);
    }

    expect(getRequestLatencyMetrics().paths["/api/servers"]).toEqual({
      count: 100,
      averageMs: 51.5,
      medianMs: 51.5,
      p95Ms: 96,
      p99Ms: 100,
    });
  });

  test("replaces one duplicate sorted latency value at a time", () => {
    for (const durationMs of [5, 5, 10]) {
      recordRequestLatency("/api/servers", durationMs);
    }
    for (let i = 0; i < 97; i++) {
      recordRequestLatency("/api/servers", 100);
    }

    recordRequestLatency("/api/servers", 1);

    expect(getRequestLatencyMetrics().paths["/api/servers"]).toEqual({
      count: 100,
      averageMs: 97.16,
      medianMs: 100,
      p95Ms: 100,
      p99Ms: 100,
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
