import { beforeEach, describe, expect, it } from "vitest";

import type { Action } from "../../src/shared/actions";
import { requestPayload, responseItems } from "../../src/shared/payloads";
import { ExchangeStore } from "../../src/shared/store";
import { events } from "../support/session";

function actionFor(
  actions: readonly Action[],
  target: string,
  state?: Action["state"],
) {
  const found = actions.find(
    (action) => action.target === target && (!state || action.state === state),
  );
  if (!found) throw new Error(`no action for ${target}`);
  return found;
}

describe("requestPayload", () => {
  let actions: readonly Action[];

  beforeEach(() => {
    const store = new ExchangeStore();
    for (const event of events()) store.apply(event);
    actions = store.getActions();
  });

  it("unwraps a listener's query down to the structured query", () => {
    expect(requestPayload(actionFor(actions, "messages"))).toEqual({
      from: [{ collectionId: "messages" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "read" },
          op: "EQUAL",
          value: { booleanValue: false },
        },
      },
      orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
      limit: 25,
    });
  });

  it("gives the document names for a document target", () => {
    expect(requestPayload(actionFor(actions, "users/u1", "active"))).toEqual([
      "projects/demo/databases/(default)/documents/users/u1",
    ]);
  });

  it("gives the writes for a write, with the document unwrapped", () => {
    expect(requestPayload(actionFor(actions, "messages/m3"))).toMatchObject([
      {
        update: {
          name: expect.stringContaining("messages/m3"),
          fields: { body: "sent" },
        },
      },
    ]);
  });

  it("unwraps an HTTP query the same way", () => {
    expect(requestPayload(actionFor(actions, "users"))).toMatchObject({
      from: [{ collectionId: "users" }],
    });
  });

  it("has nothing to show for a request that had no body", () => {
    expect(requestPayload(actionFor(actions, "users/u9"))).toBeUndefined();
  });
});

describe("responseItems", () => {
  let actions: readonly Action[];

  beforeEach(() => {
    const store = new ExchangeStore();
    for (const event of events()) store.apply(event);
    actions = store.getActions();
  });

  it("lists documents rather than the events that carried them", () => {
    const items = responseItems(actionFor(actions, "messages"));

    expect(items.map((item) => [item.path, item.removed])).toEqual([
      ["messages/m1", false],
      ["messages/m2", false],
      ["messages/m2", true],
    ]);
  });

  it("shows everything under `document`, and nothing above it", () => {
    const [first] = responseItems(actionFor(actions, "messages"));

    expect(first?.body).toMatchObject({
      name: expect.stringContaining("messages/m1"),
    });
    expect(first?.body).not.toHaveProperty("targetIds");
  });

  it("unwraps the fields, so a document reads the way the app sees it", () => {
    const [first] = responseItems(actionFor(actions, "messages"));

    expect(first?.body).toMatchObject({
      fields: { body: "hello", createdAt: "2026-08-27T12:59:00Z" },
    });
  });

  it("has nothing to show for a document that was removed", () => {
    const removed = responseItems(actionFor(actions, "messages")).at(-1);
    expect(removed?.body).toBeUndefined();
  });

  it("flattens an HTTP query's results", () => {
    expect(
      responseItems(actionFor(actions, "users")).map((item) => item.path),
    ).toEqual(["users/u1", "users/u2"]);
  });

  it("lists a write's results against what it wrote", () => {
    expect(
      responseItems(actionFor(actions, "messages/m3")).map((item) => item.path),
    ).toEqual(["messages/m3"]);
  });

  it("passes a response that is not documents through whole", () => {
    // Otherwise an error body would vanish, which is exactly when you look.
    const [error] = responseItems(actionFor(actions, "users/u9"));

    expect(error?.body).toEqual({
      error: { code: 403, message: "Missing or insufficient permissions." },
    });
  });
});
