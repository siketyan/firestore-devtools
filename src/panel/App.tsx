import { useMemo, useState } from "react";

import type { Action } from "../shared/actions";
import { exportCapture, toJson } from "../shared/export";
import * as styles from "./App.module.css";
import { ActionDetail } from "./components/ActionDetail";
import { ActionList } from "./components/ActionList";
import { type KindFilter, matchesKind, Toolbar } from "./components/Toolbar";
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
