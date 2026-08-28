import { beforeEach, describe, expect, it } from "vitest";

import type { Action } from "../../src/shared/actions";
import { ExchangeStore } from "../../src/shared/store";
import type { CaptureEvent, ExchangeEnd } from "../../src/shared/types";
import {
  DATABASE,
  DOCUMENTS,
  events,
  frame,
  LISTEN_RPC,
  restRpc,
  session,
} from "../support/session";

function replay(): ExchangeStore {
  const store = new ExchangeStore();
  for (const event of events()) store.apply(event);
  return store;
}

function find(
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

describe("ActionIndex", () => {
  let actions: readonly Action[];

  beforeEach(() => {
    actions = replay().getActions();
  });

  it("lists what was asked for, not what was sent", () => {
    expect(actions.map((action) => [action.kind, action.target])).toEqual([
      ["query", "messages"],
      ["get", "users/u1"],
      ["write", "messages/m3"],
      ["query", "users"],
      ["get", "users/u9"],
    ]);
  });

  describe("a listener on a query", () => {
    it("joins the request on one exchange to the responses on another", () => {
      const action = find(actions, "messages");

      expect(action.targetId).toBe(2);
      expect(action.exchangeIds).toEqual(["listen-query", "backchannel"]);
      expect(action.request?.decoded).toMatchObject({
        addTarget: { targetId: 2 },
      });
      expect(action.responses).toHaveLength(5);
    });

    it("counts the documents it saw, deletes included", () => {
      expect(find(actions, "messages").documentCount).toBe(3);
    });

    it("is answered once the target goes CURRENT", () => {
      const action = find(actions, "messages");
      expect(action.respondedAt).toBe(action.responses[1]?.timestamp);
    });

    it("does not carry a stringified condition", () => {
      expect(find(actions, "messages").detail).toBeUndefined();
    });
  });

  describe("a listener on a document", () => {
    it("is a read of that document, still running", () => {
      const action = find(actions, "users/u1", "active");
      expect(action.kind).toBe("get");
      expect(action.documentCount).toBe(1);
      expect(action.exchangeIds).toEqual(["listen-document", "backchannel"]);
    });
  });

  describe("the write stream", () => {
    it("matches a result to the request that is waiting for one", () => {
      const action = find(actions, "messages/m3");
      expect(action.detail).toBe("set");
      expect(action.state).toBe("complete");
      expect(action.responses).toHaveLength(1);
    });
  });

  describe("the HTTP RPCs", () => {
    it("takes the collection from the query", () => {
      const action = find(actions, "users");
      expect(action.kind).toBe("query");
      expect(action.documentCount).toBe(2);
      expect(action.state).toBe("complete");
    });

    it("fails an action when its exchange did", () => {
      const action = find(actions, "users/u9");
      expect(action.state).toBe("failed");
      expect(action.status).toBe(403);
    });
  });

  describe("an exchange that was cancelled rather than failing", () => {
    /**
     * One listener that received a document, on a backchannel that ended the
     * way `end` says it did.
     */
    function listener(end: ExchangeEnd): ExchangeStore {
      const store = new ExchangeStore();
      const request = frame("outbound", 5, {
        database: DATABASE,
        addTarget: {
          targetId: 2,
          query: {
            parent: DOCUMENTS,
            structuredQuery: { from: [{ collectionId: "messages" }] },
          },
        },
      });
      const current = frame("inbound", 20, [
        { targetChange: { targetChangeType: "CURRENT", targetIds: [2] } },
      ]);
      const document = frame("inbound", 30, [
        {
          documentChange: {
            document: { name: `${DOCUMENTS}/messages/m1`, fields: {} },
            targetIds: [2],
          },
        },
      ]);

      for (const event of [
        {
          kind: "start",
          exchange: { id: "post", rpc: LISTEN_RPC, startedAt: 0 },
        },
        {
          kind: "start",
          exchange: { id: "backchannel", rpc: LISTEN_RPC, startedAt: 0 },
        },
        { kind: "frame", exchangeId: "post", frame: request },
        { kind: "frame", exchangeId: "backchannel", frame: current },
        { kind: "frame", exchangeId: "backchannel", frame: document },
        { kind: "end", exchangeId: "backchannel", patch: end },
      ] satisfies CaptureEvent[]) {
        store.apply(event);
      }

      return store;
    }

    it("is not a failure of the exchange", () => {
      const exchanges = listener({ canceled: true }).getSnapshot();
      const backchannel = exchanges.find((it) => it.id === "backchannel");

      expect(backchannel?.state).toBe("canceled");
      expect(backchannel?.error).toBeUndefined();
      // The flag says how it ended; it is not a field of the exchange.
      expect(backchannel).not.toHaveProperty("canceled");
    });

    it("leaves the listeners riding on it alone", () => {
      const [action] = listener({ canceled: true }).getActions();

      // The SDK recycles the backchannel and re-adds the target; the listener
      // never stopped, and the document it delivered is still real.
      expect(action?.state).toBe("active");
      expect(action?.error).toBeUndefined();
      expect(action?.documentCount).toBe(1);
    });

    it("still fails them when the stream really failed", () => {
      const [action] = listener({
        error: "Network request failed",
      }).getActions();

      expect(action?.state).toBe("failed");
      expect(action?.error).toBe("Network request failed");
    });

    it("does not report a cancelled one-shot read as complete", () => {
      const store = new ExchangeStore();
      const request = frame("outbound", 0, {
        documents: [`${DOCUMENTS}/users/u1`],
      });

      for (const event of [
        {
          kind: "start",
          exchange: {
            id: "get",
            rpc: restRpc("BatchGetDocuments"),
            startedAt: 0,
          },
        },
        { kind: "frame", exchangeId: "get", frame: request },
        { kind: "end", exchangeId: "get", patch: { canceled: true } },
      ] satisfies CaptureEvent[]) {
        store.apply(event);
      }

      const [action] = store.getActions();
      expect(action?.state).toBe("canceled");
      expect(action?.error).toBeUndefined();
    });
  });

  it("keeps no rows for the channel's own bookkeeping", () => {
    // The handshake and the keepalives are transport, not something anyone
    // asked for, so they get no row of their own.
    expect(actions.map((action) => action.kind)).not.toContain("channel");
    expect(actions).toHaveLength(5);
  });

  it("ends a listener when the developer unsubscribes", () => {
    const store = replay();
    const exchanges = store.getSnapshot();
    const target = exchanges.find((it) => it.id === "listen-query");

    store.apply({
      kind: "frame",
      exchangeId: "listen-query",
      frame: {
        id: "unsubscribe",
        direction: "outbound",
        timestamp: (target?.startedAt ?? 0) + 2000,
        raw: "{}",
        decoded: { database: `${DOCUMENTS}/..`, removeTarget: 2 },
        byteLength: 2,
      },
    });

    expect(find(store.getActions(), "messages").state).toBe("complete");
  });

  it("rebuilds the same actions from a serialised backlog", () => {
    const live = replay();
    const restored = new ExchangeStore();

    // What a panel receives from the background worker after it reconnects.
    restored.replace(JSON.parse(JSON.stringify(live.getSnapshot())));

    const strip = (actions: readonly Action[]) =>
      actions.map(({ request, responses, ...rest }) => ({
        ...rest,
        responses: responses.length,
        request: request?.raw,
      }));

    expect(strip(restored.getActions())).toEqual(strip(live.getActions()));
  });

  it("leaves a still-open stream open when rebuilding", () => {
    const restored = new ExchangeStore();
    restored.replace(JSON.parse(JSON.stringify(session())));

    expect(find(restored.getActions(), "users/u1", "active")).toBeDefined();
  });

  it("does the action work only when asked to", () => {
    const store = new ExchangeStore(false);
    for (const event of events()) store.apply(event);

    expect(store.getSnapshot()).toHaveLength(6);
    expect(store.getActions()).toEqual([]);
  });
});
