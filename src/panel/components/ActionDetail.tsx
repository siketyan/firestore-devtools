import { useState } from "react";

import type { Action } from "../../shared/actions";
import { exportAction, toJson } from "../../shared/export";
import {
  type ResponseItem,
  requestPayload,
  responseItems,
} from "../../shared/payloads";
import { classNames, formatBytes, formatTime } from "../format";
import { copyText } from "../transfer";
import * as styles from "./ActionDetail.module.css";
import { VERBS } from "./ActionList";
import { JsonView } from "./JsonView";

type Tab = "request" | "responses";

const TABS: Array<{ value: Tab; label: string }> = [
  { value: "request", label: "Request" },
  { value: "responses", label: "Responses" },
];

export function ActionDetail({
  action,
  onClose,
}: {
  action: Action;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("responses");
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const done = await copyText(toJson(exportAction(action)));
    if (!done) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Cheap enough to derive on every render, and the store only publishes once
  // per animation frame.
  const items = responseItems(action);
  const selectedItem =
    items.find((item) => item.id === selectedItemId) ?? items.at(-1);

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
          className={styles.copy}
          onClick={copy}
          title="Copy this action as JSON"
        >
          {copied ? "Copied" : "Copy"}
        </button>
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
            items={items}
            selectedItem={selectedItem}
            onSelect={setSelectedItemId}
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
      <JsonView value={requestPayload(action)} defaultExpandedDepth={4} />
    </div>
  );
}

/** Strips the collection an action already names off each result's path. */
function shortPath(path: string, target: string): string {
  return path.startsWith(`${target}/`) ? path.slice(target.length + 1) : path;
}

function Responses({
  action,
  items,
  selectedItem,
  onSelect,
}: {
  action: Action;
  items: readonly ResponseItem[];
  selectedItem: ResponseItem | undefined;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) {
    return <p className={styles.empty}>Nothing has come back yet.</p>;
  }

  return (
    <div className={styles.responses}>
      <ol className={styles.list}>
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={classNames(
                styles.item,
                item.removed && styles.removed,
                item.id === selectedItem?.id && styles.selected,
              )}
              onClick={() => onSelect(item.id)}
            >
              <span className={styles.label}>
                {shortPath(item.path, action.target)}
              </span>
              <span className={styles.meta}>
                {item.removed ? "removed" : formatBytes(item.byteLength)} ·{" "}
                {formatTime(item.timestamp)}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className={styles.payload}>
        {selectedItem?.body !== undefined ? (
          <JsonView value={selectedItem.body} defaultExpandedDepth={4} />
        ) : null}
      </div>
    </div>
  );
}
