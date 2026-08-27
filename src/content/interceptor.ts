/**
 * MAIN world content script.
 *
 * Runs at `document_start` in the page's own realm so that it can wrap `fetch`
 * and `XMLHttpRequest` before the Firebase SDK grabs a reference to them, and
 * see the streaming bodies as they arrive. It has no access to `chrome.*`, so
 * everything it captures is posted to the isolated-world bridge, which relays
 * it to the background worker.
 */
import {patchFetch} from './capture/fetch'
import {patchXhr} from './capture/xhr'

declare global {
  interface Window {
    __firestoreDevtoolsInstalled?: boolean
  }
}

if (!window.__firestoreDevtoolsInstalled) {
  window.__firestoreDevtoolsInstalled = true
  patchFetch()
  patchXhr()
}
