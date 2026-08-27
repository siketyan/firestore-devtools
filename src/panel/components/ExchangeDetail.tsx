import {useState} from 'react'

import type {Exchange, Frame} from '../../shared/types'
import {formatBytes, formatDuration, formatJson, formatTime} from '../format'
import {JsonView} from './JsonView'

type Tab = 'overview' | 'headers' | 'frames'

const TABS: Array<{value: Tab; label: string}> = [
  {value: 'overview', label: 'Overview'},
  {value: 'headers', label: 'Headers'},
  {value: 'frames', label: 'Messages'}
]

export interface ExchangeDetailProps {
  exchange: Exchange
  onClose: () => void
}

export function ExchangeDetail({exchange, onClose}: ExchangeDetailProps) {
  const [tab, setTab] = useState<Tab>('frames')
  const [selectedFrameId, setSelectedFrameId] = useState<string | undefined>()

  const selectedFrame =
    exchange.frames.find((frame) => frame.id === selectedFrameId) ??
    exchange.frames.at(-1)

  return (
    <aside className="detail">
      <header className="detail__header">
        <div className="detail__tabs">
          {TABS.map(({value, label}) => (
            <button
              key={value}
              className={
                value === tab ? 'detail__tab detail__tab--active' : 'detail__tab'
              }
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="detail__close" onClick={onClose} title="Close">
          ×
        </button>
      </header>

      <div className="detail__body">
        {tab === 'overview' ? <Overview exchange={exchange} /> : null}
        {tab === 'headers' ? <Headers exchange={exchange} /> : null}
        {tab === 'frames' ? (
          <Frames
            exchange={exchange}
            selectedFrame={selectedFrame}
            onSelect={setSelectedFrameId}
          />
        ) : null}
      </div>
    </aside>
  )
}

function Overview({exchange}: {exchange: Exchange}) {
  const rows: Array<[string, string]> = [
    ['RPC', `${exchange.rpc.service}/${exchange.rpc.method}`],
    [
      'Transport',
      exchange.rpc.transport === 'webchannel'
        ? 'WebChannel (streaming)'
        : 'HTTP (unary)'
    ],
    ['Database', exchange.rpc.database ?? '—'],
    ['Method', exchange.method],
    ['URL', exchange.url],
    ['Page', exchange.pageUrl],
    ['Status', exchange.error ?? `${exchange.status ?? '—'} ${exchange.statusText ?? ''}`.trim()],
    ['State', exchange.state],
    ['Started', formatTime(exchange.startedAt)],
    [
      'Duration',
      formatDuration(
        exchange.finishedAt ? exchange.finishedAt - exchange.startedAt : undefined
      )
    ],
    ['Sent', formatBytes(exchange.bytesSent)],
    ['Received', formatBytes(exchange.bytesReceived)],
    ['Messages', String(exchange.frames.length)]
  ]

  return <DefinitionList rows={rows} />
}

function Headers({exchange}: {exchange: Exchange}) {
  return (
    <>
      <h3 className="detail__heading">Request headers</h3>
      <DefinitionList rows={Object.entries(exchange.requestHeaders)} />
      <h3 className="detail__heading">Response headers</h3>
      <DefinitionList rows={Object.entries(exchange.responseHeaders)} />
    </>
  )
}

function Frames({
  exchange,
  selectedFrame,
  onSelect
}: {
  exchange: Exchange
  selectedFrame: Frame | undefined
  onSelect: (id: string) => void
}) {
  if (exchange.frames.length === 0) {
    return <p className="detail__empty">No messages captured.</p>
  }

  return (
    <div className="frames">
      <ol className="frames__list">
        {exchange.frames.map((frame) => (
          <li
            key={frame.id}
            className={[
              'frames__item',
              `frames__item--${frame.direction}`,
              frame.id === selectedFrame?.id ? 'frames__item--selected' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onSelect(frame.id)}
          >
            <span className="frames__arrow">
              {frame.direction === 'outbound' ? '↑' : '↓'}
            </span>
            <span className="frames__label">
              {frame.label ?? frame.raw.slice(0, 80)}
            </span>
            <span className="frames__meta">
              {formatBytes(frame.byteLength)} · {formatTime(frame.timestamp)}
            </span>
          </li>
        ))}
      </ol>

      <div className="frames__payload">
        {selectedFrame ? (
          selectedFrame.decoded !== undefined ? (
            <JsonView value={selectedFrame.decoded} defaultExpandedDepth={4} />
          ) : (
            <pre className="frames__raw">
              {formatJson(selectedFrame.decoded, selectedFrame.raw)}
            </pre>
          )
        ) : null}
      </div>
    </div>
  )
}

function DefinitionList({rows}: {rows: Array<readonly [string, string]>}) {
  if (rows.length === 0) return <p className="detail__empty">None.</p>

  return (
    <dl className="definitions">
      {rows.map(([term, description]) => (
        <div className="definitions__row" key={term}>
          <dt>{term}</dt>
          <dd>{description}</dd>
        </div>
      ))}
    </dl>
  )
}
