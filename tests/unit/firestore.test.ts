import { describe, expect, it } from "vitest";

import { identifyRpc } from "../../src/shared/firestore";

const ORIGIN = "https://firestore.googleapis.com";

describe("identifyRpc", () => {
  it("reads the service and method out of a WebChannel path", () => {
    expect(
      identifyRpc(
        `${ORIGIN}/google.firestore.v1.Firestore/Listen/channel?database=projects%2Fdemo%2Fdatabases%2F(default)&VER=8&TYPE=xmlhttp`,
      ),
    ).toEqual({
      service: "google.firestore.v1.Firestore",
      method: "Listen",
      transport: "webchannel",
      database: "projects/demo/databases/(default)",
    });
  });

  it("maps a `:verb` suffix to the RPC the SDK called", () => {
    expect(
      identifyRpc(
        `${ORIGIN}/v1/projects/demo/databases/(default)/documents:commit`,
      ),
    ).toEqual({
      service: "google.firestore.v1.Firestore",
      method: "Commit",
      transport: "rest",
      database: "projects/demo/databases/(default)",
      resource: "",
    });
  });

  it("keeps the resource a query runs under", () => {
    expect(
      identifyRpc(
        `${ORIGIN}/v1/projects/demo/databases/(default)/documents/users/abc:runQuery`,
      ),
    ).toMatchObject({ method: "RunQuery", resource: "users/abc" });
  });

  it("falls back to the HTTP method when there is no verb", () => {
    expect(
      identifyRpc(
        `${ORIGIN}/v1/projects/demo/databases/(default)/documents/users/abc`,
        "GET",
      ),
    ).toMatchObject({ method: "GetDocument", resource: "users/abc" });
  });

  it("matches on the path, so the emulator is picked up too", () => {
    expect(
      identifyRpc(
        "http://localhost:8080/google.firestore.v1.Firestore/Write/channel?VER=8",
      ),
    ).toMatchObject({ method: "Write", transport: "webchannel" });
  });

  it("ignores traffic that is not Firestore", () => {
    expect(
      identifyRpc("https://example.com/api/v1/foo", "GET"),
    ).toBeUndefined();
    expect(identifyRpc("/api/x", "GET", "https://example.com")).toBeUndefined();
  });

  it("survives a URL it cannot parse", () => {
    expect(identifyRpc("not a url at all")).toBeUndefined();
  });
});
