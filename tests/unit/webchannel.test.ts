import { describe, expect, it } from "vitest";

import {
  parseWebChannelRequest,
  WebChannelResponseParser,
} from "../../src/shared/webchannel";

/** The server frames each chunk as its length, a newline, then the JSON. */
function framed(...chunks: unknown[]): string {
  return chunks
    .map((chunk) => JSON.stringify(chunk))
    .map((json) => `${json.length}\n${json}`)
    .join("");
}

describe("parseWebChannelRequest", () => {
  it("pulls every message out of a form-encoded body", () => {
    const body = new URLSearchParams({
      count: "2",
      ofs: "0",
      req0___data__: JSON.stringify({
        database: "d",
        addTarget: { targetId: 2 },
      }),
      req1___data__: JSON.stringify({ database: "d", removeTarget: 4 }),
    }).toString();

    expect(parseWebChannelRequest(body).map((it) => it.payload)).toEqual([
      { database: "d", addTarget: { targetId: 2 } },
      { database: "d", removeTarget: 4 },
    ]);
  });

  it("ignores the bookkeeping parameters around them", () => {
    expect(parseWebChannelRequest("count=0&ofs=0")).toEqual([]);
  });
});

describe("WebChannelResponseParser", () => {
  const wire = framed(
    [[1, ["c", "SID123", "", 8]]],
    [[2, [{ targetChange: { targetChangeType: "ADD", targetIds: [2] } }]]],
  );

  it("waits for a chunk to arrive in full before emitting it", () => {
    const parser = new WebChannelResponseParser();
    const split = Math.floor(wire.length * 0.6);

    const first = parser.push(wire.slice(0, split));
    const second = parser.push(wire.slice(split));

    expect([...first, ...second].map((it) => it.payload)).toEqual([
      ["c", "SID123", "", 8],
      [{ targetChange: { targetChangeType: "ADD", targetIds: [2] } }],
    ]);
    expect(first.length + second.length).toBe(2);
  });

  it("handles a responseText that grows in place", () => {
    const parser = new WebChannelResponseParser();
    const firstChunk = framed([[1, ["c", "SID123", "", 8]]]);

    expect(parser.replace(wire.slice(0, 5))).toHaveLength(0);
    expect(parser.replace(firstChunk)).toHaveLength(1);
    expect(parser.replace(wire)).toHaveLength(1);
  });

  it("starts over if the response is reset underneath it", () => {
    const parser = new WebChannelResponseParser();
    parser.replace(wire);
    expect(parser.replace(framed([[1, ["noop"]]]))).toHaveLength(1);
  });

  it("falls back to plain JSON when there is no length prefix", () => {
    const parser = new WebChannelResponseParser();
    expect(parser.push('[[1,[{"noop":true}]]]')).toHaveLength(1);
  });

  it("does not emit half a JSON document", () => {
    const parser = new WebChannelResponseParser();
    expect(parser.push('[[1,[{"noop"')).toHaveLength(0);
  });
});
