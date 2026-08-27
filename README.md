# Firestore DevTools

A browser extension that adds a **Firestore** panel to the browser DevTools and
shows what a page is doing with Cloud Firestore — the queries, the document
reads, the listeners and the writes — with the collection or document each one
touches as its title.

The Network tab can only show you HTTP requests, which is the wrong unit here:
one listener's request and its responses travel on two different requests, and
neither of them is named after anything you wrote.

Built with [Extension.js](https://extension.js.org), React and TypeScript.

> **Status: early.** The capture pipeline, the correlator and the panel work
> end to end; see [Roadmap](#roadmap) for what is still missing.

## What you see

One row per action, not per request. The verb comes first, like an HTTP method,
and the target is the collection or document it acts on:

| Action | Target | Status | Docs | Latency |
| --- | --- | --- | --- | --- |
| `QUERY` | **messages** | active | 2 | 230 ms |
| `GET` | **users/u1** | active | 1 | 690 ms |
| `WRITE` | **messages/m3** | complete | 1 | 60 ms |
| `QUERY` | **users** | 200 | 2 | 80 ms |
| `GET` | **users/u9** | 403 | — | 40 ms |

The verb is what the developer asked for rather than how the SDK delivered it.
A one-shot `getDocs()` opens a `Listen` target exactly as `onSnapshot()` does,
so both are a `QUERY`; whether one is still running shows up as its status
(`active` versus `complete`).

Selecting a row shows its query clauses, its request and every response it has
received so far.

## What it captures

The Firestore Web SDK does not speak gRPC directly from the browser. It uses
two transports, and the panel understands both:

| Transport | RPCs | Shape on the wire |
| --- | --- | --- |
| **WebChannel** (`Streaming`) | `Listen`, `Write` | `POST .../google.firestore.v1.Firestore/Listen/channel?…`, one long-lived response carrying length-prefixed JSON chunks |
| **HTTP** (`Unary`) | `Commit`, `RunQuery`, `BatchGetDocuments`, … | `POST .../v1/projects/p/databases/d/documents:commit` with a protobuf-JSON body |

Requests are matched on their path rather than their host, so the Firestore
emulator (`http://localhost:8080/…`) is picked up as well.

Streaming messages surface as they arrive, not when the stream finally closes.

### Putting requests back together with their responses

On the WebChannel streams a request and its responses are on *different* HTTP
exchanges: `addTarget` goes out on a short POST, and everything the server has
to say about it comes back on a long-lived backchannel that is shared by every
listener on the page. The only thing relating the two is the `targetId` the SDK
assigns, so that is what the panel correlates on — along with `targetIds` on
each `documentChange`, and `removedTargetIds` on each delete.

`Write` has no such id, but the stream is strictly ordered, so its results are
matched to their requests first-in-first-out.

Messages that belong to no action — the channel handshakes, the `noop`
keepalives — are dropped: they are transport bookkeeping, not something anyone
asked for.

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

`src/shared/` holds everything both sides need:

- **`firestore.ts`** maps a request URL to an RPC.
- **`webchannel.ts`** implements the Closure WebChannel framing (a form-encoded
  `req0___data__=…` body outbound, length-prefixed JSON chunks inbound).
- **`proto.ts`** reads the protobuf-JSON shapes: resource names, `Value`
  wrappers and `StructuredQuery`, which is what turns a query into
  `where read == false · orderBy createdAt desc · limit 25`.
- **`actions.ts`** is the correlator described above, and the projection the
  panel lists.
- **`store.ts`** replays the capture events into both projections. The
  background worker leaves the action one switched off — nothing there reads
  it.

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

Dependencies are pinned to exact versions; `pnpm-workspace.yaml` sets
`savePrefix: ''` so they stay that way.

## Roadmap

- Persist across page navigation, with a "preserve log" toggle.
- Unwrap the `Value` wrappers in document bodies too, so a `documentChange`
  reads as the document the app sees rather than as
  `{"body": {"stringValue": "hi"}}`. `proto.ts` already does this for the
  values inside a query.
- A raw transport view, for debugging the channel itself rather than the
  actions riding on it — the handshakes and keepalives the action view drops.
- Timeline/waterfall column.
- Copy as JSON, and export the capture.
- Firefox: `world: "MAIN"` content scripts need Firefox 128+; verify the
  WebChannel path there.
- Automated tests for the decoders, the correlator and the panel.
