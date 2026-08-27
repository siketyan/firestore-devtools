/**
 * Where each action sits on the capture's clock, for the waterfall column.
 *
 * An action that is still open has no end, so it is drawn out to the last
 * thing it did rather than to the wall clock: the panel then renders the same
 * picture every time it renders, which is what makes it testable — and stops
 * the bars from creeping while nothing is happening.
 */
import type { Action } from "../shared/actions";

export interface Timeline {
  start: number;
  /** Never zero, so it is always safe to divide by. */
  span: number;
}

/** The last moment an action did anything. */
export function actionEnd(action: Action): number {
  return (
    action.endedAt ??
    action.responses.at(-1)?.timestamp ??
    action.respondedAt ??
    action.startedAt
  );
}

/** The window every bar is drawn against: the whole capture, not the filter. */
export function timelineOf(actions: readonly Action[]): Timeline {
  if (actions.length === 0) return { start: 0, span: 1 };

  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;

  for (const action of actions) {
    start = Math.min(start, action.startedAt);
    end = Math.max(end, actionEnd(action));
  }

  return { start, span: Math.max(end - start, 1) };
}

export interface Bar {
  /** Percentages, ready for `style`. */
  left: number;
  width: number;
  /** How much of the bar was spent waiting for the first response. */
  waited: number;
}

export function barFor(action: Action, timeline: Timeline): Bar {
  const start = action.startedAt;
  const end = actionEnd(action);
  const duration = Math.max(end - start, 0);

  return {
    left: ((start - timeline.start) / timeline.span) * 100,
    // Something that took no measurable time still has to be visible.
    width: Math.max((duration / timeline.span) * 100, 0.4),
    waited:
      action.respondedAt && duration > 0
        ? Math.min(((action.respondedAt - start) / duration) * 100, 100)
        : 100,
  };
}
