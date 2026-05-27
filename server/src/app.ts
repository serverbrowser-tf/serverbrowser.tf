import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import serverTiming from "server-timing";
import promBundle from "express-prom-bundle";
import login, { isLoggedIn, isValidLogin } from "./api/login";
import maps from "./api/maps";
import servers from "./api/servers";
import misc from "./api/misc";
import { getDb, scheduleDbOptimize } from "./db";
import { normalizeMetricsPath, recordExpressResponse } from "./metrics";
import { scheduleServerObservationArchives } from "./observations";
import { startServerRefreshLoop } from "./servers/refresh";
import { loadInitialServersJson } from "./servers/store";

const app = express();
const PORT = 3030;
const db = getDb();

scheduleDbOptimize();
scheduleServerObservationArchives(db);

function isMetricsBasicAuthValid(header: string | undefined) {
  const [type, encoded] = header?.split(" ") ?? [];
  if (type !== "Basic" || !encoded) {
    return false;
  }

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex < 0) {
    return false;
  }

  return isValidLogin(
    decoded.slice(0, separatorIndex),
    decoded.slice(separatorIndex + 1),
  );
}

app.use(cookieParser());
app.use(cors());
app.use(express.json());
app.use(
  serverTiming({
    enabled: (req) => isLoggedIn(req),
  }),
);
app.use("/api/health/metrics", (req, res, next) => {
  if (isLoggedIn(req) || isMetricsBasicAuthValid(req.headers.authorization)) {
    next();
    return;
  }

  res.setHeader("WWW-Authenticate", 'Basic realm="serverbrowser metrics"');
  res.status(401).end();
});
app.use(
  promBundle({
    includeMethod: true,
    includePath: true,
    includeStatusCode: true,
    promClient: {
      collectDefaultMetrics: {},
    },
    metricsPath: "/api/health/metrics",
    normalizePath: (req) => normalizeMetricsPath(req.path),
    bypass: {
      onRequest(req) {
        return req.path === "/api/health" || req.path === "/api/health/metrics";
      },
    },
  }),
);
app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    recordExpressResponse(req.method, req.path, res.statusCode, durationMs);
  });
  next();
});

app.use(maps);
app.use(login);
app.use(servers);
app.use(misc);

async function main() {
  console.time("Initial startup");
  await loadInitialServersJson();
  void startServerRefreshLoop();
  console.timeEnd("Initial startup");

  app.listen(PORT, "127.0.0.1", () => {
    console.log(`Server is listening on port ${PORT}`);
  });
}

void main();
