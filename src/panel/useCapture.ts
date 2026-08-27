import {useEffect, useMemo, useRef, useState} from 'react'

import {ExchangeStore} from '../shared/store'
import {
  PANEL_PORT_NAME,
  type Exchange,
  type PanelRequest,
  type PanelResponse
} from '../shared/types'

export interface Capture {
  exchanges: readonly Exchange[]
  clear: () => void
}

/**
 * Mirrors the background worker's capture buffer for the inspected tab into a
 * local store, and re-renders at most once per frame no matter how chatty the
 * stream is.
 */
export function useCapture(): Capture {
  const store = useMemo(() => new ExchangeStore(), [])
  const portRef = useRef<chrome.runtime.Port | undefined>(undefined)
  const [version, setVersion] = useState(0)

  // The store mutates its exchanges in place, so hand callers a fresh array
  // identity on every bump; without it downstream `useMemo`s never recompute.
  const exchanges = useMemo(() => store.exchanges.slice(), [store, version])

  useEffect(() => {
    let frame = 0
    const unsubscribe = store.subscribe(() => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setVersion(store.version)
      })
    })

    return () => {
      unsubscribe()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [store])

  useEffect(() => {
    const tabId = chrome.devtools.inspectedWindow.tabId
    let disposed = false
    let retry: ReturnType<typeof setTimeout> | undefined

    const connect = (): void => {
      if (disposed) return

      const port = chrome.runtime.connect({name: PANEL_PORT_NAME})
      portRef.current = port

      port.onMessage.addListener((message: PanelResponse) => {
        switch (message.type) {
          case 'snapshot':
            // Only trust the backlog on the first connection: after the worker
            // has been suspended and restarted its buffer is empty, and the
            // panel is the one holding the full history.
            if (store.exchanges.length === 0) store.replace(message.exchanges)
            break
          case 'event':
            store.apply(message.event)
            break
          case 'cleared':
            store.clear()
            break
        }
      })

      port.onDisconnect.addListener(() => {
        portRef.current = undefined
        // The service worker idles out every ~30s; reconnect to wake it.
        if (!disposed) retry = setTimeout(connect, 250)
      })

      port.postMessage({type: 'subscribe', tabId} satisfies PanelRequest)
    }

    connect()

    return () => {
      disposed = true
      if (retry) clearTimeout(retry)
      portRef.current?.disconnect()
      portRef.current = undefined
    }
  }, [store])

  const clear = (): void => {
    store.clear()
    portRef.current?.postMessage({
      type: 'clear',
      tabId: chrome.devtools.inspectedWindow.tabId
    } satisfies PanelRequest)
  }

  return {exchanges, clear}
}
