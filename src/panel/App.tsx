import { useEffect, useMemo, useRef, useState } from "react";

import type { Action } from "../shared/actions";
import { exportCapture, toJson } from "../shared/export";
import type { Exchange } from "../shared/types";
import * as styles from "./App.module.css";
import { ActionDetail } from "./components/ActionDetail";
import { ActionList } from "./components/ActionList";
import { ExchangeDetail } from "./components/ExchangeDetail";
import { ExchangeList } from "./components/ExchangeList";
import {
  type KindFilter,
  matchesKind,
  Toolbar,
  type View,
} from "./components/Toolbar";
import { describeFrame } from "./frames";
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

/** The raw view searches the wire, because that is what it is showing. */
function exchangeMatches(exchange: Exchange, query: string): boolean {
  if (!query) return true;

  const needle = query.toLowerCase();
  return (
    exchange.rpc.method.toLowerCase().includes(needle) ||
    (exchange.rpc.database ?? "").toLowerCase().includes(needle) ||
    exchange.frames.some(
      (frame) =>
        frame.raw.toLowerCase().includes(needle) ||
        describeFrame(frame).toLowerCase().includes(needle),
    )
  );
}

export function App() {
  const { actions, exchanges, clear } = useCapture();
  const [view, setView] = useState<View>("actions");
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

  const visibleExchanges = useMemo(
    () => exchanges.filter((exchange) => exchangeMatches(exchange, query)),
    [exchanges, query],
  );

  const selectedAction = visible.find((action) => action.id === selectedId);
  const selectedExchange = visibleExchanges.find(
    (exchange) => exchange.id === selectedId,
  );

  const showing = view === "actions" ? visible : visibleExchanges;
  const captured = view === "actions" ? actions : exchanges;

  return (
    <div className={styles.app}>
      <Toolbar
        view={view}
        onViewChange={(next) => {
          // The two lists have different ids; a selection cannot survive.
          setSelectedId(undefined);
          setView(next);
        }}
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
        shown={showing.length}
        total={captured.length}
      />

      <div className={styles.body}>
        {view === "actions" ? (
          <>
            <ActionList
              actions={visible}
              timeline={timeline}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            {selectedAction ? (
              <ActionDetail
                action={selectedAction}
                onClose={() => setSelectedId(undefined)}
              />
            ) : null}
          </>
        ) : (
          <>
            <ExchangeList
              exchanges={visibleExchanges}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            {selectedExchange ? (
              <ExchangeDetail
                exchange={selectedExchange}
                onClose={() => setSelectedId(undefined)}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
