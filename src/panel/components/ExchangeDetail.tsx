import { useState } from "react";

import type { Direction, Exchange } from "../../shared/types";
import { classNames, formatBytes, formatTime } from "../format";
import { describeFrame } from "../frames";
import * as styles from "./ExchangeDetail.module.css";
import { JsonView } from "./JsonView";

/** Static lookup, so the namespace import is never indexed dynamically. */
const DIRECTION_STYLE: Record<Direction, string | undefined> = {
  outbound: styles.outbound,
  inbound: styles.inbound,
};

export function ExchangeDetail({
  exchange,
  onClose,
}: {
  exchange: Exchange;
  onClose: () => void;
}) {
  const [selectedFrameId, setSelectedFrameId] = useState<string | undefined>();

  const selected =
    exchange.frames.find((frame) => frame.id === selectedFrameId) ??
    exchange.frames.at(-1);

  return (
    <aside className={styles.detail}>
      <header className={styles.header}>
        <span className={styles.rpc}>{exchange.rpc.method}</span>
        <span className={styles.meta}>
          {exchange.rpc.database ?? exchange.rpc.resource ?? ""}
        </span>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          title="Close"
        >
          ×
        </button>
      </header>

      {exchange.frames.length === 0 ? (
        <p className={styles.empty}>Nothing has gone over this yet.</p>
      ) : (
        <div className={styles.frames}>
          <ol className={styles.list}>
            {exchange.frames.map((frame) => (
              <li key={frame.id}>
                <button
                  type="button"
                  className={classNames(
                    styles.item,
                    DIRECTION_STYLE[frame.direction],
                    frame.id === selected?.id && styles.selected,
                  )}
                  onClick={() => setSelectedFrameId(frame.id)}
                >
                  <span className={styles.arrow}>
                    {frame.direction === "outbound" ? "↑" : "↓"}
                  </span>
                  <span className={styles.label}>{describeFrame(frame)}</span>
                  <span className={styles.size}>
                    {formatBytes(frame.byteLength)} ·{" "}
                    {formatTime(frame.timestamp)}
                  </span>
                </button>
              </li>
            ))}
          </ol>

          <div className={styles.payload}>
            {selected ? (
              selected.decoded === undefined ? (
                <pre className={styles.raw}>{selected.raw}</pre>
              ) : (
                <JsonView value={selected.decoded} defaultExpandedDepth={4} />
              )
            ) : null}
          </div>
        </div>
      )}
    </aside>
  );
}
