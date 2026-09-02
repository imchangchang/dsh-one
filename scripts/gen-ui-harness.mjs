// 从宿主源码抽出内联 STYLE 常量，写到 test/ui/style.css。
// webview 的样式由宿主注入（chatHtml/sessionsHtml 里的 <style>${STYLE|SESSIONS_STYLE}</style>），
// webview bundle 本身不含 CSS。独立渲染 harness 需要一份静态 CSS，所以从源代码抽取，
// 保证和源码同步：
//   - src/ui/chatViewHtml.ts 的 STYLE          → chat webview 样式（宿主拆分后由 chatView.ts 移出）
//   - src/ui/sessionsView.ts 的 SESSIONS_STYLE → 侧栏 sessions 面板样式（拆分后新增）
// 用法：node scripts/gen-ui-harness.mjs   （在仓库根目录跑）
import fs from 'node:fs'

const SOURCES = [
  { src: 'src/ui/chatViewHtml.ts', constName: 'STYLE', header: '/* ==== chat webview (src/ui/chatViewHtml.ts STYLE) ==== */\n' },
  { src: 'src/ui/sessionsView.ts', constName: 'SESSIONS_STYLE', header: '/* ==== sessions 面板 (src/ui/sessionsView.ts SESSIONS_STYLE) ==== */\n' },
]
const OUT = 'test/ui/style.css'

let combined = ''
for (const { src, constName, header } of SOURCES) {
  const text = fs.readFileSync(src, 'utf8')
  const m = text.match(new RegExp(`const ${constName} = \`([\\s\\S]*?)\`\\n`))
  if (!m) {
    console.error(`未能在 ${src} 找到 ${constName} 常量`)
    process.exit(1)
  }
  // 模板字符串里的反斜杠转义原样保留即可；两个样式常量内都没有 ${} 插值（否则这里会错）。
  combined += header + m[1] + '\n'
}
fs.mkdirSync('test/ui', { recursive: true })
fs.writeFileSync(OUT, combined)
console.log(`wrote ${OUT} (${combined.length} bytes, from ${SOURCES.map((s) => s.src).join(' + ')})`)
