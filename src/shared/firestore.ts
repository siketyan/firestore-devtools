import type {RpcInfo} from './types'

/**
 * `https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel?...`
 *
 * The streaming RPCs (`Listen` and `Write`) are tunnelled over a Closure
 * WebChannel, which puts the fully qualified service and method in the path.
 */
const WEBCHANNEL_PATH =
  /^\/(google\.firestore\.(v[0-9a-z]+)\.Firestore)\/([A-Za-z]\w*)\/channel$/

/**
 * `https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents:commit`
 *
 * Everything else goes out as JSON over HTTP, with the RPC name as the last
 * `:verb` segment (or no verb at all, for the REST-style document reads).
 */
const REST_PATH =
  /^\/(v[0-9a-z]+)\/(projects\/[^/]+\/databases\/[^/]+)\/(.+)$/

/** URL verb -> RPC name, mirroring the mapping the Firestore SDK uses. */
const REST_VERB_TO_RPC: Record<string, string> = {
  batchGet: 'BatchGetDocuments',
  batchWrite: 'BatchWrite',
  beginTransaction: 'BeginTransaction',
  commit: 'Commit',
  createDocument: 'CreateDocument',
  listCollectionIds: 'ListCollectionIds',
  listDocuments: 'ListDocuments',
  listen: 'Listen',
  partitionQuery: 'PartitionQuery',
  rollback: 'Rollback',
  runAggregationQuery: 'RunAggregationQuery',
  runQuery: 'RunQuery',
  write: 'Write'
}

/** HTTP verb -> RPC name for the plain resource URLs (no `:verb` suffix). */
const METHOD_TO_RPC: Record<string, string> = {
  GET: 'GetDocument',
  POST: 'CreateDocument',
  PATCH: 'UpdateDocument',
  DELETE: 'DeleteDocument'
}

function toUrl(rawUrl: string, base?: string): URL | undefined {
  try {
    return new URL(rawUrl, base ?? globalThis.location?.href)
  } catch {
    return undefined
  }
}

/**
 * Works out which Firestore RPC a request URL belongs to, or returns
 * `undefined` when the URL is not Firestore traffic at all.
 *
 * Matching is done on the path rather than the host so that the Firestore
 * emulator (`http://localhost:8080/...`) is picked up too.
 */
export function identifyRpc(
  rawUrl: string,
  httpMethod = 'POST',
  base?: string
): RpcInfo | undefined {
  const url = toUrl(rawUrl, base)
  if (!url) return undefined

  const webChannel = WEBCHANNEL_PATH.exec(url.pathname)
  if (webChannel) {
    const [, service, , method] = webChannel
    return {
      service: service!,
      method: method!,
      transport: 'webchannel',
      // The SDK passes the database as a query parameter on the channel URL.
      database: url.searchParams.get('database') ?? undefined
    }
  }

  const rest = REST_PATH.exec(url.pathname)
  if (rest) {
    const [, version, database, resource] = rest
    const verb = resource!.includes(':')
      ? resource!.slice(resource!.lastIndexOf(':') + 1)
      : undefined

    const method = verb
      ? (REST_VERB_TO_RPC[verb] ?? verb)
      : (METHOD_TO_RPC[httpMethod.toUpperCase()] ?? httpMethod.toUpperCase())

    return {
      service: `google.firestore.${version}.Firestore`,
      method,
      transport: 'rest',
      database: decodeURIComponent(database!)
    }
  }

  return undefined
}

/** The project id inside a `projects/p/databases/d` resource name. */
export function projectIdOf(database: string | undefined): string | undefined {
  return database?.match(/^projects\/([^/]+)/)?.[1]
}

/** Short label for the list column, e.g. `Listen` or `Commit`. */
export function rpcLabel(rpc: RpcInfo): string {
  return rpc.method
}
