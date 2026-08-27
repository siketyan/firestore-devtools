import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { Action } from "../shared/actions";
import { ExchangeStore } from "../shared/store";
import {
  type Exchange,
  PANEL_PORT_NAME,
  type PanelRequest,
  type PanelResponse,
} from "../shared/types";

export interface Capture {
  /** The traffic seen as the actions that produced it. */
  actions: readonly Action[];
  /** The HTTP exchanges an action's messages travelled on. */
  exchangesOf: (action: Action) => Exchange[];
  clear: () => void;
}

/**
 * Coalesces notifications to one per animation frame, so a chatty stream
 * cannot re-render the panel once per message.
 */
function batchByFrame(subscribe: (listener: () => void) => () => void) {
  return (listener: () => void): (() => void) => {
    let frame = 0;

    const unsubscribe = subscribe(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        listener();
      });
    });

    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
    };
  };
}

/**
 * Mirrors the background worker's capture buffer for the inspected tab into a
 * local store, and exposes it to React.
 */
export function useCapture(): Capture {
  const [store] = useState(() => new ExchangeStore());
  const portRef = useRef<chrome.runtime.Port | undefined>(undefined);

  const subscribe = useMemo(() => batchByFrame(store.subscribe), [store]);
  // Subscribing to the exchange snapshot is enough: the store rebuilds both
  // projections in the same mutation.
  useSyncExternalStore(subscribe, store.getSnapshot);
  const actions = store.getActions();

  useEffect(() => {
    const tabId = chrome.devtools.inspectedWindow.tabId;
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = (): void => {
      if (disposed) return;

      const port = chrome.runtime.connect({ name: PANEL_PORT_NAME });
      portRef.current = port;

      port.onMessage.addListener((message: PanelResponse) => {
        switch (message.type) {
          case "snapshot":
            // Only trust the backlog on the first connection: after the worker
            // has been suspended and restarted its buffer is empty, and the
            // panel is the one holding the full history.
            if (store.getSnapshot().length === 0)
              store.replace(message.exchanges);
            break;
          case "event":
            store.apply(message.event);
            break;
          case "cleared":
            store.clear();
            break;
        }
      });

      port.onDisconnect.addListener(() => {
        portRef.current = undefined;
        // The service worker idles out every ~30s; reconnect to wake it.
        if (!disposed) retry = setTimeout(connect, 250);
      });

      port.postMessage({ type: "subscribe", tabId } satisfies PanelRequest);
    };

    connect();

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      portRef.current?.disconnect();
      portRef.current = undefined;
    };
  }, [store]);

  const clear = (): void => {
    store.clear();
    portRef.current?.postMessage({
      type: "clear",
      tabId: chrome.devtools.inspectedWindow.tabId,
    } satisfies PanelRequest);
  };

  const exchangesOf = (action: Action): Exchange[] =>
    action.exchangeIds
      .map((id) => store.get(id))
      .filter((exchange): exchange is Exchange => exchange != null);

  return { actions, exchangesOf, clear };
}
