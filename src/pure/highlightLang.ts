/**
 * 代码块语法高亮的语言面（纯逻辑，node --test 可测）。
 *
 * 与官方 dsh web 客户端同一套划分：3 个常驻语言（跟随高亮内核一起加载——
 * 最常见的三种）+ 23 个懒加载语言包（首次遇到该语言的可见代码块时才拉）。
 * 别名表同样对齐官方（`ts`/`tsx`/`javascript` 都归 typescript，`bash`/`zsh`
 * 归 shellscript……），未登记的语言不着色、保持纯文本。
 */

/** 常驻语言：随高亮内核一起下载（官方同款三种）。 */
export const EAGER_LANGS: readonly string[] = ['typescript', 'shellscript', 'json']

/** 懒加载语言包：每个一个资源文件，首次用到才加载（官方同款 23 个）。 */
export const LAZY_LANGS: readonly string[] = [
  'python',
  'ruby',
  'go',
  'rust',
  'java',
  'c',
  'cpp',
  'csharp',
  'kotlin',
  'swift',
  'php',
  'yaml',
  'toml',
  'ini',
  'markdown',
  'mdx',
  'html',
  'css',
  'scss',
  'less',
  'sql',
  'xml',
  'lua',
]

/** 围栏语言标记（含别名，小写）→ 高亮语言 id。 */
export const LANG_ALIASES: Readonly<Record<string, string>> = {
  typescript: 'typescript',
  ts: 'typescript',
  tsx: 'typescript',
  javascript: 'typescript',
  js: 'typescript',
  jsx: 'typescript',
  shellscript: 'shellscript',
  bash: 'shellscript',
  sh: 'shellscript',
  shell: 'shellscript',
  zsh: 'shellscript',
  json: 'json',
  jsonc: 'json',
  python: 'python',
  py: 'python',
  ruby: 'ruby',
  rb: 'ruby',
  go: 'go',
  rust: 'rust',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  csharp: 'csharp',
  cs: 'csharp',
  kotlin: 'kotlin',
  swift: 'swift',
  php: 'php',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  markdown: 'markdown',
  md: 'markdown',
  mdx: 'mdx',
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  sql: 'sql',
  xml: 'xml',
  lua: 'lua',
}

/** 围栏语言标记 → 高亮语言 id；未登记（unknown/空/无此语言）返回 undefined。 */
export function canonicalLang(lang: string | undefined): string | undefined {
  if (!lang) return undefined
  return LANG_ALIASES[lang.trim().toLowerCase()]
}

/** 该语言是否走懒加载语言包（常驻语言不需要单独拉资源）。 */
export function isLazyLang(id: string): boolean {
  return LAZY_LANGS.includes(id)
}

/** 懒加载语言包的资源文件名（dist/shiki/lang-<id>.js）。 */
export function langAssetName(id: string): string {
  return `lang-${id}.js`
}
