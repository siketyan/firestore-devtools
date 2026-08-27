import './Toolbar.css'

export type TransportFilter = 'all' | 'webchannel' | 'rest'

const TRANSPORTS: Array<{value: TransportFilter; label: string}> = [
  {value: 'all', label: 'All'},
  {value: 'webchannel', label: 'Streaming'},
  {value: 'rest', label: 'Unary'}
]

export interface ToolbarProps {
  query: string
  onQueryChange: (query: string) => void
  transport: TransportFilter
  onTransportChange: (transport: TransportFilter) => void
  onClear: () => void
  shown: number
  total: number
}

export function Toolbar({
  query,
  onQueryChange,
  transport,
  onTransportChange,
  onClear,
  shown,
  total
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <button
        type="button"
        className="toolbar__button"
        onClick={onClear}
        title="Clear"
      >
        Clear
      </button>

      <input
        className="toolbar__filter"
        type="search"
        value={query}
        placeholder="Filter by RPC, URL or payload"
        onChange={(event) => onQueryChange(event.target.value)}
      />

      <div className="toolbar__group">
        {TRANSPORTS.map(({value, label}) => (
          <button
            type="button"
            key={value}
            className={
              value === transport
                ? 'toolbar__chip toolbar__chip--active'
                : 'toolbar__chip'
            }
            onClick={() => onTransportChange(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <span className="toolbar__count">
        {shown === total ? `${total}` : `${shown} / ${total}`} requests
      </span>
    </div>
  )
}
