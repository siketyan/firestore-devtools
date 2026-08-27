/**
 * Background service worker.
 *
 * Fans the capture events coming from every tab's content script out to the
 * DevTools panels watching that tab, and keeps a bounded backlog per tab so a
 * panel opened mid-session still sees the recent traffic.
 */
import { ExchangeStore } from "../shared/store";
import {
  type CaptureMessage,
  PANEL_PORT_NAME,
  type PanelRequest,
  type PanelResponse,
} from "../shared/types";

const backlogs = new Map<number, ExchangeStore>();
const panelPorts = new Map<number, Set<chrome.runtime.Port>>();

function backlogFor(tabId: number): ExchangeStore {
  let store = backlogs.get(tabId);
  if (!store) {
    // The panels build the action view themselves; here it would be pure
    // work per tab for nobody to read.
    store = new ExchangeStore({ actions: false });
    backlogs.set(tabId, store);
  }
  return store;
}

function broadcast(tabId: number, message: PanelResponse): void {
  const ports = panelPorts.get(tabId);
  if (!ports) return;

  for (const port of ports) {
    try {
      port.postMessage(message);
    } catch {
      ports.delete(port);
    }
  }
}

chrome.runtime.onMessage.addListener((message: CaptureMessage, sender) => {
  if (message?.type !== "firestore-devtools/capture") return;

  const tabId = sender.tab?.id;
  if (tabId == null) return;

  backlogFor(tabId).apply(message.event);
  broadcast(tabId, { type: "event", event: message.event });
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PANEL_PORT_NAME) return;

  let subscribedTabId: number | undefined;

  port.onMessage.addListener((request: PanelRequest) => {
    switch (request?.type) {
      case "subscribe": {
        subscribedTabId = request.tabId;

        let ports = panelPorts.get(request.tabId);
        if (!ports) {
          ports = new Set();
          panelPorts.set(request.tabId, ports);
        }
        ports.add(port);

        port.postMessage({
          type: "snapshot",
          exchanges: [...backlogFor(request.tabId).getSnapshot()],
        } satisfies PanelResponse);
        break;
      }

      case "clear": {
        backlogFor(request.tabId).clear();
        broadcast(request.tabId, { type: "cleared" });
        break;
      }
    }
  });

  port.onDisconnect.addListener(() => {
    if (subscribedTabId == null) return;
    const ports = panelPorts.get(subscribedTabId);
    ports?.delete(port);
    if (ports && ports.size === 0) panelPorts.delete(subscribedTabId);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  backlogs.delete(tabId);
  panelPorts.delete(tabId);
});
