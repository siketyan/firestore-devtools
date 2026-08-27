/**
 * The capture as plain data, for the clipboard and for a file on disk.
 *
 * The panel's own model is tuned for rendering — epoch milliseconds, frames
 * that still carry their raw text. What leaves the panel is tuned for reading
 * and for whatever someone pipes it into: timestamps as ISO strings, and the
 * same payloads the detail pane shows rather than the envelopes they arrived
 * in.
 */
import type { Action } from "./actions";
import { requestPayload, responseItems } from "./payloads";

/** Bumped when the shape below changes in a way a reader would notice. */
export const EXPORT_VERSION = 1;

export interface ExportedResponse {
  path: string;
  at: string;
  removed: boolean;
  body?: unknown;
}

export interface ExportedAction {
  kind: Action["kind"];
  target: string;
  detail?: string;
  state: Action["state"];
  database?: string;
  targetId?: number;
  startedAt: string;
  respondedAt?: string;
  endedAt?: string;
  status?: number;
  error?: string;
  documentCount: number;
  request?: unknown;
  responses: ExportedResponse[];
}

export interface ExportedCapture {
  extension: "firestore-devtools";
  version: number;
  exportedAt: string;
  actions: ExportedAction[];
}

function at(timestamp: number | undefined): string | undefined {
  return timestamp == null ? undefined : new Date(timestamp).toISOString();
}

export function exportAction(action: Action): ExportedAction {
  return {
    kind: action.kind,
    target: action.target,
    detail: action.detail,
    state: action.state,
    targetId: action.targetId,
    startedAt: new Date(action.startedAt).toISOString(),
    respondedAt: at(action.respondedAt),
    endedAt: at(action.endedAt),
    status: action.status,
    error: action.error,
    documentCount: action.documentCount,
    request: requestPayload(action),
    responses: responseItems(action).map((item) => ({
      path: item.path,
      at: new Date(item.timestamp).toISOString(),
      removed: item.removed,
      body: item.body,
    })),
  };
}

export function exportCapture(
  actions: readonly Action[],
  exportedAt: number,
): ExportedCapture {
  return {
    extension: "firestore-devtools",
    version: EXPORT_VERSION,
    exportedAt: new Date(exportedAt).toISOString(),
    actions: actions.map(exportAction),
  };
}

/** `undefined` fields are dropped, which is what `JSON.stringify` does. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
