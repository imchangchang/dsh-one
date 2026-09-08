/**
 * Preact 管线冒烟（Step 0 临时）：验证 esbuild + tsc 都能用 Preact 的
 * automatic JSX 编译本文件。验证后接入真实组件时替换。
 */
export function Smoke() {
  return <div className="preact-smoke">preact works</div>
}
