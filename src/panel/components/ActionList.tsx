import type { Action, ActionKind } from "../../shared/actions";
import { classNames } from "../classNames";
import { formatDuration, formatTime } from "../format";
import * as styles from "./ActionList.module.css";

/** Read like an HTTP method: the verb first, then what it acts on. */
export const VERBS: Record<ActionKind, string> = {
  query: "QUERY",
  get: "GET",
  write: "WRITE",
  transaction: "TXN",
};

export interface ActionListProps {
  actions: readonly Action[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}

function statusOf(action: Action): string {
  if (action.error) return "error";
  if (action.status) return String(action.status);
  return action.state;
}

/** How long the action waited for its first response. */
function latencyOf(action: Action): number | undefined {
  return action.respondedAt ? action.respondedAt - action.startedAt : undefined;
}

export function ActionList({ actions, selectedId, onSelect }: ActionListProps) {
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
    <div className={styles.list}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Action</th>
            <th>Target</th>
            <th>Status</th>
            <th>Docs</th>
            <th>Latency</th>
            <th>Started</th>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
