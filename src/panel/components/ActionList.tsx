import { useLayoutEffect, useRef } from "react";

import type { Action, ActionKind } from "../../shared/actions";
import { classNames, formatDuration, formatTime } from "../format";
import { barFor, type Timeline } from "../timeline";
import * as styles from "./ActionList.module.css";

/** Read like an HTTP method: the verb first, then what it acts on. */
export const VERBS: Record<ActionKind, string> = {
  query: "QUERY",
  get: "GET",
  write: "WRITE",
  transaction: "TXN",
};

function statusOf(action: Action): string {
  if (action.error) return "error";
  if (action.status) return String(action.status);
  return action.state;
}

/** How long the action waited for its first response. */
function latencyOf(action: Action): number | undefined {
  return action.respondedAt ? action.respondedAt - action.startedAt : undefined;
}

/** Within this many pixels of the bottom still counts as being at the bottom. */
const STICK_THRESHOLD = 8;

export function ActionList({
  actions,
  timeline,
  selectedId,
  onSelect,
}: {
  actions: readonly Action[];
  timeline: Timeline;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  // Follow new actions the way a log does, but only while the reader has not
  // scrolled up to look at something.
  const stick = useRef(true);
  const shown = useRef(0);

  useLayoutEffect(() => {
    const list = listRef.current;
    // Rows are rewritten constantly as responses arrive; only a change in how
    // many there are can move the bottom.
    if (list && stick.current && actions.length !== shown.current) {
      list.scrollTop = list.scrollHeight;
    }
    shown.current = actions.length;
  });

  const onScroll = () => {
    const list = listRef.current;
    if (!list) return;
    stick.current =
      list.scrollHeight - list.scrollTop - list.clientHeight <= STICK_THRESHOLD;
  };

  if (actions.length === 0) {
    return (
      <div className={classNames(styles.list, styles.empty)}>
        <p>No Firestore activity captured yet.</p>
        <p>
          Reload the inspected page with this panel open to record the reads it
          starts up with.
        </p>
      </div>
    );
  }

  return (
    <div ref={listRef} className={styles.list} onScroll={onScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Action</th>
            <th>Target</th>
            <th>Status</th>
            <th>Docs</th>
            <th>Latency</th>
            <th>Started</th>
            <th className={styles.timelineHeading}>Timeline</th>
          </tr>
        </thead>
        <tbody>
          {actions.map((action) => (
            <tr
              key={action.id}
              className={classNames(
                styles.row,
                action.state === "failed" && styles.failed,
                action.id === selectedId && styles.selected,
              )}
              onClick={() => onSelect(action.id)}
            >
              <td className={styles.verb}>{VERBS[action.kind]}</td>
              <td className={styles.target}>{action.target}</td>
              <td>{statusOf(action)}</td>
              <td>{action.documentCount || "—"}</td>
              <td>{formatDuration(latencyOf(action))}</td>
              <td>{formatTime(action.startedAt)}</td>
              <td className={styles.timeline}>
                <Waterfall action={action} timeline={timeline} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One action's span, drawn against the whole capture. */
function Waterfall({
  action,
  timeline,
}: {
  action: Action;
  timeline: Timeline;
}) {
  const { left, width, waited } = barFor(action, timeline);
  const latency = latencyOf(action);

  return (
    <span className={styles.track}>
      <span
        className={styles.bar}
        style={{ left: `${left}%`, width: `${width}%` }}
        title={
          latency == null
            ? "no response yet"
            : `${formatDuration(latency)} to the first response`
        }
      >
        <span className={styles.received} style={{ left: `${waited}%` }} />
      </span>
    </span>
  );
}
