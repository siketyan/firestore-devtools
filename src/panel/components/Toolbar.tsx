import { classNames } from "../classNames";
import * as styles from "./Toolbar.module.css";

export type TransportFilter = "all" | "webchannel" | "rest";

const TRANSPORTS: Array<{ value: TransportFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "webchannel", label: "Streaming" },
  { value: "rest", label: "Unary" },
];

export interface ToolbarProps {
  query: string;
  onQueryChange: (query: string) => void;
  transport: TransportFilter;
  onTransportChange: (transport: TransportFilter) => void;
  onClear: () => void;
  shown: number;
  total: number;
}

export function Toolbar({
  query,
  onQueryChange,
  transport,
  onTransportChange,
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
        placeholder="Filter by RPC, URL or payload"
        onChange={(event) => onQueryChange(event.target.value)}
      />

      <div className={styles.group}>
        {TRANSPORTS.map(({ value, label }) => (
          <button
            type="button"
            key={value}
            className={classNames(
              styles.chip,
              value === transport && styles.active,
            )}
            onClick={() => onTransportChange(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <span className={styles.count}>
        {shown === total ? `${total}` : `${shown} / ${total}`} requests
      </span>
    </div>
  );
}
