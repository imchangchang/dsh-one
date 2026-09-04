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
#   * 并行实例（--instance <slug>）：worktree 并行开发时多个 session 同时跑沙盒会互相干扰
#     （镜像 tag/容器名/端口/截图目录全是固定单一值，见 backlog sandbox-parallel-instance）。
#     传 --instance 后镜像 tag、容器名、buildx 目录按 slug 派生，端口必须显式指定（--port，mock 模式
#     还有 --mock-port）——每个 session 各用各的实例互不干扰；不传保持原行为（默认实例，向后兼容）。
#   * 脚本在宿主跑（macOS bash 3.2），不用 bash 4 专有语法。

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONTEXT="$SCRIPT_DIR"
DEFAULT_IMAGE="dsh-sandbox:latest"
DEFAULT_CONTAINER="dsh-sandbox"
VSIX_NAME="dsh-one.vsix"   # 上下文里固定的 vsix 文件名（每次 build 前覆盖/占位）

DEFAULT_LOCALE="en"
DEFAULT_THEME="dark"
VALID_LOCALES="en zh-cn"
VALID_THEMES="dark light"

INSTANCE=""   # 空 = 默认实例（资源名固定，向后兼容）

usage() {
  cat <<'EOF'
run-sandbox.sh —— 构建并驱动 DSH One 的 docker 沙盒（code-server + dsh + 插件 vsix）

用法: test/sandbox/run-sandbox.sh <子命令> [选项]

通用:
  --instance <slug>   并行实例名：镜像 tag/容器名/buildx 目录按 slug 派生（默认实例时不传，
                      资源名固定：镜像 dsh-sandbox:latest、容器 dsh-sandbox）

子命令:
  build   构建镜像（上下文固定为 test/sandbox/）
          --vsix <绝对路径>    预装的插件 vsix（省略则跳过安装，镜像仍可用）
          --locale <en|zh-cn>  镜像默认界面语言（默认 en）
          --theme <dark|light> 镜像默认主题（默认 dark）
          --mock-llm           把仓库 test/mock-llm/*.ts 拷进构建上下文（.build-mock-llm/），镜像带假端点
  start   启动容器（宿主 ~/.dsh 只读挂载进容器）
          --locale <en|zh-cn>  本次界面语言（默认 en，由容器 entrypoint 消费）
          --theme <dark|light> 本次主题（默认 dark，由容器 entrypoint 消费）
          --port <端口>        宿主/容器端口（默认 8080；有 --instance 时必填——默认实例已占 8080）
          --mock-llm           mock 模式启动：-e MOCK_LLM=1 + 宿主 mock 端口映射到容器内假端点
          --mock-port <端口>    mock 端点宿主端口（默认 9009；有 --instance 且未显式给时自动取 --port+1）
  stop    停止并删除容器（当前实例）
  logs    跟随容器（当前实例）日志（Ctrl-C 退出）
  status  显示镜像与容器（当前实例）状态、端口映射
  sh      进入容器（当前实例）shell（/bin/bash）
  --help / -h  显示本帮助

并行示例（两个 session 各用各的实例）:
  test/sandbox/run-sandbox.sh build --instance a --vsix "$(pwd)/dsh-one-1.0.0.vsix" --mock-llm
  test/sandbox/run-sandbox.sh start --instance a --mock-llm --port 8081
  test/sandbox/run-sandbox.sh build --instance b --vsix "$(pwd)/dsh-one-1.0.0.vsix" --mock-llm
  test/sandbox/run-sandbox.sh start --instance b --mock-llm --port 8082

示例（默认实例，同原来）:
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

# 校验 --instance：空（默认实例）合法；否则只允许字母/数字/连字符，且连字符不在首位（防容器名注入/歧义）。
validate_instance() {
  [ -z "$INSTANCE" ] && return 0
  case "$INSTANCE" in
    *[!a-zA-Z0-9-]*|-*) die "非法 --instance '$INSTANCE'（只允许字母、数字、连字符，且不能以连字符开头）" ;;
  esac
}

# 按 INSTANCE 派生当前实例的资源名（INSTANCE 为空 = 默认实例，保持历史行为）。
instance_image() {
  if [ -n "$INSTANCE" ]; then echo "dsh-sandbox-$INSTANCE:latest"; else echo "$DEFAULT_IMAGE"; fi
}
instance_container() {
  if [ -n "$INSTANCE" ]; then echo "dsh-sandbox-$INSTANCE"; else echo "$DEFAULT_CONTAINER"; fi
}
instance_buildx() {
  # 用户显式设了 BUILDX_CONFIG 则尊重；否则按实例派生（默认实例保持 /tmp/dsh-sandbox-buildx）。
  if [ -n "${BUILDX_CONFIG:-}" ]; then echo "$BUILDX_CONFIG"; return; fi
  if [ -n "$INSTANCE" ]; then echo "/tmp/dsh-sandbox-buildx-$INSTANCE"; else echo "/tmp/dsh-sandbox-buildx"; fi
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
      --instance) INSTANCE="${2:?--instance 需要值}"; shift 2 ;;
      *) die "未知参数: $1" ;;
    esac
  done
  validate_locale_theme "$locale" "$theme"
  validate_instance
  local image
  image="$(instance_image)"

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
  # 用户已显式设置时尊重其值。并行实例各自一个目录，避免相互踩 buildx 元数据。
  export BUILDX_CONFIG="$(instance_buildx)"
  mkdir -p "$BUILDX_CONFIG"

  echo "构建镜像 ${image}（LOCALE=$locale THEME=$theme VSIX=${build_vsix:+是} MOCK_LLM=${mock_llm}）"
  echo "上下文: $CONTEXT"
  docker build \
    --build-arg "VSIX=$build_vsix" \
    --build-arg "LOCALE=$locale" \
    --build-arg "THEME=$theme" \
    --build-arg "MOCK_LLM=$mock_llm" \
    -t "$image" "$CONTEXT"
}

start() {
  local locale="$DEFAULT_LOCALE"
  local theme="$DEFAULT_THEME"
  local port="8080"
  local port_given=0
  local mock_llm=0
  local mock_port="9009"
  local mock_port_given=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --locale) locale="${2:?--locale 需要值}"; shift 2 ;;
      --theme) theme="${2:?--theme 需要值}"; shift 2 ;;
      --port) port="${2:?--port 需要值}"; port_given=1; shift 2 ;;
      --mock-llm) mock_llm=1; shift ;;
      --mock-port) mock_port="${2:?--mock-port 需要值}"; mock_port_given=1; shift 2 ;;
      --instance) INSTANCE="${2:?--instance 需要值}"; shift 2 ;;
      *) die "未知参数: $1" ;;
    esac
  done
  validate_locale_theme "$locale" "$theme"
  validate_instance
  case "$port" in
    *[!0-9]*) die "非法 --port '$port'（需为数字）" ;;
    '') die "--port 需要值" ;;
  esac
  case "$mock_port" in
    *[!0-9]*) die "非法 --mock-port '$mock_port'（需为数字）" ;;
    '') die "--mock-port 需要值" ;;
  esac
  # 并行实例必须显式指定宿主端口：默认实例已占 8080，自动派生必撞。
  if [ -n "$INSTANCE" ] && [ "$port_given" = "0" ]; then
    die "--instance 时 --port 必填（默认实例已占用 8080）"
  fi
  # mock 端点宿主端口：显式给了用显式值；实例化但没给时自动取 --port+1（并行时避免撞 9009）。
  if [ "$mock_llm" = "1" ] && [ "$mock_port_given" = "0" ] && [ -n "$INSTANCE" ]; then
    mock_port=$((port + 1))
    echo "--mock-port 未显式指定，实例化模式取 --port+1 => ${mock_port}（容器内映射固定 9009）"
  fi
  [ "$port" = "$mock_port" ] && die "--port 与 --mock-port 不能相同（${port}）"

  local image container
  image="$(instance_image)"
  container="$(instance_container)"
  docker image inspect "$image" >/dev/null 2>&1 || die "镜像 $image 不存在，先跑 build"

  # 幂等重创：已存在同名容器先强制删除（开发沙盒，允许直接重建）。
  # 注意必须 --type container：实例化后存在同名镜像（dsh-sandbox-<slug>:latest），
  # docker inspect 裸名会匹配镜像导致判断失真。
  if docker inspect --type container "$container" >/dev/null 2>&1; then
    echo "容器 $container 已存在，先强制删除以重创"
    docker rm -f "$container" >/dev/null
  fi

  local dsh_cfg="$HOME/.dsh"
  # 宿主 dsh 配置只读挂载进容器（entrypoint 复制到容器内可写副本，不污染宿主）。
  # ~/.dsh 不存在时跳过挂载（mock 场景不需要，也避免 docker 自动建 root 属主目录）。
  set -- \
    --name "$container" \
    -e "LOCALE=$locale" \
    -e "THEME=$theme" \
    -e "PORT=$port" \
    -e "MOCK_LLM=$mock_llm" \
    -p "$port:$port" \
    "$image"
  # mock-llm 模式额外暴露容器内 mock 端点（固定 9009）到宿主，便于 curl /v1/models 调试。
  if [ "$mock_llm" = "1" ]; then
    set -- -p "$mock_port:9009" "$@"
  fi
  if [ -d "$dsh_cfg" ]; then
    set -- -v "$dsh_cfg:/dsh-config-ro:ro" "$@"
  else
    echo "警告: 宿主 $dsh_cfg 不存在，不挂载 dsh 配置（真 dsh 场景请先 npm i -g @deepseek-ai/dsh 初始化，mock 场景无碍）" >&2
  fi

  docker run -d "$@"
  echo "沙盒已启动: http://localhost:${port}（容器名 ${container}${mock_llm:+，mock-llm 端点 http://localhost:${mock_port}}）"
  echo "开浏览器访问上面的地址；日志: test/sandbox/run-sandbox.sh logs${INSTANCE:+ --instance $INSTANCE}"
}

stop() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --instance) INSTANCE="${2:?--instance 需要值}"; shift 2 ;;
      *) die "未知参数: $1" ;;
    esac
  done
  validate_instance
  local container
  container="$(instance_container)"
  if docker inspect --type container "$container" >/dev/null 2>&1; then
    docker rm -f "$container" >/dev/null && echo "已停止并删除容器 $container"
  else
    echo "容器 $container 不存在（无需停止）"
  fi
}

logs() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --instance) INSTANCE="${2:?--instance 需要值}"; shift 2 ;;
      *) die "未知参数: $1" ;;
    esac
  done
  validate_instance
  docker logs -f "$(instance_container)"
}

status() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --instance) INSTANCE="${2:?--instance 需要值}"; shift 2 ;;
      *) die "未知参数: $1" ;;
    esac
  done
  validate_instance
  local image container
  image="$(instance_image)"
  container="$(instance_container)"
  echo "--- 镜像 ---"
  if docker image inspect "$image" >/dev/null 2>&1; then
    docker image ls "$image"
  else
    echo "镜像 $image 不存在，先跑 build"
  fi
  echo
  echo "--- 容器 ---"
  if docker inspect --type container "$container" >/dev/null 2>&1; then
    docker ps -a --filter "name=$container" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  else
    echo "容器 $container 不存在，先跑 start"
  fi
  echo
  echo "启动: test/sandbox/run-sandbox.sh start ...（详见 --help）"
}

sh() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --instance) INSTANCE="${2:?--instance 需要值}"; shift 2 ;;
      *) die "未知参数: $1" ;;
    esac
  done
  validate_instance
  docker exec -it "$(instance_container)" /bin/bash
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
