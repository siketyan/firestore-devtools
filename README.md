# Firestore DevTools

A browser extension that adds a **Firestore** panel to the browser DevTools and
shows the traffic between the page and Cloud Firestore the way the Network tab
shows HTTP requests — including the long-lived streaming RPCs the Network tab
cannot usefully display.

Built with [Extension.js](https://extension.js.org), React and TypeScript.

> **Status: scaffolding.** The capture pipeline and the panel work end to end;
> see [Roadmap](#roadmap) for what is still missing.

## What it captures

The Firestore Web SDK does not speak gRPC directly from the browser. It uses
two transports, and the panel understands both:

| Transport | RPCs | Shape on the wire |
| --- | --- | --- |
| **WebChannel** (`Streaming`) | `Listen`, `Write` | `POST .../google.firestore.v1.Firestore/Listen/channel?…`, one long-lived response carrying length-prefixed JSON chunks |
| **HTTP** (`Unary`) | `Commit`, `RunQuery`, `BatchGetDocuments`, … | `POST .../v1/projects/p/databases/d/documents:commit` with a protobuf-JSON body |

Requests are matched on their path rather than their host, so the Firestore
emulator (`http://localhost:8080/…`) is picked up as well.

For each exchange the panel shows the RPC name, transport, status, message
count, size, duration, headers, and every decoded message in order, with the
direction (`↑` outbound / `↓` inbound) — the streaming ones as they arrive,
not only when the stream finally closes.

## How it works

Four contexts, because no single one can both see the traffic and talk to
DevTools:

```
page realm            isolated realm        extension              devtools
┌──────────────────┐  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│ content/         │  │ content/       │  │ background/    │  │ panel/         │
│ interceptor.ts   │→ │ bridge.ts      │→ │ index.ts       │→ │ React app      │
│                  │  │                │  │                │  │                │
│ wraps fetch and  │  │ relays via     │  │ per-tab ring   │  │ mirrors the    │
│ XMLHttpRequest   │  │ chrome.runtime │  │ buffer + fan   │  │ store, renders │
│ at document_start│  │ .sendMessage   │  │ out to panels  │  │ the list       │
└──────────────────┘  └────────────────┘  └────────────────┘  └────────────────┘
      postMessage            runtime msg          port
```

- **`src/content/interceptor.ts`** runs in the page's own realm (`world: "MAIN"`)
  at `document_start`, so it wraps `fetch` and `XMLHttpRequest` before the
  Firebase SDK captures its own references to them. It cannot use `chrome.*`,
  so it posts what it captures with `window.postMessage`. The wrapping itself
  lives in `src/content/capture/`.
- **`src/content/bridge.ts`** runs in the isolated realm of the same document
  and forwards those messages to the background worker.
- **`src/background/index.ts`** keeps a bounded backlog per tab (so a panel
  opened mid-session still sees recent traffic) and fans events out to the
  panels watching that tab.
- **`src/panel/`** is the React app. It keeps its own `ExchangeStore` — the same
  class the background uses — fed by the same event stream, so the two cannot
  drift apart, and it survives the service worker idling out.

Decoding lives in `src/shared/`: `firestore.ts` maps a URL to an RPC, and
`webchannel.ts` implements the Closure WebChannel framing (a form-encoded
`req0___data__=…` body outbound, length-prefixed JSON chunks inbound).

## Getting started

Requires Node.js 22.12 or newer. The pnpm version is pinned in
`package.json#packageManager`, so run it through Corepack (`corepack pnpm …`)
or any pnpm that honours that field.

```sh
pnpm install
pnpm dev             # launches a fresh Chromium with the extension loaded
```

Open DevTools on a page that uses Firestore and pick the **Firestore** tab.
Reload the page with the panel open to capture the initial `Listen` stream.

Other commands:

```sh
pnpm build          # production build into dist/<browser>
pnpm build:firefox  # ...for a specific browser
pnpm preview        # load a production build in a browser
pnpm typecheck      # tsc --noEmit
pnpm lint           # biome check
pnpm lint:fix       # biome check --write
pnpm format         # biome format --write
```

Dependencies are pinned to exact versions; `.npmrc` sets `save-exact` so they
stay that way.

## Roadmap

- Persist across page navigation, with a "preserve log" toggle.
- Decode the protobuf-JSON `Value` wrappers (`{"integerValue": "1"}` → `1`) into
  something closer to the document as the app sees it.
- Group the `Listen` messages by target so a query's lifecycle reads as one
  thing instead of interleaved `targetChange` / `documentChange` messages.
- Timeline/waterfall column.
- Copy as JSON, and export the capture.
- Firefox: `world: "MAIN"` content scripts need Firefox 128+; verify the
  WebChannel path there.
- Automated tests for the decoders and the panel.
