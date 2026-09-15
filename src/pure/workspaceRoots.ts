/**
 * 宿主能力桥的「追加允许根」来源（#65 返修 3）：从网关 `session/list` 的
 * **会话工作目录集合**推导——每行 `cwd` 就是一个真实的工作区目录，且这份数据
 * 由网关（服务端）给出，页面伪造不了，适合当宿主侧的安全边界。
 *
 * 为什么不用 `workspace.list`（原实现）：**现代 dsh（0.1.2）没有这个端点**。
 * 实测证据（只读探针）：`POST /api/workspace/list` 返回 `not found`（与随便编一个
 * `workspace/bogus` 的响应完全一致），dshRpc 的 MODERN_WIRE 里也没有它的映射，
 * 调用直接抛 `no dsh 0.1.2 wire mapping`；官方客户端拿工作区清单走的是
 * `workspace/follow`，而它是**流式方法**（服务端回 `stream Remote methods must be
 * opened through the stream carrier`），宿主侧一次性调用取不到。`workspace/list`
 * 只在 legacy（0.1.1）点上存在，dshRpc.listWorkspaces 保留给那条老路径用。
 */
export interface SessionCwdRow {
  cwd?: string | undefined
}

/**
 * 会话行 → 去重后的工作区目录集合（空值/非字符串剔除）。
 * @param rows - `session/list` 的行数组（只读 cwd 字段）。
 * @returns 去重且保持首次出现顺序的绝对目录表。
 */
export function workspaceRootsOfSessionRows(rows: readonly SessionCwdRow[]): readonly string[] {
  const seen = new Set<string>()
  const roots: string[] = []
  for (const row of rows) {
    const cwd = row.cwd
    if (typeof cwd !== 'string' || cwd === '') continue
    if (seen.has(cwd)) continue
    seen.add(cwd)
    roots.push(cwd)
  }
  return roots
}
