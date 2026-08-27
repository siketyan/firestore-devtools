/**
 * Reading a raw frame well enough to list it.
 *
 * The action view answers "what did the app ask for"; this answers "what went
 * down the wire", so a frame is labelled by the protos it carries rather than
 * by anything we inferred from them.
 */
import { asRecord } from "../shared/json";
import type { Frame } from "../shared/types";

/**
 * The protos in a message — `targetChange`, `documentChange` — or the
 * WebChannel control code, which is a bare array rather than an object.
 */
export function describeFrame(frame: Frame): string {
  return describe(frame.decoded) ?? frame.raw.slice(0, 60) ?? "empty";
}

function describe(payload: unknown): string | undefined {
  if (typeof payload === "string") return payload;
  if (typeof payload === "number" || typeof payload === "boolean") {
    return String(payload);
  }

  if (Array.isArray(payload)) {
    const parts = payload
      .map(describe)
      .filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(", ") : undefined;
  }

  const record = asRecord(payload);
  if (!record) return undefined;

  const keys = Object.keys(record);
  return keys.length > 0 ? keys.join(", ") : undefined;
}

/** Everything an exchange carried, in bytes. */
export function frameBytes(frames: readonly Frame[]): number {
  return frames.reduce((total, frame) => total + frame.byteLength, 0);
}
