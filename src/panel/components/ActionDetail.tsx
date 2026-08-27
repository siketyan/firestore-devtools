import { useState } from "react";

import type { Action } from "../../shared/actions";
import type { Frame } from "../../shared/types";
import { classNames } from "../classNames";
import { formatBytes, formatTime } from "../format";
import * as styles from "./ActionDetail.module.css";
import { VERBS } from "./ActionList";
import { JsonView } from "./JsonView";

type Tab = "request" | "responses";

const TABS: Array<{ value: Tab; label: string }> = [
  { value: "request", label: "Request" },
  { value: "responses", label: "Responses" },
];

export interface ActionDetailProps {
  action: Action;
  onClose: () => void;
}

export function ActionDetail({ action, onClose }: ActionDetailProps) {
  const [tab, setTab] = useState<Tab>("responses");
  const [selectedFrameId, setSelectedFrameId] = useState<string | undefined>();

  const selectedFrame =
    action.responses.find((frame) => frame.id === selectedFrameId) ??
    action.responses.at(-1);

  return (
    <aside className={styles.detail}>
      <header className={styles.header}>
        <span className={styles.verb}>{VERBS[action.kind]}</span>
        <span className={styles.subject}>
          <span className={styles.target}>{action.target}</span>
          {action.detail ? (
            <span className={styles.query}>{action.detail}</span>
          ) : null}
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

      <div className={styles.tabbar}>
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
      </div>

      <div className={styles.body}>
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
