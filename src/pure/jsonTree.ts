/**
 * JsonTree pure logic: conservative JSON detection plus flattening a parsed
 * JSON value into flat renderable rows with a resolved expand/collapse state.
 *
 * The webview renders the rows (vanilla DOM, monospace), the open/closed state
 * is resolved here from a caller-provided `isOpen(pathKey)` predicate, so the
 * default-expansion strategy and the flattening are both unit-testable without
 * a DOM. No `vscode` import; `node --test` testable.
 */

/** One path segment from the root: object key (string) or array index (number). */
export type JsonPath = Array<string | number>

/** Primitive scalar JSON values (what JSON.parse produces as a non-container). */
export type JsonPrimitive = string | number | boolean | null

/** Any parseable JSON value (container or primitive). */
export type JsonValue = JsonPrimitive | { [key: string]: JsonValue } | JsonValue[]

/** A JSON container value: an object or an array. */
export type JsonContainer = { [key: string]: JsonValue } | JsonValue[]

/** Display kind + pre-rendered text of a primitive leaf. */
export interface JsonPrimitiveKind {
  type: 'string' | 'number' | 'boolean' | 'null'
  display: string
}

/**
 * One flat renderable row of a JSON tree. `depth` (0 = root) drives indentation;
 * the webview also mirrors it onto the DOM for reuse. A non-empty container
 * emits a `container` row, then (when open) its children rows, then a `close`
 * row carrying the closing bracket. An empty container emits only `container`
 * with entryCount 0 and open false (no children, no arrow).
 */
export type JsonTreeRow =
  | {
      type: 'primitive'
      depth: number
      path: JsonPath
      /** Display label: object key / array index / null for the root. */
      key: string | null
      primitive: JsonPrimitiveKind
    }
  | {
      type: 'container'
      depth: number
      path: JsonPath
      key: string | null
      kind: 'object' | 'array'
      /** Resolved open state (only meaningful when entryCount > 0). */
      open: boolean
      entryCount: number
    }
  | { type: 'close'; depth: number; kind: 'object' | 'array' }

/** Default-expanded path key: the root (`$`). */
export const JSON_TREE_ROOT_KEY = '$'

/**
 * Canonical path key for a node, used as the open-state key: `$` (root), `$.a`
 * (object key), `$[0]` (array index), `$["complex-key"]` (a key that is not a
 * bare identifier — collision-free the same way the official client's path key
 * is).
 */
export function jsonPathKey(path: JsonPath): string {
  if (path.length === 0) return JSON_TREE_ROOT_KEY
  return (
    '$' +
    path
      .map((seg) =>
        typeof seg === 'number'
          ? `[${seg}]`
          : /^[A-Za-z_$][\w$]*$/.test(seg)
            ? `.${seg}`
            : `[${JSON.stringify(seg)}]`,
      )
      .join('')
  )
}

function primitiveKind(v: JsonPrimitive): JsonPrimitiveKind {
  if (v === null) return { type: 'null', display: 'null' }
  if (typeof v === 'string') return { type: 'string', display: JSON.stringify(v) }
  if (typeof v === 'boolean') return { type: 'boolean', display: String(v) }
  return { type: 'number', display: String(v) }
}

/**
 * Whole-text ```json (or bare ```) code fence: the trimmed text is exactly one
 * fence whose inner content is the JSON candidate. Anchored at both ends so a
 * prose blurb that merely ends with a fence is not mis-detected.
 */
const JSON_FENCE = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)[ \t]*\r?\n?```[ \t]*$/

/**
 * Conservative JSON-tree detection: returns the parsed value only when the
 * whole text is a valid object/array literal (a bare `"foo"`, `5`, `true` or
 * `null` scalar is NOT a tree). Tolerates a ```json fence wrapper (tool output
 * rendered as a plain <pre> would otherwise parse-fail on the fence lines).
 * Prose and malformed JSON return null — a mis-detection here would degrade a
 * normal text output into a tree.
 */
export function tryParseJsonTree(text: string): JsonContainer | null {
  if (!text || !text.trim()) return null
  const trimmed = text.trim()
  const fence = JSON_FENCE.exec(trimmed)
  const candidate = (fence ? fence[1] : trimmed).trim()
  if (!candidate) return null
  try {
    const parsed = JSON.parse(candidate) as unknown
    if (typeof parsed === 'object' && parsed !== null) return parsed as JsonContainer
  } catch {
    /* not a JSON literal */
  }
  return null
}

