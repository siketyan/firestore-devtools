import type { ActionKind } from "../../shared/actions";
import { classNames } from "../format";
import * as styles from "./Toolbar.module.css";

export type KindFilter = "all" | ActionKind;

/** What the list is showing: the actions, or the wire underneath them. */
export type View = "actions" | "transport";

const VIEWS: Array<{ value: View; label: string }> = [
  { value: "actions", label: "Actions" },
  { value: "transport", label: "Transport" },
];

/** The filter chips. `transaction` is rare, so it shares one with nothing. */
const KINDS: Array<{ value: KindFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "query", label: "Query" },
  { value: "get", label: "Get" },
  { value: "write", label: "Write" },
  { value: "transaction", label: "Transaction" },
];

/** Whether an action passes the chip the user picked. */
export function matchesKind(kind: ActionKind, filter: KindFilter): boolean {
  return filter === "all" || kind === filter;
}

export function Toolbar({
  query,
  onQueryChange,
  kind,
  onKindChange,
  view,
  onViewChange,
  onClear,
  onExport,
  preserveLog,
  onPreserveLogChange,
  shown,
  total,
}: {
  view: View;
  onViewChange: (view: View) => void;
  query: string;
  onQueryChange: (query: string) => void;
  kind: KindFilter;
  onKindChange: (kind: KindFilter) => void;
  onClear: () => void;
  onExport: () => void;
  preserveLog: boolean;
  onPreserveLogChange: (preserveLog: boolean) => void;
  shown: number;
  total: number;
}) {
  return (
    <div className={styles.toolbar}>
      <button
        type="button"
        className={styles.button}
        onClick={onClear}
        title="Clear"
      >
        Clear
      </button>

      <button
        type="button"
        className={styles.button}
        onClick={onExport}
        disabled={total === 0}
        title="Save every captured action as JSON"
      >
        Export
      </button>

      <div className={styles.group}>
        {VIEWS.map(({ value, label }) => (
          <button
            type="button"
            key={value}
            className={classNames(styles.chip, value === view && styles.active)}
            onClick={() => onViewChange(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <label className={styles.toggle} title="Keep the capture across reloads">
        <input
          type="checkbox"
          checked={preserveLog}
          onChange={(event) => onPreserveLogChange(event.target.checked)}
        />
        Preserve log
      </label>

      <input
        className={styles.filter}
        type="search"
        value={query}
        placeholder="Filter by collection, document or payload"
        onChange={(event) => onQueryChange(event.target.value)}
      />

      <div className={styles.group} hidden={view !== "actions"}>
        {KINDS.map(({ value, label }) => (
          <button
            type="button"
            key={value}
            className={classNames(styles.chip, value === kind && styles.active)}
            onClick={() => onKindChange(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <span className={styles.count}>
        {shown === total ? `${total}` : `${shown} / ${total}`}{" "}
        {view === "actions" ? "actions" : "exchanges"}
      </span>
    </div>
  );
}
