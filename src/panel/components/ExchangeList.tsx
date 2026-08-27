import type {Exchange} from '../../shared/types'
import {formatBytes, formatDuration, formatTime} from '../format'
import './ExchangeList.css'

export interface ExchangeListProps {
  exchanges: readonly Exchange[]
  selectedId: string | undefined
  onSelect: (id: string) => void
}

function statusOf(exchange: Exchange): string {
  if (exchange.error) return 'error'
  if (exchange.status) return String(exchange.status)
  return exchange.state === 'complete' ? '—' : exchange.state
}

function durationOf(exchange: Exchange): number | undefined {
  return exchange.finishedAt
    ? exchange.finishedAt - exchange.startedAt
    : undefined
}

export function ExchangeList({
  exchanges,
  selectedId,
  onSelect
}: ExchangeListProps) {
  if (exchanges.length === 0) {
    return (
      <div className="list list--empty">
        <p>No Firestore traffic captured yet.</p>
        <p className="list__hint">
          Reload the inspected page with this panel open to record the initial
          <code> Listen </code> stream.
        </p>
      </div>
    )
  }

  return (
    <div className="list">
      <table className="list__table">
        <thead>
          <tr>
            <th>RPC</th>
            <th>Transport</th>
            <th>Status</th>
            <th>Messages</th>
            <th>Size</th>
            <th>Time</th>
            <th>Started</th>
          </tr>
        </thead>
        <tbody>
          {exchanges.map((exchange) => (
            <tr
              key={exchange.id}
              className={[
                'list__row',
                `list__row--${exchange.state}`,
                exchange.id === selectedId ? 'list__row--selected' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelect(exchange.id)}
            >
              <td className="list__rpc">
                <span className="list__method">{exchange.rpc.method}</span>
                <span className="list__database">
                  {exchange.rpc.database ?? exchange.url}
                </span>
              </td>
              <td>
                {exchange.rpc.transport === 'webchannel'
                  ? 'WebChannel'
                  : 'HTTP'}
              </td>
              <td>{statusOf(exchange)}</td>
              <td>{exchange.frames.length}</td>
              <td>
                {formatBytes(exchange.bytesSent + exchange.bytesReceived)}
              </td>
              <td>{formatDuration(durationOf(exchange))}</td>
              <td>{formatTime(exchange.startedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
