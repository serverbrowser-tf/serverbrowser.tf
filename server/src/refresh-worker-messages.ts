import type { ServerStoreSnapshot } from "./servers/store";

export type RefreshWorkerToWebMessage =
  | {
      type: "snapshot";
      snapshot: ServerStoreSnapshot;
    }
  | {
      type: "status";
      status: string;
    }
  | {
      type: "error";
      error: string;
    };

export type WebToRefreshWorkerMessage = {
  type: "ban";
  ip: string;
  reason: string;
};

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}