/** True when `text` is a JSON object/array literal (see {@link tryParseJsonTree}). */
export function isJsonTree(text: string): boolean {
  return tryParseJsonTree(text) !== null
}

function isContainer(v: unknown): v is JsonContainer {
  return typeof v === 'object' && v !== null
}

function countEntries(v: JsonContainer): number {
  return Array.isArray(v) ? v.length : Object.keys(v).length
}

/**
 * Default expansion strategy (aligned with the official JsonTree's
 * `expandTopLevel: true`): the root container is open, every nested container
 * starts closed. Callers usually pre-populate their open-state store with this,
 * then the user's arrow clicks add/remove path keys.
 */
export function defaultJsonTreeExpanded(value: JsonContainer): Set<string> {
  return new Set(countEntries(value) > 0 ? [JSON_TREE_ROOT_KEY] : [])
}

/** Build an `isOpen` predicate from an explicit set of expanded path keys. */
export function isOpenFromSet(set: ReadonlySet<string>): (pathKey: string) => boolean {
  return (pathKey) => set.has(pathKey)
}

/**
 * Flatten a parsed JSON container into the flat renderable rows, resolving each
 * container's open/closed state through `isOpen(pathKey)`. Any empty container
 * (or the root when the caller's store has it closed) renders without children.
 */
export function flattenJsonTree(value: JsonContainer, isOpen: (pathKey: string) => boolean): JsonTreeRow[] {
  const out: JsonTreeRow[] = []
  walk(value, [], 0, null, isOpen, out)
  return out
}

function walk(
  value: JsonValue,
  path: JsonPath,
  depth: number,
  key: string | null,
  isOpen: (pathKey: string) => boolean,
  out: JsonTreeRow[],
): void {
  if (!isContainer(value)) {
    out.push({ type: 'primitive', depth, path, key, primitive: primitiveKind(value as JsonPrimitive) })
    return
  }
  const isArray = Array.isArray(value)
  const entries: Array<[string | number, JsonValue]> = isArray
    ? value.map((v, i) => [i, v] as [number, JsonValue])
    : Object.entries(value).map(([k, v]) => [k, v] as [string, JsonValue])
  const entryCount = entries.length
  const open = entryCount > 0 && isOpen(jsonPathKey(path))
  out.push({
    type: 'container',
    depth,
    path,
    key,
    kind: isArray ? 'array' : 'object',
    open,
    entryCount,
  })
  if (open) {
    for (const [seg, child] of entries) {
      walk(child, [...path, seg], depth + 1, String(seg), isOpen, out)
    }
    out.push({ type: 'close', depth, kind: isArray ? 'array' : 'object' })
  }
}

/** Whether a container row can be toggled (has entries to reveal/hide). */
export function isExpandable(row: Extract<JsonTreeRow, { type: 'container' }>): boolean {
  return row.entryCount > 0
}

/**
 * Copy text for a JSON value (2-space pretty JSON, 对齐官方 JsonTree 的
 * copyPrettyJson —— 从解析值重新序列化，不再带代码围栏、统一缩进）。对整棵树
 * （根容器）与任意子节点（容器或原始值）都适用：container 给 pretty 对象/数组，
 * 原始值给对应标量（string 带引号、number/bool/null 字面量）。
 */
export function jsonTreeCopyText(value: JsonValue): string {
  return JSON.stringify(value, null, 2)
}

/**
 * Walk `path` from the root to the sub-value at that position. Path segments are
 * object keys (string) / array indices (number), as produced by
 * {@link flattenJsonTree}. Returns undefined when the path does not resolve
 * (e.g. a stale row after the value changed during streaming). Used by the
 * node-level copy: resolve a row's path → its own pretty JSON to copy.
 */
export function jsonValueAtPath(value: JsonValue, path: JsonPath): JsonValue | undefined {
  let current: JsonValue | undefined = value
  for (const seg of path) {
    if (current === null || typeof current !== 'object') return undefined
    const obj = current as { [key: string]: JsonValue } | JsonValue[]
    current = Array.isArray(obj)
      ? (obj[seg as number] as JsonValue | undefined)
      : (obj[seg as string] as JsonValue | undefined)
    if (current === undefined) return undefined
  }
  return current
}
