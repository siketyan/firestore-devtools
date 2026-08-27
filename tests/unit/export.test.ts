import { beforeEach, describe, expect, it } from "vitest";

import type { Action } from "../../src/shared/actions";
import { exportAction, exportCapture, toJson } from "../../src/shared/export";
import { ExchangeStore } from "../../src/shared/store";
import { events } from "../support/session";

function actionFor(
  actions: readonly Action[],
  target: string,
  state?: Action["state"],
): Action {
  const found = actions.find(
    (action) => action.target === target && (!state || action.state === state),
  );
  if (!found) throw new Error(`no action for ${target}`);
  return found;
}

describe("exportAction", () => {
  let actions: readonly Action[];

  beforeEach(() => {
    const store = new ExchangeStore();
    for (const event of events()) store.apply(event);
    actions = store.getActions();
  });

  it("carries what the panel shows, not the envelopes it arrived in", () => {
    const exported = exportAction(actionFor(actions, "messages"));

    expect(exported).toMatchObject({
      kind: "query",
      target: "messages",
      state: "active",
      targetId: 2,
      documentCount: 3,
    });
    expect(exported.request).toMatchObject({
      from: [{ collectionId: "messages" }],
    });
    expect(exported.responses.map((it) => it.path)).toEqual([
      "messages/m1",
      "messages/m2",
      "messages/m2",
    ]);
  });

  it("writes timestamps as ISO strings rather than epoch milliseconds", () => {
    const exported = exportAction(actionFor(actions, "messages"));

    expect(exported.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(exported.respondedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(exported.responses[0]?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("leaves out what an action does not have", () => {
    const exported = exportAction(actionFor(actions, "messages"));

    expect(exported.endedAt).toBeUndefined();
    expect(exported.error).toBeUndefined();
    // And `JSON.stringify` drops them rather than writing nulls.
    expect(toJson(exported)).not.toContain("null");
  });

  it("keeps a document unwrapped, the way the detail pane shows it", () => {
    const exported = exportAction(actionFor(actions, "messages"));

    expect(exported.responses[0]?.body).toMatchObject({
      fields: { body: "hello" },
    });
  });

  it("marks a removed document and gives it no body", () => {
    const removed = exportAction(actionFor(actions, "messages")).responses.at(
      -1,
    );

    expect(removed).toMatchObject({ path: "messages/m2", removed: true });
    expect(removed?.body).toBeUndefined();
  });

  it("carries a failure", () => {
    expect(exportAction(actionFor(actions, "users/u9"))).toMatchObject({
      state: "failed",
      status: 403,
    });
  });
});

describe("exportCapture", () => {
  it("stamps the file so a reader knows what it is holding", () => {
    const store = new ExchangeStore();
    for (const event of events()) store.apply(event);

    const capture = exportCapture(store.getActions(), 1_756_300_000_000);

    expect(capture).toMatchObject({
      extension: "firestore-devtools",
      version: 1,
      exportedAt: "2025-08-27T13:06:40.000Z",
    });
    expect(capture.actions).toHaveLength(5);
  });

  it("round-trips through JSON", () => {
    const store = new ExchangeStore();
    for (const event of events()) store.apply(event);

    const capture = exportCapture(store.getActions(), 0);

    expect(JSON.parse(toJson(capture))).toEqual(
      JSON.parse(JSON.stringify(capture)),
    );
  });
});
