#!/usr/bin/env bash
set -euo pipefail

# run-sandbox.sh —— 宿主侧驱动 DSH One 的 docker 沙盒（test/sandbox/）。
# 子命令：build / start / stop / logs / status / sh / --help
#
# 设计：
#   * 构建上下文固定为 <repo>/test/sandbox/（docker build 只能 COPY 上下文内的文件）。
#     插件 vsix 由本脚本先拷到 test/sandbox/dsh-one.vsix（被 .gitignore 的 *.vsix 忽略，不污染仓库），
#     再以 --build-arg VSIX=<绝对主机路径> 传入；不带 --vsix 时拷一个空占位文件让 Dockerfile 的 COPY 通过，
#     镜像里跳过安装仍可用。
#   * LOCALE/THEME 两条路径：build 用 --build-arg 写进镜像默认，start 用 -e 在运行期覆盖（entrypoint 消费），
#     实现「一个镜像四种组合（深/浅主题 × 中/英文界面）」——改 locale/theme 重启容器即可。
#   * 脚本在宿主跑（macOS bash 3.2），不用 bash 4 专有语法。

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONTEXT="$SCRIPT_DIR"
IMAGE="dsh-sandbox:latest"
CONTAINER="dsh-sandbox"
VSIX_NAME="dsh-one.vsix"   # 上下文里固定的 vsix 文件名（每次 build 前覆盖/占位）

DEFAULT_LOCALE="en"
DEFAULT_THEME="dark"
VALID_LOCALES="en zh-cn"
VALID_THEMES="dark light"

