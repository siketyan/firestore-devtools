# Firestore DevTools

A browser extension that adds a **Firestore** panel to the browser DevTools and
shows what a page is doing with Cloud Firestore — the queries, the document
reads, the listeners and the writes — with the collection or document each one
touches as its title.

The Network tab can only show you HTTP requests, which is the wrong unit here:
one listener's request and its responses travel on two different requests, and
neither of them is named after anything you wrote.

<div>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/siketyan/firestore-devtools/main/docs/panel-dark.png">
    <img alt="The Firestore panel: a list of actions, and the documents a selected listener has received" src="https://raw.githubusercontent.com/siketyan/firestore-devtools/main/docs/panel-light.png">
  </picture>
</div>

> **Status: early**, but complete enough to use: it captures both transports,
> puts each request back together with its responses, and shows them as the
> queries, reads, listeners and writes the app actually made.

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

Every push and pull request also uploads an unpacked build per browser as a CI
artifact, if you would rather install one than build it: `chrome://extensions`
▸ Load unpacked, or `about:debugging` ▸ Load Temporary Add-on.

Other commands:

```sh
pnpm build          # production build into dist/<browser>
pnpm build:firefox  # ...for a specific browser
pnpm preview        # load a production build in a browser
pnpm typecheck      # tsc --noEmit, over src and tests
pnpm lint           # biome check
pnpm lint:fix       # biome check --write
pnpm format         # biome format --write
pnpm screenshot     # regenerate the images above
```

## Browsers

Chromium, Edge and Firefox 128 or newer. The interceptor is a `world: "MAIN"`
content script, which Firefox only supports from 128, so the Firefox build
declares that as its `strict_min_version` rather than installing and quietly
capturing nothing.

## Tests

```sh
pnpm test           # everything
pnpm test:unit      # the decoders, the correlator, the payload extraction
pnpm test:e2e       # the built extension, in a real browser
```

The unit tests run against a scripted session — two listeners sharing one
backchannel, a write stream, a one-shot query and a document read that was
refused — which is also the fixture the panel tests render.

The e2e tests need a browser (`pnpm exec playwright install chromium`, or
`CHROMIUM_PATH=/path/to/chrome` when the box already has one — it has to be a
full Chromium, since `chrome-headless-shell` cannot load extensions). They
build the extension first and drive *that*: one suite loads it into Chromium
against a stand-in for `firestore.googleapis.com` and reads what the
interceptor captured, the others open the real panel and check what it says.

## Contributing

[`CLAUDE.md`](CLAUDE.md) has the architecture, the Firestore wire formats the
extension decodes, and the conventions this repository holds to.
