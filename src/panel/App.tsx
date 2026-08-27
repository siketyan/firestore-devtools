import {useMemo, useState} from 'react'

import type {Exchange, Transport} from '../shared/types'
import {ExchangeDetail} from './components/ExchangeDetail'
import {ExchangeList} from './components/ExchangeList'
import {Toolbar, type TransportFilter} from './components/Toolbar'
import {useCapture} from './useCapture'
import './App.css'

function matches(
  exchange: Exchange,
  query: string,
  transport: TransportFilter
): boolean {
  if (
    transport !== 'all' &&
    exchange.rpc.transport !== (transport as Transport)
  )
    return false
  if (!query) return true

  const needle = query.toLowerCase()
  return (
    exchange.rpc.method.toLowerCase().includes(needle) ||
    exchange.url.toLowerCase().includes(needle) ||
    (exchange.rpc.database ?? '').toLowerCase().includes(needle) ||
    exchange.frames.some((frame) => frame.raw.toLowerCase().includes(needle))
  )
}

export function App() {
  const {exchanges, clear} = useCapture()
  const [query, setQuery] = useState('')
  const [transport, setTransport] = useState<TransportFilter>('all')
  const [selectedId, setSelectedId] = useState<string | undefined>()

  const visible = useMemo(
    () => exchanges.filter((exchange) => matches(exchange, query, transport)),
    [exchanges, query, transport]
  )

  const selected = visible.find((exchange) => exchange.id === selectedId)

  return (
    <div className="app">
      <Toolbar
        query={query}
        onQueryChange={setQuery}
        transport={transport}
        onTransportChange={setTransport}
        onClear={() => {
          setSelectedId(undefined)
          clear()
        }}
        shown={visible.length}
        total={exchanges.length}
      />

      <div className="app__body">
        <ExchangeList
          exchanges={visible}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        {selected ? (
          <ExchangeDetail
            exchange={selected}
            onClose={() => setSelectedId(undefined)}
          />
        ) : null}
      </div>
    </div>
  )
}
