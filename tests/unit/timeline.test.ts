import { beforeEach, describe, expect, it } from "vitest";
import { actionEnd, barFor, timelineOf } from "../../src/panel/timeline";
import type { Action } from "../../src/shared/actions";
import { ExchangeStore } from "../../src/shared/store";
import { events } from "../support/session";

function actionFor(actions: readonly Action[], target: string): Action {
  const found = actions.find((action) => action.target === target);
  if (!found) throw new Error(`no action for ${target}`);
  return found;
}

describe("actionEnd", () => {
  let actions: readonly Action[];

  beforeEach(() => {
    const store = new ExchangeStore();
    for (const event of events()) store.apply(event);
    actions = store.getActions();
  });

  it("is when a finished action finished", () => {
    const write = actionFor(actions, "messages/m3");
    expect(actionEnd(write)).toBe(write.endedAt);
  });

  it("is the last thing an open action did, not the wall clock", () => {
    // Otherwise a listener's bar would creep while nothing was happening.
    const listener = actionFor(actions, "messages");

    expect(listener.endedAt).toBeUndefined();
    expect(actionEnd(listener)).toBe(listener.responses.at(-1)?.timestamp);
  });

  it("falls back to the start for something that never got anywhere", () => {
    const action = { startedAt: 5, responses: [] } as unknown as Action;
    expect(actionEnd(action)).toBe(5);
  });
});

describe("timelineOf", () => {
  it("spans the whole capture", () => {
    const store = new ExchangeStore();
    for (const event of events()) store.apply(event);
    const actions = store.getActions();

    const timeline = timelineOf(actions);
    const starts = actions.map((action) => action.startedAt);

    expect(timeline.start).toBe(Math.min(...starts));
    expect(timeline.start + timeline.span).toBe(
      Math.max(...actions.map(actionEnd)),
    );
  });

  it("never hands back a span you cannot divide by", () => {
    expect(timelineOf([]).span).toBe(1);

    const instant = [{ startedAt: 10, responses: [] }] as unknown as Action[];
    expect(timelineOf(instant).span).toBe(1);
  });
});

describe("barFor", () => {
  const timeline = { start: 0, span: 1000 };

  it("places a bar where the action sits in the window", () => {
    const action = {
      startedAt: 200,
      respondedAt: 400,
      endedAt: 700,
      responses: [],
    } as unknown as Action;

    expect(barFor(action, timeline)).toEqual({
      left: 20,
      width: 50,
      waited: 40,
    });
  });

  it("is all wait until something comes back", () => {
    const action = {
      startedAt: 0,
      endedAt: 500,
      responses: [],
    } as unknown as Action;
    expect(barFor(action, timeline).waited).toBe(100);
  });

  it("keeps something instantaneous visible", () => {
    const action = { startedAt: 500, responses: [] } as unknown as Action;
    expect(barFor(action, timeline).width).toBeGreaterThan(0);
  });
});
