import type {
  RefreshWorkerToWebMessage,
  WebToRefreshWorkerMessage,
} from "./refresh-worker-messages";
import { getDb } from "./db";
import { getErrorMessage } from "./refresh-worker-messages";
import { startServerRefreshLoop } from "./servers/refresh";
import {
  applyBan,
  getServerStoreSnapshot,
  loadInitialServersJson,
} from "./servers/store";

function send(message: RefreshWorkerToWebMessage) {
  postMessage(message);
}

function sendSnapshot() {
  send({
    type: "snapshot",
    snapshot: getServerStoreSnapshot(),
  });
}

self.onmessage = async (event: MessageEvent<WebToRefreshWorkerMessage>) => {
  const message = event.data;
  if (message.type === "ban") {
    await applyBan(message.ip, message.reason);
    sendSnapshot();
  }
};

async function main() {
  send({ type: "status", status: "starting" });
  getDb();
  await loadInitialServersJson();
  sendSnapshot();
  send({ type: "status", status: "refreshing" });
  await startServerRefreshLoop({
    onSnapshot: sendSnapshot,
  });
}

void main().catch((error) => {
  send({
    type: "error",
    error: getErrorMessage(error),
  });
  throw error;
});
