import * as crypto from 'node:crypto'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { Dirent } from 'node:fs'

/**
 * 本地插件产物的内容版本——combo 缓存键里我们自己那一半（#173）。
 *
 * 背景：装配页取整包的 URL 是 `/plugins-local/??<ids>&rev=<rev>`，镜像按 URL 原样回
 * `cache-control: max-age=86400, immutable`（#71：内容版本进缓存键，源稳定时跨 tab
 * 命中 HTTP 缓存、整包网络字节≈0）。而这份整包里拼着两半内容——**官方那半**（网关
 * 下发的、我们剥掉 block list 之后剩下的段）与**我们自己的那半**
 * （`dist/assembly/plugins/<id>/client.js`）——此前 rev 却只有官方那一半
 * （`appBatches[0].rev`）。于是我们重建自己的 bundle 时 URL 与 ETag 都不变，webview
 * 吃满 24 小时的 immutable 缓存（连条件请求都不发）：改了样式 reload 也看不到，
 * 扩展升级后用户也可能停在旧界面（#173）。
 *
 * 这里给出「我们那半」的版本号：遍历 pluginsDir，把**每个文件的相对路径与内容**一起
 * 喂进 SHA-256（增删、改名、改一个字节都会变），取前 12 位十六进制。消费方是
 * `filterWire`（拼成 `&rev=<appRev>-<localRev>`），镜像侧不用改——它的 ETag 直接取
 * URL 上的 rev，缓存键因此自动跟着本地产物走。
 *
 * 目录不存在（还没 `npm run build`）时返回空输入的摘要（一个固定值）：那种情况下
 * 镜像读本地 bundle 本来就会报出更准确的错，这里只负责让缓存键稳定。整个目录一起算，
 * 不挑「这次 URL 里带到的 id」——多算的那点字节换来的是「不用先知道哪些 id 是本地件」。
 */
export async function localBundleRev(pluginsDir: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  for (const rel of await listFiles(pluginsDir, '')) {
    hash.update(rel)
    hash.update('\0')
    hash.update(await fsp.readFile(path.join(pluginsDir, rel)))
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 12)
}

/** pluginsDir 下所有文件的相对路径（每层按名字排序，保证同一份内容得到同一个顺序）。 */
async function listFiles(dir: string, rel: string): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await fsp.readdir(path.join(dir, rel), { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const child = rel === '' ? entry.name : `${rel}/${entry.name}`
    if (entry.isDirectory()) out.push(...(await listFiles(dir, child)))
    else out.push(child)
  }
  return out
}
