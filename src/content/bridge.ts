/**
 * Isolated world content script.
 *
 * The interceptor runs in the page's realm and therefore cannot talk to the
 * extension; this script sits in the same document with access to `chrome.*`
 * and forwards everything the interceptor posts to the background worker.
 */
import {
  PAGE_MESSAGE_SOURCE,
  type CaptureMessage,
  type PageMessage
} from '../shared/types'

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window) return

  const data = event.data as Partial<PageMessage> | undefined
  if (!data || data.source !== PAGE_MESSAGE_SOURCE || !data.event) return

  const message: CaptureMessage = {
    type: 'firestore-devtools/capture',
    event: data.event
  }

  try {
    // Nothing listens while the panel is closed, and the worker may be asleep;
    // both show up as a rejected promise we can safely drop.
    void chrome.runtime.sendMessage(message).catch(() => {})
  } catch {
    // The extension was reloaded and this context is orphaned.
  }
})
