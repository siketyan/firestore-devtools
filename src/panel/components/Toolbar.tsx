import type { ActionKind } from "../../shared/actions";
import { classNames } from "../classNames";
import * as styles from "./Toolbar.module.css";

export type KindFilter = "all" | ActionKind;

/**
 * The filter chips. `transaction` and `channel` share one chip: neither is
 * something the developer wrote, and both are rare.
 */
const KINDS: Array<{
  value: KindFilter;
  label: string;
  matches: ActionKind[];
}> = [
  { value: "all", label: "All", matches: [] },
  { value: "listen", label: "Listen", matches: ["listen"] },
  { value: "query", label: "Query", matches: ["query"] },
  { value: "get", label: "Get", matches: ["get"] },
  { value: "write", label: "Write", matches: ["write"] },
  { value: "channel", label: "Other", matches: ["channel", "transaction"] },
];

/** Whether an action passes the chip the user picked. */
export function matchesKind(kind: ActionKind, filter: KindFilter): boolean {
  if (filter === "all") return true;
  const chip = KINDS.find((entry) => entry.value === filter);
  return chip ? chip.matches.includes(kind) : kind === filter;
}

export interface ToolbarProps {
  query: string;
  onQueryChange: (query: string) => void;
  kind: KindFilter;
  onKindChange: (kind: KindFilter) => void;
  onClear: () => void;
  shown: number;
  total: number;
}

export function Toolbar({
  query,
  onQueryChange,
  kind,
  onKindChange,
  onClear,
  shown,
  total,
}: ToolbarProps) {
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
