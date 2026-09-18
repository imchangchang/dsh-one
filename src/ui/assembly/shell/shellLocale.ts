/**
 * chat 树 frame 插件的自有词典（#202 从 chatLayoutPlugin.ts 抽出来）：
 * 命名空间 = `dshOneShell`（注册点在 chatLayoutPlugin.ts 的 `ctx.locale.register`）。
 *
 * 为什么单独成模块：浏览器验证的套件要断言「页面上那一行文案是词典里的哪一条」，
 * 而**期望值必须来自词典本身**（写死中文会得到一条「换台机器就红」的假失败——页面
 * 语言是运行环境的输入，见 test/assembly-lab/harness.ts 的 `texts()`）。抽出来之后
 * 套件直接 import 这个模块，词典与断言只有一个事实源。
 *
 * 值里的中文用 `\u` 转义写（与 chatLayoutPlugin.ts 原来的写法一致）：i18n 合入门禁
 * 的兜底扫描会把 src/** 新增行里的中文字符串字面量当「漏翻」拦下，注释里的中文不受
 * 影响。改文案时请连转义一起改（把新文案逐字符转成 `\uXXXX` 再填进来）。
 */
export interface ShellLocale {
  zh: Readonly<Record<string, string>>
  en: Readonly<Record<string, string>>
}

export const SHELL_LOCALE: ShellLocale = {
  zh: {
    // 正在打开会话…
    opening: '\u6b63\u5728\u6253\u5f00\u4f1a\u8bdd…',
    // 连接中断，正在重试
    connectionLost: '\u8fde\u63a5\u4e2d\u65ad\uff0c\u6b63\u5728\u91cd\u8bd5',
    // 连接已断开
    connectionOffline: '\u8fde\u63a5\u5df2\u65ad\u5f00',
  },
  en: {
    opening: 'Opening session…',
    connectionLost: 'Connection lost, retrying',
    connectionOffline: 'Disconnected',
  },
}
