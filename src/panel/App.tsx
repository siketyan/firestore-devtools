import { useEffect, useMemo, useRef, useState } from "react";

import type { Action } from "../shared/actions";
import { exportCapture, toJson } from "../shared/export";
import * as styles from "./App.module.css";
import { ActionDetail } from "./components/ActionDetail";
import { ActionList } from "./components/ActionList";
import { type KindFilter, matchesKind, Toolbar } from "./components/Toolbar";
import { usePersistentFlag } from "./preferences";
import { timelineOf } from "./timeline";
import { downloadText } from "./transfer";
import { useCapture } from "./useCapture";

function matches(action: Action, query: string, kind: KindFilter): boolean {
  if (!matchesKind(action.kind, kind)) return false;
  if (!query) return true;

  const needle = query.toLowerCase();
  return (
    action.target.toLowerCase().includes(needle) ||
    (action.detail ?? "").toLowerCase().includes(needle) ||
    (action.request?.raw ?? "").toLowerCase().includes(needle) ||
    action.responses.some((frame) => frame.raw.toLowerCase().includes(needle))
  );
}

export function App() {
  const { actions, clear } = useCapture();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [preserveLog, setPreserveLog] = usePersistentFlag(
    "firestore-devtools/preserve-log",
    false,
  );

  // The listener is registered once, so it reads the toggle through a ref
  // rather than being torn down and rebuilt every time the toggle moves.
  const preserving = useRef(preserveLog);
  preserving.current = preserveLog;

  useEffect(() => {
    const onNavigated = () => {
      if (preserving.current) return;
      setSelectedId(undefined);
      clear();
    };

    chrome.devtools.network.onNavigated.addListener(onNavigated);
    return () =>
      chrome.devtools.network.onNavigated.removeListener(onNavigated);
  }, [clear]);

  const visible = useMemo(
    () => actions.filter((action) => matches(action, query, kind)),
    [actions, query, kind],
  );

  // Drawn against the whole capture, so filtering does not rescale the bars.
  const timeline = useMemo(() => timelineOf(actions), [actions]);

  const selected = visible.find((action) => action.id === selectedId);

  return (
    <div className={styles.app}>
      <Toolbar
        query={query}
        onQueryChange={setQuery}
        kind={kind}
        onKindChange={setKind}
        onClear={() => {
          setSelectedId(undefined);
          clear();
        }}
        preserveLog={preserveLog}
        onPreserveLogChange={setPreserveLog}
        onExport={() => {
          const now = new Date();
          downloadText(
            `firestore-${now.toISOString().replace(/[:.]/g, "-")}.json`,
            toJson(exportCapture(actions, now.getTime())),
          );
        }}
        shown={visible.length}
        total={actions.length}
      />

      <div className={styles.body}>
        <ActionList
          actions={visible}
          timeline={timeline}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        {selected ? (
          <ActionDetail
            action={selected}
            onClose={() => setSelectedId(undefined)}
          />
        ) : null}
      </div>
    </div>
  );
}
