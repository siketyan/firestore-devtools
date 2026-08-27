import type { Exchange } from "../../shared/types";
import { classNames, formatBytes, formatDuration, formatTime } from "../format";
import { frameBytes } from "../frames";
import * as styles from "./ExchangeList.module.css";

function statusOf(exchange: Exchange): string {
  if (exchange.error) return "error";
  if (exchange.status) return String(exchange.status);
  return exchange.state;
}

export function ExchangeList({
  exchanges,
  selectedId,
  onSelect,
}: {
  exchanges: readonly Exchange[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  if (exchanges.length === 0) {
    return (
      <div className={classNames(styles.list, styles.empty)}>
        <p>No Firestore traffic captured yet.</p>
      </div>
    );
  }

  return (
    <div className={styles.list}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>RPC</th>
            <th>Transport</th>
            <th>Status</th>
            <th>Messages</th>
            <th>Size</th>
            <th>Duration</th>
            <th>Started</th>
          </tr>
        </thead>
        <tbody>
          {exchanges.map((exchange) => (
            <tr
              key={exchange.id}
              className={classNames(
                styles.row,
                exchange.state === "failed" && styles.failed,
                exchange.id === selectedId && styles.selected,
              )}
              onClick={() => onSelect(exchange.id)}
            >
              <td className={styles.rpc}>{exchange.rpc.method}</td>
              <td>
                {exchange.rpc.transport === "webchannel"
                  ? "WebChannel"
                  : "HTTP"}
              </td>
              <td>{statusOf(exchange)}</td>
              <td>{exchange.frames.length}</td>
              <td>{formatBytes(frameBytes(exchange.frames))}</td>
              <td>
                {formatDuration(
                  exchange.finishedAt
                    ? exchange.finishedAt - exchange.startedAt
                    : undefined,
                )}
              </td>
              <td>{formatTime(exchange.startedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
