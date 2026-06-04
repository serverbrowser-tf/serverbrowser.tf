import {
  applyServerStoreSnapshot,
  type ServerStoreSnapshot,
} from "./servers/store";
import {
  getErrorMessage,
  type RefreshWorkerToWebMessage,
  type WebToRefreshWorkerMessage,
} from "./refresh-worker-messages";
import {
  recordRefreshWorkerRestart,
  recordRefreshWorkerSnapshot,
} from "./metrics";

interface RefreshWorkerState {
  running: boolean;
  startedAt: number | null;
  lastSnapshotAt: number | null;
  lastError: string | null;
  restartCount: number;
  staleAfterMs: number;
}

export interface RefreshWorkerHealth {
  ok: boolean;
  running: boolean;
  lastSnapshotAt: string | null;
  snapshotAgeMs: number | null;
  staleAfterMs: number;
  lastError: string | null;
  restartCount: number;
}

const refreshPeriodMinutes = Number(process.env.REFRESH_PERIOD ?? 1);
const staleAfterMs = Number(
  process.env.REFRESH_WORKER_STALE_MS ??
    Math.max(refreshPeriodMinutes * 3 * 60_000, 300_000),
);

let worker: Worker | null = null;
let restarting = false;

const state: RefreshWorkerState = {
  running: false,
  startedAt: null,
  lastSnapshotAt: null,
  lastError: null,
  restartCount: 0,
  staleAfterMs,
};

function handleSnapshot(snapshot: ServerStoreSnapshot) {
  applyServerStoreSnapshot(snapshot);
  state.lastSnapshotAt = Date.now();
  state.lastError = null;
  recordRefreshWorkerSnapshot(state.lastSnapshotAt);
}

function handleMessage(message: RefreshWorkerToWebMessage) {
  switch (message.type) {
    case "snapshot":
      handleSnapshot(message.snapshot);
      break;
    case "status":
      console.info("Refresh worker status:", message.status);
      break;
    case "error":
      state.lastError = message.error;
      console.error("Refresh worker error:", message.error);
      break;
  }
}

function scheduleRestart() {
  if (restarting) {
    return;
  }
  restarting = true;
  state.running = false;

  setTimeout(() => {
    restarting = false;
    startRefreshWorker();
  }, 1000);
}

export function startRefreshWorker() {
  if (worker != null) {
    return;
  }

  worker = new Worker("./src/refresh-worker.ts", {
    type: "module",
  });
  const isRestart = state.startedAt != null;
  state.running = true;
  state.startedAt = Date.now();
  if (isRestart) {
    state.restartCount += 1;
  }
  recordRefreshWorkerRestart(state.restartCount);

  worker.onmessage = (event: MessageEvent<RefreshWorkerToWebMessage>) => {
    handleMessage(event.data);
  };
  worker.onerror = (event) => {
    state.lastError = getErrorMessage(event.error ?? event.message);
    console.error("Refresh worker crashed:", state.lastError);
    worker?.terminate();
    worker = null;
    scheduleRestart();
  };
}

export function sendRefreshWorkerMessage(message: WebToRefreshWorkerMessage) {
  worker?.postMessage(message);
}

export function getRefreshWorkerHealth(now = Date.now()): RefreshWorkerHealth {
  const staleAnchor = state.lastSnapshotAt ?? state.startedAt;
  const snapshotAgeMs =
    state.lastSnapshotAt == null ? null : now - state.lastSnapshotAt;
  const stale =
    staleAnchor == null ? true : staleAnchor + state.staleAfterMs < now;

  return {
    ok: state.running && !stale,
    running: state.running,
    lastSnapshotAt:
      state.lastSnapshotAt == null
        ? null
        : new Date(state.lastSnapshotAt).toISOString(),
    snapshotAgeMs,
    staleAfterMs: state.staleAfterMs,
    lastError: state.lastError,
    restartCount: state.restartCount,
  };
}
