import { describe, expect, test } from "bun:test";

import { buildHealthPayload } from "./health";
import { nullGitVersion } from "./version";

const now = new Date("2026-05-23T22:30:00.000Z");
const version = {
  commitDate: "2026-05-23T20:15:00-04:00",
  commit: "abcdef123",
  message: "commit subject",
};
const requestHour = {
  total: 1250,
  statuses: {
    "200": 1170,
    "304": 72,
    "500": 8,
  },
};
const requests = {
  hour: requestHour,
  latencyPast100: {
    total: {
      count: 3,
      averageMs: 20,
      p95Ms: 30,
      p99Ms: 30,
    },
    paths: {
      "/api/servers": {
        count: 3,
        averageMs: 20,
        p95Ms: 30,
        p99Ms: 30,
      },
    },
  },
};
const healthySteam = {
  ok: true,
  lastCallAt: "2026-05-23T22:29:00.000Z",
  lastSuccessful: true,
  errorsPastHour: 0,
  lastError: null,
};

describe("health payload", () => {
  test("builds the healthy response shape", () => {
    expect(
      buildHealthPayload({
        databaseOk: true,
        version,
        requests,
        steamServerBrowser: healthySteam,
        now,
        uptimeSeconds: 1234,
      }),
    ).toEqual({
      ok: true,
      version,
      timestamp: "2026-05-23T22:30:00.000Z",
      uptimeSeconds: 1234,
      requests,
      checks: {
        database: {
          ok: true,
        },
        steamServerBrowser: healthySteam,
      },
    });
  });

  test("reports unhealthy when the database check fails", () => {
    const payload = buildHealthPayload({
      databaseOk: false,
      version,
      requests,
      steamServerBrowser: healthySteam,
      now,
      uptimeSeconds: 1234,
    });

    expect(payload.ok).toBe(false);
    expect(payload.checks.database.ok).toBe(false);
  });

  test("reports unhealthy when the latest Steam call failed", () => {
    const payload = buildHealthPayload({
      databaseOk: true,
      version,
      requests,
      steamServerBrowser: {
        ok: false,
        lastCallAt: "2026-05-23T22:29:00.000Z",
        lastSuccessful: false,
        errorsPastHour: 1,
        lastError: "Steam server browser returned HTTP 500",
      },
      now,
      uptimeSeconds: 1234,
    });

    expect(payload.ok).toBe(false);
    expect(payload.checks.steamServerBrowser.lastSuccessful).toBe(false);
  });

  test("uses null version fields when git metadata is unavailable", () => {
    const payload = buildHealthPayload({
      databaseOk: true,
      version: nullGitVersion(),
      requests,
      steamServerBrowser: healthySteam,
      now,
      uptimeSeconds: 1234,
    });

    expect(payload.version).toEqual({
      commitDate: null,
      commit: null,
      message: null,
    });
  });
});
