import {useState} from 'react'

export interface JsonViewProps {
  value: unknown
  /** Depth up to which nodes start expanded. */
  defaultExpandedDepth?: number
}

export function JsonView({value, defaultExpandedDepth = 2}: JsonViewProps) {
  return (
    <div className="json">
      <JsonNode
        name={undefined}
        value={value}
        depth={0}
        defaultExpandedDepth={defaultExpandedDepth}
      />
    </div>
  )
}

interface JsonNodeProps {
  name: string | undefined
  value: unknown
  depth: number
  defaultExpandedDepth: number
}

function JsonNode({
  name,
  value,
  depth,
  defaultExpandedDepth
}: JsonNodeProps) {
  const [expanded, setExpanded] = useState(depth < defaultExpandedDepth)

  const isArray = Array.isArray(value)
  const isObject = !isArray && typeof value === 'object' && value !== null

  if (!isArray && !isObject) {
    return (
      <div className="json__row" style={{paddingLeft: depth * 12}}>
        {name != null ? <span className="json__key">{name}: </span> : null}
        <span className={`json__value json__value--${typeOf(value)}`}>
          {render(value)}
        </span>
      </div>
    )
  }

  const entries = isArray
    ? (value as unknown[]).map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>)

  return (
    <div>
      <div
        className="json__row json__row--toggle"
        style={{paddingLeft: depth * 12}}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="json__caret">{expanded ? '▾' : '▸'}</span>
        {name != null ? <span className="json__key">{name}: </span> : null}
        <span className="json__summary">
          {isArray ? `Array(${entries.length})` : `{${entries.length}}`}
        </span>
      </div>

      {expanded
        ? entries.map(([key, item]) => (
            <JsonNode
              key={key}
              name={key}
              value={item}
              depth={depth + 1}
              defaultExpandedDepth={defaultExpandedDepth}
            />
          ))
        : null}
    </div>
  )
}

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  return typeof value
}

function render(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`
  return String(value)
}
