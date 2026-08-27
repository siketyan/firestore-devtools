import { useState } from "react";

import type { Direction, Exchange, Frame } from "../../shared/types";
import { classNames } from "../classNames";
import { formatBytes, formatDuration, formatJson, formatTime } from "../format";
import * as styles from "./ExchangeDetail.module.css";
import { JsonView } from "./JsonView";

type Tab = "overview" | "headers" | "frames";

/** Static lookup, so the namespace import is never indexed dynamically. */
const DIRECTION_STYLE: Record<Direction, string | undefined> = {
  outbound: styles.outbound,
  inbound: styles.inbound,
};

const TABS: Array<{ value: Tab; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "headers", label: "Headers" },
  { value: "frames", label: "Messages" },
];

export interface ExchangeDetailProps {
  exchange: Exchange;
  onClose: () => void;
}

export function ExchangeDetail({ exchange, onClose }: ExchangeDetailProps) {
  const [tab, setTab] = useState<Tab>("frames");
  const [selectedFrameId, setSelectedFrameId] = useState<string | undefined>();

  const selectedFrame =
    exchange.frames.find((frame) => frame.id === selectedFrameId) ??
    exchange.frames.at(-1);

  return (
    <aside className={styles.detail}>
      <header className={styles.header}>
        <div className={styles.tabs}>
          {TABS.map(({ value, label }) => (
            <button
              type="button"
              key={value}
              className={classNames(styles.tab, value === tab && styles.active)}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          title="Close"
        >
          ×
        </button>
      </header>

      <div className={styles.body}>
        {tab === "overview" ? <Overview exchange={exchange} /> : null}
        {tab === "headers" ? <Headers exchange={exchange} /> : null}
        {tab === "frames" ? (
          <Frames
            exchange={exchange}
            selectedFrame={selectedFrame}
            onSelect={setSelectedFrameId}
          />
        ) : null}
      </div>
    </aside>
  );
}

function Overview({ exchange }: { exchange: Exchange }) {
  const rows: Array<[string, string]> = [
    ["RPC", `${exchange.rpc.service}/${exchange.rpc.method}`],
    [
      "Transport",
      exchange.rpc.transport === "webchannel"
        ? "WebChannel (streaming)"
        : "HTTP (unary)",
    ],
    ["Database", exchange.rpc.database ?? "—"],
    ["Method", exchange.method],
    ["URL", exchange.url],
    ["Page", exchange.pageUrl],
    [
      "Status",
      exchange.error ??
        `${exchange.status ?? "—"} ${exchange.statusText ?? ""}`.trim(),
    ],
    ["State", exchange.state],
    ["Started", formatTime(exchange.startedAt)],
    [
      "Duration",
      formatDuration(
        exchange.finishedAt
          ? exchange.finishedAt - exchange.startedAt
          : undefined,
      ),
    ],
    ["Sent", formatBytes(exchange.bytesSent)],
    ["Received", formatBytes(exchange.bytesReceived)],
    ["Messages", String(exchange.frames.length)],
  ];

  return <DefinitionList rows={rows} />;
}

function Headers({ exchange }: { exchange: Exchange }) {
  return (
    <>
      <h3 className={styles.heading}>Request headers</h3>
      <DefinitionList rows={Object.entries(exchange.requestHeaders)} />
      <h3 className={styles.heading}>Response headers</h3>
      <DefinitionList rows={Object.entries(exchange.responseHeaders)} />
    </>
  );
}

function Frames({
  exchange,
  selectedFrame,
  onSelect,
}: {
  exchange: Exchange;
  selectedFrame: Frame | undefined;
  onSelect: (id: string) => void;
}) {
  if (exchange.frames.length === 0) {
    return <p className={styles.empty}>No messages captured.</p>;
  }

  return (
    <div className={styles.frames}>
      <ol className={styles.list}>
        {exchange.frames.map((frame) => (
          <li key={frame.id}>
            <button
              type="button"
              className={classNames(
                styles.item,
                DIRECTION_STYLE[frame.direction],
                frame.id === selectedFrame?.id && styles.selected,
              )}
              onClick={() => onSelect(frame.id)}
            >
              <span className={styles.arrow}>
                {frame.direction === "outbound" ? "↑" : "↓"}
              </span>
              <span className={styles.label}>
                {frame.label ?? frame.raw.slice(0, 80)}
              </span>
              <span className={styles.meta}>
                {formatBytes(frame.byteLength)} · {formatTime(frame.timestamp)}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className={styles.payload}>
        {selectedFrame ? (
          selectedFrame.decoded !== undefined ? (
            <JsonView value={selectedFrame.decoded} defaultExpandedDepth={4} />
          ) : (
            <pre className={styles.raw}>
              {formatJson(selectedFrame.decoded, selectedFrame.raw)}
            </pre>
          )
        ) : null}
      </div>
    </div>
  );
}

function DefinitionList({ rows }: { rows: Array<readonly [string, string]> }) {
  if (rows.length === 0) return <p className={styles.empty}>None.</p>;

  return (
    <dl className={styles.definitions}>
      {rows.map(([term, description]) => (
        <div className={styles.row} key={term}>
          <dt>{term}</dt>
          <dd>{description}</dd>
        </div>
      ))}
    </dl>
  );
}
