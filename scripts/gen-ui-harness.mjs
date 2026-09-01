// 从 src/ui/chatView.ts 抽出内联 STYLE 常量，写到 test/ui/style.css。
// Chat webview 的样式由宿主注入（chatHtml 里的 <style>${STYLE}</style>），webview bundle
// 本身不含 CSS。独立渲染 harness 需要一份静态 CSS，所以从源代码抽取，保证和源码同步。
// 用法：node scripts/gen-ui-harness.mjs   （在仓库根目录跑）
import fs from 'node:fs'

const SRC = 'src/ui/chatView.ts'
const OUT = 'test/ui/style.css'

const src = fs.readFileSync(SRC, 'utf8')
const m = src.match(/const STYLE = `([\s\S]*?)`\n/)
if (!m) {
  console.error(`未能在 ${SRC} 找到 STYLE 常量`)
  process.exit(1)
}
// 模板字符串里的反斜杠转义原样保留即可；STYLE 内没有 ${} 插值（否则这里会错）。
const css = m[1]
fs.mkdirSync('test/ui', { recursive: true })
fs.writeFileSync(OUT, css)
console.log(`wrote ${OUT} (${css.length} bytes, from ${SRC})`)
