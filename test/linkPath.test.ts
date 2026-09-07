import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isFilePathHref, isInlineCodeFilePath } from '../src/pure/linkPath.ts'

test('isFilePathHref: 绝对路径与 file: URI', () => {
  assert.equal(isFilePathHref('/Users/cgeng/Workspaces/POV/a.md'), true)
  assert.equal(isFilePathHref('/Users/cgeng/目录/文件 名.md'), true)
  assert.equal(isFilePathHref('file:///Users/cgeng/a%20b.md'), true)
  assert.equal(isFilePathHref('file:/Users/cgeng/a.md'), true)
})

test('isFilePathHref: Windows 绝对路径（含 marked 编码的 %5C）', () => {
  assert.equal(isFilePathHref('C:/Users/cgeng/a.md'), true)
  assert.equal(isFilePathHref('C:\\Users\\cgeng\\a.md'), true)
  assert.equal(isFilePathHref('C:%5CUsers%5Ccgeng%5Ca.md'), true)
  assert.equal(isFilePathHref('c:/a.md'), true)
})

test('isFilePathHref: 用户目录与相对路径', () => {
  assert.equal(isFilePathHref('~/home/a.md'), true)
  assert.equal(isFilePathHref('./docs/a.md'), true)
  assert.equal(isFilePathHref('../x/AGENTS.md'), true)
  assert.equal(isFilePathHref('docs/foo.md'), true)
  assert.equal(isFilePathHref('AGENTS.md'), true)
  assert.equal(isFilePathHref('foo bar.md'), true)
  assert.equal(isFilePathHref('hello%20world.md'), true)
})

test('isFilePathHref: 外链与危险 scheme 不是文件路径', () => {
  assert.equal(isFilePathHref('https://example.com/a.md'), false)
  assert.equal(isFilePathHref('http://example.com'), false)
  assert.equal(isFilePathHref('mailto:a@b.c'), false)
  assert.equal(isFilePathHref('javascript:alert(1)'), false)
  assert.equal(isFilePathHref('data:text/html,<script>'), false)
  assert.equal(isFilePathHref('vbscript:x'), false)
  assert.equal(isFilePathHref('vscode://file/a.md'), false)
  assert.equal(isFilePathHref('dsh-session:abc'), false)
})

test('isInlineCodeFilePath: 绝对路径与常见相对路径放行', () => {
  assert.equal(isInlineCodeFilePath('/Users/cgeng/Workspaces/dsh-one/README.md'), true)
  assert.equal(isInlineCodeFilePath('file:///Users/cgeng/a.md'), true)
  assert.equal(isInlineCodeFilePath('C:/Users/cgeng/a.md'), true)
  assert.equal(isInlineCodeFilePath('C:\\Users\\cgeng\\a.md'), true)
  assert.equal(isInlineCodeFilePath('~/Workspaces/x.md'), true)
  assert.equal(isInlineCodeFilePath('\\server\\share\\a.md'), true)
  assert.equal(isInlineCodeFilePath('./docs/a.md'), true)
  assert.equal(isInlineCodeFilePath('../x/AGENTS.md'), true)
})

test('isInlineCodeFilePath: 相对路径与纯文件名（带扩展名）', () => {
  assert.equal(isInlineCodeFilePath('test/ui/xxx.png'), true)
  assert.equal(isInlineCodeFilePath('src/ui/chat/webview.ts'), true)
  assert.equal(isInlineCodeFilePath('docs/backlog/README.md'), true)
  assert.equal(isInlineCodeFilePath('webview.ts'), true)
  assert.equal(isInlineCodeFilePath('package-lock.json'), true)
  assert.equal(isInlineCodeFilePath('style-sessions.css'), true)
  assert.equal(isInlineCodeFilePath('Makefile'), false) // 无扩展名不点，hover 复制兜底
  assert.equal(isInlineCodeFilePath('npm'), false)
})

test('isInlineCodeFilePath: dotfile 放行，命令/占位符/版本号不误判', () => {
  assert.equal(isInlineCodeFilePath('.gitignore'), true)
  assert.equal(isInlineCodeFilePath('.env'), true)
  assert.equal(isInlineCodeFilePath('git status'), false) // 含空白 = 命令
  assert.equal(isInlineCodeFilePath('npm run build'), false)
  assert.equal(isInlineCodeFilePath('foo bar.md'), false)
  assert.equal(isInlineCodeFilePath('src/{a,b}.ts'), false)
  assert.equal(isInlineCodeFilePath('$HOME/a.md'), false)
  assert.equal(isInlineCodeFilePath('v1.2.3'), false) // 数字扩展名
  assert.equal(isInlineCodeFilePath('VITE_PORT'), false)
  assert.equal(isInlineCodeFilePath(''), false)
})
