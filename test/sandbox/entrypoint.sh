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

# ── mock-llm 模式（MOCK_LLM=1，由镜像 ENV 默认 / 运行期 -e 覆盖）──────────────────────
# 容器里真 dsh 走真实逻辑，但 LLM 请求打到容器内假端点 /app/mock-llm/server.ts（node 24 直接跑 .ts）。
# 与真实模式差异：真实模式沿用宿主 ~/.dsh 配置；mock 模式把 settings.yaml 整体替换为 mock 配置
# （不做 YAML 合并——宿主其他 provider 在 mock 模式下无用，直接替换最确定；字段由 dsh-llm-pi-ai
#  schema 核对过，见 settings.yaml 内注释与沙盒 README）。
# 三步：① 覆盖 settings.yaml ② 后台起 mock-llm 并等它就绪 ③ 导出 apiKeyEnv 指向的凭证。
if [ "${MOCK_LLM:-0}" = "1" ]; then
  # ① 覆盖容器内 dsh 配置为 mock 配置（容器可写，不污染宿主）。
  mkdir -p "$HOME/.dsh"
  cat > "$HOME/.dsh/settings.yaml" <<'YAML'
# mock-llm 沙盒配置：dsh 走真实逻辑，LLM 打到容器内假端点
# 字段对照 @deepseek-ai/dsh-llm-pi-ai/lib/index.js 核过（见 README.md「mock 模式」）：
#   * profile: apiKeyEnv(933)/displayName(934)/api(935)/baseURL(936)/models(937) 必填；
#   * modelProfile: id(927) 必填；name/contextWindow/maxTokens/input 走运行时兜底但这里显式补齐；
#   * reasoningEfforts(916)：声明 off:null 表示「不支持思考」，max/high 声明 wire 值（THINKING_LEVELS=290）；
#   * compat 故意不填：openai-completions 网关会拒绝非该协议提供的 compat 字段（index.js:589），留空更稳。
agent-default-model:
  provider: mock-llm
  model: mock-flash
  reasoningEffort: max
llm-pi-ai:
  providers:
    mock-llm:
      baseURL: "http://127.0.0.1:9009/v1"
      api: "openai-completions"
      apiKeyEnv: MOCK_LLM_KEY
      displayName: "Mock LLM"
      models:
        - id: mock-flash
          name: mock-flash
          contextWindow: 128000
          maxTokens: 8192
          input: ["text"]
          reasoningEfforts:
            off: null
            high: "high"
            max: "max"
YAML

  # ③ 导出 apiKeyEnv 指向的凭证（settings 里 apiKeyEnv: MOCK_LLM_KEY；导出的 env 被 code-server 及其后代继承）。
  export MOCK_LLM_KEY=mock-key-1

  # ④ 清掉复制进来的会话状态与注册表：真实会话自带模型选择（会覆盖 agent-default-model），
  #    且 workspace 注册表（storages/workspace.json）指向宿主路径（/Users/cgeng/…），
  #    容器里 session.create 会 mkdir '/Users' 直接 EACCES。清空后从「未分组新会话」开始，
  #    新会话走 mock 模型、cwd 在容器可写路径。
  rm -rf "$HOME/.dsh/sessions" "$HOME/.dsh"/session-query.sqlite* "$HOME/.dsh/storages"

  # ② 后台起 mock-llm 端点，等它就绪：轮询 GET /v1/models，上限约 10s（50 次 × 0.2s）。
  #    这里用 node 做健康 check（容器内有 node 运行时；不依赖 curl 是否随镜像附带）。
  node /app/mock-llm/server.ts --port 9009 &
  MOCK_LLM_PID=$!
  echo "[entrypoint] 启动 mock-llm pid=$MOCK_LLM_PID (http://127.0.0.1:9009)" >&2
  MOCK_LLM_UP=""
  _MOCK_TRY=0
  while [ "$_MOCK_TRY" -lt 50 ]; do
    if node -e 'const http=require("node:http");const r=http.get("http://127.0.0.1:9009/v1/models",s=>process.exit(s.statusCode<500?0:1));r.on("error",()=>process.exit(1));r.setTimeout(1000,()=>{r.destroy();process.exit(1)});'; then
      MOCK_LLM_UP=1
      break
    fi
    _MOCK_TRY=$((_MOCK_TRY + 1))
    sleep 0.2
  done
  if [ -z "$MOCK_LLM_UP" ]; then
    echo "[entrypoint] mock-llm 端点未在 ~10s 内就绪（pid=${MOCK_LLM_PID}），退出" >&2
    exit 1
  fi
  echo "[entrypoint] mock-llm 已就绪（pid=${MOCK_LLM_PID}）" >&2
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