usage() {
  cat <<'EOF'
run-sandbox.sh —— 构建并驱动 DSH One 的 docker 沙盒（code-server + dsh + 插件 vsix）

用法: test/sandbox/run-sandbox.sh <子命令> [选项]

子命令:
  build   构建镜像（上下文固定为 test/sandbox/）
          --vsix <绝对路径>    预装的插件 vsix（省略则跳过安装，镜像仍可用）
          --locale <en|zh-cn>  镜像默认界面语言（默认 en）
          --theme <dark|light> 镜像默认主题（默认 dark）
          --mock-llm           把仓库 test/mock-llm/*.ts 拷进构建上下文（.build-mock-llm/），镜像带假端点
  start   启动容器（名字固定为 dsh-sandbox；宿主 ~/.dsh 只读挂载进容器）
          --locale <en|zh-cn>  本次界面语言（默认 en，由容器 entrypoint 消费）
          --theme <dark|light> 本次主题（默认 dark，由容器 entrypoint 消费）
          --port <端口>        宿主/容器端口（默认 8080，容器内 code-server 监听此端口）
          --mock-llm           mock 模式启动：-e MOCK_LLM=1 + 宿主 9009 映射到容器内假端点
  stop    停止并删除容器 dsh-sandbox
  logs    跟随容器 dsh-sandbox 日志（Ctrl-C 退出）
  status  显示镜像与容器状态、端口映射
  sh      进入容器 shell（/bin/bash）
  --help / -h  显示本帮助

示例:
  test/sandbox/run-sandbox.sh build --vsix "$(pwd)/dsh-one-1.0.0.vsix"
  test/sandbox/run-sandbox.sh start --locale zh-cn --theme light --port 9000
  test/sandbox/run-sandbox.sh build --mock-llm        # mock-llm 模式需 build+start 配套
  test/sandbox/run-sandbox.sh start --mock-llm
  test/sandbox/run-sandbox.sh status
  test/sandbox/run-sandbox.sh sh
EOF
}

die() { echo "错误: $1" >&2; exit 1; }

# 校验 locale/theme 是否合法，非法直接退出。
validate_locale_theme() {
  local locale="$1" theme="$2"
  case "$locale" in
    en|zh-cn) ;;
    *) die "非法 --locale '$locale'（可用: ${VALID_LOCALES}）" ;;
  esac
  case "$theme" in
    dark|light) ;;
    *) die "非法 --theme '$theme'（可用: ${VALID_THEMES}）" ;;
  esac
}

# 无副作用的选项解析：把 --xxx value 读进变量，同时逐个校验。
# 用法: parse_locale_theme "$@"  → 设置 locale/theme，遇到未知参数退出。
parse_locale_theme() {
  local key
  while [ $# -gt 0 ]; do
    key="$1"
    case "$key" in
      --locale) locale="${2:?--locale 需要值}"; shift 2 ;;
      --theme) theme="${2:?--theme 需要值}"; shift 2 ;;
      *) die "未知选项: $key" ;;
    esac
  done
  validate_locale_theme "$locale" "$theme"
}

build() {
  local vsix=""
  local locale="$DEFAULT_LOCALE"
  local theme="$DEFAULT_THEME"
  local mock_llm=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --vsix) vsix="${2:?--vsix 需要绝对路径}"; shift 2 ;;
      --locale) locale="${2:?--locale 需要值}"; shift 2 ;;
      --theme) theme="${2:?--theme 需要值}"; shift 2 ;;
      --mock-llm) mock_llm=1; shift ;;
      *) die "未知参数: $1" ;;
    esac
  done
  validate_locale_theme "$locale" "$theme"

  local build_vsix=""
  if [ -n "$vsix" ]; then
    # 相对路径补成绝对路径再检查是否存在（--vsix 传绝对或相对都行；docker --build-arg 只看非空标记）
    case "$vsix" in
      /*) : ;;
      *) vsix="$(pwd)/$vsix" ;;
    esac
    [ -f "$vsix" ] || die "--vsix 文件不存在: $vsix"
    cp "$vsix" "$CONTEXT/$VSIX_NAME"
    build_vsix="$vsix"
  else
    # 空占位：保证 Dockerfile 里 COPY dsh-one.vsix 通过；镜像内 VSIX 为空会被删掉，不装扩展。
    : > "$CONTEXT/$VSIX_NAME"
  fi

  # mock-llm 模式：把仓库 test/mock-llm/*.ts 暂存进构建上下文 .build-mock-llm/（gitignored，不污染仓库）。
  # 上下文固定为 test/sandbox/，docker build 只能 COPY 上下文内文件；Dockerfile 再从 .build-mock-llm 拷到 /app/mock-llm。
  # 真实模式也创建（可为空的）目录，保证 Dockerfile 里 COPY .build-mock-llm 这一行始终能通过。
  rm -rf "$CONTEXT/.build-mock-llm"
  mkdir -p "$CONTEXT/.build-mock-llm"
  if [ "$mock_llm" = "1" ]; then
    [ -f "$REPO_ROOT/test/mock-llm/server.ts" ] || die "--mock-llm 构建需要仓库 test/mock-llm/server.ts（含 scenario.ts），但该文件不存在"
    cp "$REPO_ROOT/test/mock-llm/"*.ts "$CONTEXT/.build-mock-llm/"
    echo "已把 test/mock-llm/*.ts 暂存进 $CONTEXT/.build-mock-llm/"
  fi

  # docker build 默认走 buildx，buildx 会把 builder 元数据（activity 记录等）写到
  # $HOME/.docker/buildx/——在 session workspace 外，DSH workspace-write 沙盒下写被拦
  # （实测报错: failed to update builder last activity time: ... operation not permitted），
  # 只能提权重试。把 BUILDX_CONFIG 重定向到 /tmp（平台临时区可写）即可完全避开；
  # 用户已显式设置时尊重其值。
  export BUILDX_CONFIG="${BUILDX_CONFIG:-/tmp/dsh-sandbox-buildx}"
  mkdir -p "$BUILDX_CONFIG"

  echo "构建镜像 ${IMAGE}（LOCALE=$locale THEME=$theme VSIX=${build_vsix:+是} MOCK_LLM=${mock_llm}）"
  echo "上下文: $CONTEXT"
  docker build \
    --build-arg "VSIX=$build_vsix" \
    --build-arg "LOCALE=$locale" \
    --build-arg "THEME=$theme" \
    --build-arg "MOCK_LLM=$mock_llm" \
    -t "$IMAGE" "$CONTEXT"
}

start() {
  local locale="$DEFAULT_LOCALE"
  local theme="$DEFAULT_THEME"
  local port="8080"
  local mock_llm=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --locale) locale="${2:?--locale 需要值}"; shift 2 ;;
      --theme) theme="${2:?--theme 需要值}"; shift 2 ;;
      --port) port="${2:?--port 需要值}"; shift 2 ;;
      --mock-llm) mock_llm=1; shift ;;
      *) die "未知参数: $1" ;;
    esac
  done
  validate_locale_theme "$locale" "$theme"
  case "$port" in
    *[!0-9]*) die "非法 --port '$port'（需为数字）" ;;
    '') die "--port 需要值" ;;
  esac

  docker image inspect "$IMAGE" >/dev/null 2>&1 || die "镜像 $IMAGE 不存在，先跑 build"

  # 幂等重创：已存在同名容器先强制删除（开发沙盒，允许直接重建）。
  if docker inspect "$CONTAINER" >/dev/null 2>&1; then
    echo "容器 $CONTAINER 已存在，先强制删除以重创"
    docker rm -f "$CONTAINER" >/dev/null
  fi

  local dsh_cfg="$HOME/.dsh"
  # 宿主 dsh 配置只读挂载进容器（entrypoint 复制到容器内可写副本，不污染宿主）。
  # ~/.dsh 不存在时跳过挂载（mock 场景不需要，也避免 docker 自动建 root 属主目录）。
  set -- \
    --name "$CONTAINER" \
    -e "LOCALE=$locale" \
    -e "THEME=$theme" \
    -e "PORT=$port" \
    -e "MOCK_LLM=$mock_llm" \
    -p "$port:$port" \
    "$IMAGE"
  # mock-llm 模式额外暴露 9009（容器内 mock 端点）到宿主，便于 curl /v1/models 调试。
  if [ "$mock_llm" = "1" ]; then
    set -- -p 9009:9009 "$@"
  fi
  if [ -d "$dsh_cfg" ]; then
    set -- -v "$dsh_cfg:/dsh-config-ro:ro" "$@"
  else
    echo "警告: 宿主 $dsh_cfg 不存在，不挂载 dsh 配置（真 dsh 场景请先 npm i -g @deepseek-ai/dsh 初始化，mock 场景无碍）" >&2
  fi

  docker run -d "$@"
  echo "沙盒已启动: http://localhost:${port}（容器名 ${CONTAINER}${mock_llm:+，mock-llm 端点 http://localhost:9009}）"
  echo "开浏览器访问上面的地址；日志: test/sandbox/run-sandbox.sh logs"
}

stop() {
  if docker inspect "$CONTAINER" >/dev/null 2>&1; then
    docker rm -f "$CONTAINER" >/dev/null && echo "已停止并删除容器 $CONTAINER"
  else
    echo "容器 $CONTAINER 不存在（无需停止）"
  fi
}

logs() {
  docker logs -f "$CONTAINER"
}

status() {
  echo "--- 镜像 ---"
  if docker image inspect "$IMAGE" >/dev/null 2>&1; then
    docker image ls "$IMAGE"
  else
    echo "镜像 $IMAGE 不存在，先跑 build"
  fi
  echo
  echo "--- 容器 ---"
  if docker inspect "$CONTAINER" >/dev/null 2>&1; then
    docker ps -a --filter "name=$CONTAINER" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  else
    echo "容器 $CONTAINER 不存在，先跑 start"
  fi
  echo
  echo "启动: test/sandbox/run-sandbox.sh start ...（详见 --help）"
}

sh() {
  docker exec -it "$CONTAINER" /bin/bash
}

if [ $# -eq 0 ]; then
  usage
  exit 0
fi
cmd="$1"
shift

case "$cmd" in
  --help|-h|help) usage ;;
  build) build "$@" ;;
  start) start "$@" ;;
  stop) stop "$@" ;;
  logs) logs "$@" ;;
  status) status "$@" ;;
  sh) sh "$@" ;;
  *) die "未知子命令: ${cmd}（试试 --help）" ;;
esac
