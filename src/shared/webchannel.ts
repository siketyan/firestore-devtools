/**
 * Minimal decoders for the Closure WebChannel framing that the Firestore SDK
 * uses for its streaming RPCs (`Listen` and `Write`).
 *
 * Outbound, the SDK sends a form-encoded body:
 *
 *     count=1&ofs=0&req0___data__={"database":"...","addTarget":{...}}
 *
 * Inbound, the server writes length-prefixed JSON chunks onto one long-lived
 * response:
 *
 *     36
 *     [[1,["c","SID",,8]]]
 *     58
 *     [[2,[{"targetChange":{"targetChangeType":"ADD"}}]]]
 */
import { tryParseJson } from "./json";

export interface WebChannelMessage {
  payload: unknown;
  raw: string;
}

/** Splits an outbound WebChannel POST body into its individual messages. */
export function parseWebChannelRequest(body: string): WebChannelMessage[] {
  const params = new URLSearchParams(body);
  const messages: WebChannelMessage[] = [];

  for (const [key, value] of params) {
    if (!/^req\d+___data__$/.test(key)) continue;
    messages.push({ payload: tryParseJson(value) ?? value, raw: value });
  }

  return messages;
}

/**
 * Incremental parser for a streaming WebChannel response.
 *
 * Feed it the full `responseText` seen so far (XHR grows it in place) or each
 * new slice; it keeps track of how much it has already consumed and returns
 * only the messages that became complete since the last call.
 */
export class WebChannelResponseParser {
  #buffer = "";
  #offset = 0;

  /** Appends a slice of the response and drains every complete message. */
  push(chunk: string): WebChannelMessage[] {
    if (!chunk) return [];
    this.#buffer += chunk;
    return this.#drain();
  }

  /**
   * Same as {@link push}, but for sources that hand back the whole response so
   * far rather than just the new bytes (`XMLHttpRequest.responseText`).
   */
  replace(fullText: string): WebChannelMessage[] {
    if (fullText.length < this.#buffer.length) {
      // The response was reset underneath us; start over.
      this.#buffer = "";
      this.#offset = 0;
    }
    this.#buffer = fullText;
    return this.#drain();
  }

  #drain(): WebChannelMessage[] {
    const messages: WebChannelMessage[] = [];

    for (;;) {
      const rest = this.#buffer.slice(this.#offset);
      if (!rest) break;

      const sizeEnd = rest.indexOf("\n");
      const sizeText = sizeEnd === -1 ? "" : rest.slice(0, sizeEnd);

      if (/^\d+$/.test(sizeText)) {
        const size = Number(sizeText);
        const bodyStart = sizeEnd + 1;
        // Wait for the rest of the chunk to arrive.
        if (bodyStart + size > rest.length) break;

        const raw = rest.substr(bodyStart, size);
        this.#offset += bodyStart + size;
        messages.push(...flatten(tryParseJson(raw) ?? raw, raw));
        continue;
      }

      // Not the length-prefixed framing after all (error responses and the
      // handshake are plain JSON). Take the remainder once it parses.
      const payload = tryParseJson(rest);
      if (payload === undefined) break;
      this.#offset = this.#buffer.length;
      messages.push(...flatten(payload, rest));
      break;
    }

    return messages;
  }
}

/**
 * A chunk is an array of `[ordinal, payload]` pairs; anything else is passed
 * through as a single opaque message. The ordinal is the server's own
 * bookkeeping, so only the payload is kept.
 */
function flatten(chunk: unknown, raw: string): WebChannelMessage[] {
  if (!Array.isArray(chunk)) return [{ payload: chunk, raw }];

  const messages: WebChannelMessage[] = [];
  for (const entry of chunk) {
    const payload =
      Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "number"
        ? entry[1]
        : entry;
    messages.push({ payload, raw: JSON.stringify(payload) });
  }

  return messages;
}
