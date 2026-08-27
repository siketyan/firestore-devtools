# Notes for working on this repository

## Stack

[Extension.js](https://extension.js.org) (rspack under the hood), React and
TypeScript. Biome for lint and formatting, Vitest for tests, pnpm for packages.

Everything is pinned: dependencies to exact versions (`pnpm-workspace.yaml`
sets `savePrefix: ''` so they stay that way), pnpm through
`package.json#packageManager`, and every GitHub Action to a commit SHA with
the release in a trailing comment. `zizmor --persona=auditor` runs over the
workflows in CI and has to stay clean, which is what keeps those pins honest.

Biome runs on its defaults apart from `indentStyle: space`. Don't add
formatter options to win an argument with it.

## What the extension is decoding

The Firestore Web SDK does not speak gRPC from the browser. It uses two
transports and the panel understands both:

| Transport | RPCs | Shape on the wire |
| --- | --- | --- |
| **WebChannel** | `Listen`, `Write` | `POST .../google.firestore.v1.Firestore/Listen/channel?…`, one long-lived response carrying length-prefixed JSON chunks |
| **HTTP** | `Commit`, `RunQuery`, `BatchGetDocuments`, … | `POST .../v1/projects/p/databases/d/documents:commit` with a protobuf-JSON body |

Requests are matched on their path rather than their host, so the emulator
(`http://localhost:8080/…`) is picked up as well.

### Putting requests back together with their responses

On the WebChannel streams a request and its responses are on *different* HTTP
exchanges: `addTarget` goes out on a short POST, and everything the server has
to say about it comes back on a long-lived backchannel shared by every listener
on the page. The only thing relating the two is the `targetId` the SDK assigns,
so that is what `shared/actions.ts` correlates on — along with `targetIds` on
each `documentChange`, and `removedTargetIds` on each delete. An empty
`targetIds` means every open target, per the protocol, and a re-sent
`addTarget` after a reconnect resumes the same action rather than starting
another.

`Write` has no such id, but the stream is strictly ordered, so its results are
matched to their requests first-in-first-out.

Messages that belong to no action — channel handshakes, `noop` keepalives —
are dropped from the action projection. They are transport bookkeeping, not
something anyone asked for; the Transport view is where you go when the
channel itself is the thing misbehaving, and it lists the exchanges and their
frames untouched.

### Actions, not RPCs

The panel lists what the developer asked for rather than how the SDK delivered
it. A one-shot `getDocs()` opens a `Listen` target exactly as `onSnapshot()`
does, so both are a `QUERY`; whether one is still running is the *status*, not
a different kind of row. Don't reintroduce the distinction in the list.

## Architecture

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

- **`src/content/interceptor.ts`** runs in the page's own realm
  (`world: "MAIN"`) at `document_start`, so it wraps `fetch` and
  `XMLHttpRequest` before the Firebase SDK captures its own references to them.
  It cannot use `chrome.*`, so it posts what it captures with
  `window.postMessage`. The wrapping itself lives in `src/content/capture/`.
- **`src/content/bridge.ts`** runs in the isolated realm of the same document
  and forwards those messages to the background worker.
- **`src/background/index.ts`** keeps a bounded backlog per tab, so a panel
  opened mid-session still sees recent traffic, and fans events out to the
  panels watching that tab.
- **`src/panel/`** is the React app. It keeps its own `ExchangeStore` — the
  same class the background uses — fed by the same event stream, so the two
  cannot drift apart, and it survives the service worker idling out.

`src/shared/` holds what both sides need:

- **`firestore.ts`** maps a request URL to an RPC.
- **`webchannel.ts`** implements the Closure WebChannel framing: a form-encoded
  `req0___data__=…` body outbound, length-prefixed JSON chunks inbound.
- **`proto.ts`** reads the protobuf-JSON shapes — resource names, `Value`
  wrappers, and the part of `StructuredQuery` that says which collection is
  being read. A document is shown with its fields unwrapped and its metadata
  left alone; an `integerValue` only becomes a number while that is lossless.
- **`payloads.ts`** digs the query out of a request and the documents out of
  the responses, which is what the detail pane shows. Neither view should ever
  render the envelope a payload arrived in.
- **`actions.ts`** is the correlator above, and the projection the panel lists.
- **`export.ts`** turns actions into what leaves the panel — the clipboard, a
  file — which is the same payloads the detail pane shows, with timestamps as
  ISO strings. Bump `EXPORT_VERSION` when that shape changes in a way a reader
  would notice.
- **`store.ts`** replays capture events into both projections. The background
  worker leaves the action one switched off — nothing there reads it.

The action projection is built incrementally and has to see messages in arrival
order, so it lives in the store rather than being derived in the panel.
Rebuilding it from a backlog snapshot replays the frames sorted by timestamp,
because a stream's responses interleave with requests that arrived on other
exchanges.

## Things that will catch you out

- **Extension.js manifest paths point at the source.** `src/manifest.json` and
  the `<script src>` in each HTML page name the `.ts`/`.tsx` file, not the
  built `.js`; the build rewrites them. Pointing at a `.js` that does not exist
  fails the build, or silently ships an empty placeholder for a page script.
- **CSS modules have no default export.** Extension.js compiles `.module.css`
  as `css/module`, and its `namedExports: false` only applies to `css/auto`, so
  `import styles from …` finds nothing at build time. Use
  `import * as styles from "./X.module.css"`, and never index that namespace
  with a runtime value — Biome rejects it, and a static lookup map is clearer
  anyway.
- **`src/css.d.ts` exists for a reason.** Extension.js declares the CSS
  wildcard modules in a type entrypoint that is itself a module, so TypeScript
  reads them as augmentations and never matches an import against them. The
  local ambient declaration is what makes them apply.
- **`chrome-headless-shell` cannot load extensions.** It accepts
  `--load-extension` and ignores it. `tests/e2e/support/browser.ts` asks for
  the `chromium` channel — the full build — whenever it has not been pointed at
  a binary through `CHROMIUM_PATH`.
- **Chrome and Firefox disagree about `devtools.panels.create`.** Chrome
  resolves the paths it is given against the extension root, Firefox against
  the devtools page doing the calling. The paths in `src/devtools/scripts.ts`
  are root-relative so both agree; getting this wrong shows up as a blank
  panel, not as an error.

## Panel preferences

`localStorage` is per-extension-origin and never leaves the browser, which is
the right home for something as small as the Preserve log toggle — but it
throws outright when a browser is set to block site data, so every access goes
through the guarded helpers in `src/panel/preferences.ts`.

## Tests

`tests/unit/` covers the parts with awkward edges — the URL-to-RPC mapping, the
WebChannel framing across split reads and a `responseText` that grows in place,
the correlator, the payload extraction. `tests/e2e/` builds the extension and
drives that build in a real browser.

Both share `tests/support/session.ts`, a scripted session shaped like the real
thing: two listeners sharing one backchannel, their requests on separate
exchanges, a write stream answering out of band, a one-shot query and a
document read that was refused. Extend that fixture rather than inventing a
second one — the panel screenshots in the README are rendered from it too
(`pnpm screenshot`).
