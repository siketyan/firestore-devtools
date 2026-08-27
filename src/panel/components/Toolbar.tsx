import type { ActionKind } from "../../shared/actions";
import { classNames } from "../format";
import * as styles from "./Toolbar.module.css";

export type KindFilter = "all" | ActionKind;

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
  onClear,
  shown,
  total,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  kind: KindFilter;
  onKindChange: (kind: KindFilter) => void;
  onClear: () => void;
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

      <input
        className={styles.filter}
        type="search"
        value={query}
        placeholder="Filter by collection, document or payload"
        onChange={(event) => onQueryChange(event.target.value)}
      />

      <div className={styles.group}>
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
        {shown === total ? `${total}` : `${shown} / ${total}`} actions
      </span>
    </div>
  );
}
