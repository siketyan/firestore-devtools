/**
 * Turns the raw bodies seen on the wire into the frames the panel displays.
 */
import { tryParseJson } from "../../shared/json";
import type { RpcInfo } from "../../shared/types";
import {
  parseWebChannelRequest,
  WebChannelResponseParser,
} from "../../shared/webchannel";
import { emitFrame } from "./channel";

/** Turns a request body into text, when it is something we can read cheaply. */
export function bodyToText(body: unknown): string | undefined {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(body as ArrayBufferView);
  }
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  return undefined;
}

/**
 * Emits the outbound frames for a request body: one per WebChannel message for
 * the streaming RPCs, one JSON document for everything else.
 */
export function emitRequestFrames(
  exchangeId: string,
  rpc: RpcInfo,
  body: string | undefined,
): void {
  if (!body) return;

  if (rpc.transport === "webchannel") {
    const messages = parseWebChannelRequest(body);
    if (messages.length > 0) {
      for (const message of messages) {
        emitFrame(exchangeId, "outbound", message.raw, message.payload);
      }
      return;
    }
  }

  emitFrame(exchangeId, "outbound", body, tryParseJson(body));
}

export interface ResponseSink {
  /** Feeds only the newly arrived text. */
  push(chunk: string): void;
  /** Feeds the whole response body seen so far. */
  replace(fullText: string): void;
  /** Flushes the buffered unary body as a single frame. */
  finish(): void;
}

/** Reads response text and emits whatever frames it completes. */
export function createResponseSink(
  exchangeId: string,
  rpc: RpcInfo,
): ResponseSink {
  const parser = new WebChannelResponseParser();
  let plainText = "";

  const emitStreamed = (messages: ReturnType<typeof parser.push>): void => {
    for (const message of messages) {
      emitFrame(exchangeId, "inbound", message.raw, message.payload);
    }
  };

  return {
    push(chunk) {
      if (rpc.transport === "webchannel") emitStreamed(parser.push(chunk));
      else plainText += chunk;
    },

    replace(fullText) {
      if (rpc.transport === "webchannel")
        emitStreamed(parser.replace(fullText));
      else plainText = fullText;
    },

    finish() {
      if (rpc.transport === "webchannel" || !plainText) return;
      emitFrame(exchangeId, "inbound", plainText, tryParseJson(plainText));
    },
  };
}
