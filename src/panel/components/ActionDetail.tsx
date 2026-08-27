import { useState } from "react";

import type { Action } from "../../shared/actions";
import type { Exchange, Frame } from "../../shared/types";
import { classNames } from "../classNames";
import { formatBytes, formatDuration, formatTime } from "../format";
import * as styles from "./ActionDetail.module.css";
import { JsonView } from "./JsonView";

type Tab = "overview" | "request" | "responses";

const TABS: Array<{ value: Tab; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "request", label: "Request" },
  { value: "responses", label: "Responses" },
];

const KIND_LABELS: Record<Action["kind"], string> = {
  listen: "Listener",
  query: "Query",
  get: "Document read",
  write: "Write",
  transaction: "Transaction",
  channel: "Transport",
};

export interface ActionDetailProps {
  action: Action;
  /** The HTTP exchanges this action's messages travelled on. */
  exchanges: readonly Exchange[];
  onClose: () => void;
}

export function ActionDetail({
  action,
  exchanges,
  onClose,
}: ActionDetailProps) {
  const [tab, setTab] = useState<Tab>("responses");
  const [selectedFrameId, setSelectedFrameId] = useState<string | undefined>();

  const selectedFrame =
    action.responses.find((frame) => frame.id === selectedFrameId) ??
    action.responses.at(-1);

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
        {tab === "overview" ? (
          <Overview action={action} exchanges={exchanges} />
        ) : null}
        {tab === "request" ? <Request action={action} /> : null}
        {tab === "responses" ? (
          <Responses
            action={action}
            selectedFrame={selectedFrame}
            onSelect={setSelectedFrameId}
          />
        ) : null}
      </div>
    </aside>
  );
}

function Overview({
  action,
  exchanges,
}: {
  action: Action;
  exchanges: readonly Exchange[];
}) {
  const rows: Array<[string, string]> = [
    ["Action", KIND_LABELS[action.kind]],
    ["RPC", action.method],
    ["Target", action.target],
  ];

  if (action.detail) rows.push(["Query", action.detail]);
  if (action.targetId != null) {
    rows.push(["Target id", String(action.targetId)]);
  }

  rows.push(
    ["Database", action.database ?? "—"],
    [
      "Transport",
      action.transport === "webchannel"
        ? "WebChannel (streaming)"
        : "HTTP (unary)",
    ],
    ["State", action.error ?? `${action.status ?? ""} ${action.state}`.trim()],
    ["Started", formatTime(action.startedAt)],
    [
      "First response",
      action.respondedAt
        ? `${formatTime(action.respondedAt)} (${formatDuration(
            action.respondedAt - action.startedAt,
          )})`
        : "—",
    ],
    ["Ended", action.endedAt ? formatTime(action.endedAt) : "—"],
    ["Documents", String(action.documentCount)],
    ["Responses", String(action.responses.length)],
    ["Size", formatBytes(action.byteLength)],
  );

  return (
    <>
      <DefinitionList rows={rows} />

      <h3 className={styles.heading}>
        {/* A streaming action is stitched together from more than one. */}
        HTTP exchanges
      </h3>
      <DefinitionList
        rows={exchanges.map(
          (exchange) =>
            [
              `${exchange.method} ${exchange.status ?? exchange.state}`,
              exchange.url,
            ] as const,
        )}
      />
    </>
  );
}

function Request({ action }: { action: Action }) {
  if (!action.request) {
    return (
      <p className={styles.empty}>
        This action carried no request body — the URL was the whole request.
      </p>
    );
  }

  return (
    <div className={styles.payload}>
      <JsonView
        value={action.request.decoded ?? action.request.raw}
        defaultExpandedDepth={4}
      />
    </div>
  );
}

function Responses({
  action,
  selectedFrame,
  onSelect,
}: {
  action: Action;
  selectedFrame: Frame | undefined;
  onSelect: (id: string) => void;
}) {
  if (action.responses.length === 0) {
    return <p className={styles.empty}>No responses yet.</p>;
  }

  return (
    <div className={styles.responses}>
      <ol className={styles.list}>
        {action.responses.map((frame) => (
          <li key={frame.id}>
            <button
              type="button"
              className={classNames(
                styles.item,
                frame.id === selectedFrame?.id && styles.selected,
              )}
              onClick={() => onSelect(frame.id)}
            >
              <span className={styles.arrow}>↓</span>
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
          <JsonView
            value={selectedFrame.decoded ?? selectedFrame.raw}
            defaultExpandedDepth={4}
          />
        ) : null}
      </div>
    </div>
  );
}

function DefinitionList({
  rows,
}: {
  rows: ReadonlyArray<readonly [string, string]>;
}) {
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
