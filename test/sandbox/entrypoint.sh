#!/usr/bin/env bash
set -e

# DSH One 沙盒容器启动脚本（镜像 ENTRYPOINT）。
# 职责：复制宿主 dsh 配置 → 按 LOCALE/THEME 写用户配置 → 启动 code-server。

# 1) dsh 配置：宿主以 -v $HOME/.dsh:/dsh-config-ro:ro 只读挂载，这里复制一份到容器内
#    （容器可写，不污染宿主 ~/.dsh；host 侧由 run-sandbox.sh start 挂载）。
if [ -d /dsh-config-ro ]; then
  mkdir -p "$HOME/.dsh"
  cp -r /dsh-config-ro/. "$HOME/.dsh/" 2>/dev/null || true
fi

# 2) 主题与语言：LOCALE/THEME 来自镜像 ENV 默认（Dockerfile），运行期可用 -e 覆盖。
#    这里再兜一层：非法值回退默认，保证下面写进 JSON 的是合法字符串。
case "$LOCALE" in
  zh-cn|zh-CN) LOCALE="zh-cn" ;;
  en) LOCALE="en" ;;
  *) echo "[entrypoint] 未知 LOCALE='$LOCALE'，回退到 en" >&2; LOCALE="en" ;;
esac
case "$THEME" in
  light) COLOR_THEME="Default Light Modern" ;;
  dark) COLOR_THEME="Default Dark Modern" ;;
  *) echo "[entrypoint] 未知 THEME='$THEME'，回退到 dark" >&2; COLOR_THEME="Default Dark Modern" ;;
esac

# 3) 写用户配置：i18n locale 放 code-server 的 argv.json，主题放 settings.json。
#    设置保留 workspace trust 关闭（深浅主题可换容器重启切换，trust 必须始终关着，否则 Restricted Mode 限扩展）。
CONFIG_DIR="$HOME/.local/share/code-server"
mkdir -p "$CONFIG_DIR/User"
printf '{\n  "locale": "%s"\n}\n' "$LOCALE" > "$CONFIG_DIR/argv.json"
printf '{\n  "security.workspace.trust.enabled": false,\n  "workbench.startupEditor": "none",\n  "workbench.colorTheme": "%s"\n}\n' "$COLOR_THEME" > "$CONFIG_DIR/User/settings.json"

# 4) 启动 code-server：默认监听 8080，port 可由 -e PORT 覆盖（run-sandbox.sh start 用 -p $PORT:$PORT 联动）。
mkdir -p "$HOME/workspace"
PORT="${PORT:-8080}"
exec code-server --bind-addr "0.0.0.0:$PORT" --auth none --disable-telemetry "$HOME/workspace"
