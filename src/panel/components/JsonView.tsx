import { useState } from "react";

import { classNames } from "../format";
import * as styles from "./JsonView.module.css";

export function JsonView({
  value,
  defaultExpandedDepth = 2,
}: {
  value: unknown;
  /** Depth up to which nodes start expanded. */
  defaultExpandedDepth?: number;
}) {
  return (
    <div className={styles.json}>
      <JsonNode
        name={undefined}
        value={value}
        depth={0}
        defaultExpandedDepth={defaultExpandedDepth}
      />
    </div>
  );
}

interface JsonNodeProps {
  name: string | undefined;
  value: unknown;
  depth: number;
  defaultExpandedDepth: number;
}

function JsonNode({ name, value, depth, defaultExpandedDepth }: JsonNodeProps) {
  const [expanded, setExpanded] = useState(depth < defaultExpandedDepth);

  const isArray = Array.isArray(value);
  const isObject = !isArray && typeof value === "object" && value !== null;

  if (!isArray && !isObject) {
    return (
      <div className={styles.row} style={{ paddingLeft: depth * 12 }}>
        {name != null ? <span className={styles.key}>{name}: </span> : null}
        <span className={classNames(styles.value, valueStyle(value))}>
          {render(value)}
        </span>
      </div>
    );
  }

  const entries = isArray
    ? (value as unknown[]).map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);

  return (
    <div>
      <button
        type="button"
        className={classNames(styles.row, styles.toggle)}
        style={{ paddingLeft: depth * 12 }}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className={styles.caret}>{expanded ? "▾" : "▸"}</span>
        {name != null ? <span className={styles.key}>{name}: </span> : null}
        <span className={styles.summary}>
          {isArray ? `Array(${entries.length})` : `{${entries.length}}`}
        </span>
      </button>

      {expanded
        ? entries.map(([key, item]) => (
            <JsonNode
              key={key}
              name={key}
              value={item}
              depth={depth + 1}
              defaultExpandedDepth={defaultExpandedDepth}
            />
          ))
        : null}
    </div>
  );
}

/** The class that colours a leaf according to its JSON type. */
function valueStyle(value: unknown): string | undefined {
  if (value === null) return styles.null;

  switch (typeof value) {
    case "string":
      return styles.string;
    case "number":
      return styles.number;
    case "boolean":
      return styles.boolean;
    default:
      return styles.undefined;
  }
}

function render(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  return String(value);
}
