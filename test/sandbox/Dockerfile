# DSH One 沙盒环境：code-server + dsh +（可选）插件 vsix
#
# 设计要点（与 2026-09-03 spike 已验证配方对照，按产品化需求升级）：
#   * 基础镜像 codercom/code-server:latest 是 debian 系但**不带系统 node/npm**，
#     dsh（@deepseek-ai/dsh）需要 node 运行时，所以从官方 node 镜像多阶段拷入
#     /usr/local/bin 与 /usr/local/lib/node_modules（code-server 官方镜像既无 node 也无 npm）。
#   * dsh 必须 pin 到 @deepseek-ai/dsh@0.1.1-rc.2：升到 @next（0.1.2-rc.1）会新增 token 认证，
#     扩展侧没有任何 token 概念（probe/RPC 都不带凭证），/api/* 直接回 401，扩展 90s 启动超时起不来。
#     根因与方案见 docs/backlog/open/dsh-next-token-auth-incompatible.md。
#   * VSIX 由构建脚本先拷进构建上下文（test/sandbox/dsh-one.vsix），用 --build-arg VSIX=<绝对主机路径>
#     传入才安装；不带 --vsix（VSIX 为空）时跳过安装，镜像仍可用（后续 mock dsh 场景基本用不到真扩展）。
#     docker build 的上下文路径只能是 test/sandbox/，所以 vsix 必须由脚本拷进来而不是 COPY 外部路径。
#   * LOCALE/THEME：构建期用 --build-arg 设镜像默认值（ARG），再写成容器环境变量（ENV），
#     运行期可用 -e LOCALE/ -e THEME 覆盖，由 entrypoint 消费（写 argv.json 的 locale / settings.json 的主题）。

# 第一阶段：取出 node 运行时（code-server 官方镜像无系统 node）
FROM node:24-bookworm-slim AS node

# 第二阶段：code-server 沙盒
FROM codercom/code-server:latest

# 拷入 node 运行时与全局 node_modules（npm -g 安装的 dsh 依赖它们）
COPY --from=node /usr/local/bin /usr/local/bin
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules

# 构建期参数：LOCALE/THEME 默认值（运行期可 -e 覆盖）；VSIX 非空才预装扩展；
# MOCK_LLM=1 时 entrypoint 走 mock 分支（容器内真 dsh 打到容器内假端点）。
# 镜像默认 0（真实模式）；mock 模式由 run-sandbox.sh build --mock-llm / start --mock-llm 配套切换。
ARG LOCALE=en
ARG THEME=dark
ARG VSIX=""
ARG MOCK_LLM=0
ENV LOCALE=$LOCALE \
    THEME=$THEME \
    MOCK_LLM=$MOCK_LLM

USER root
# pin 0.1.1-rc.2 而不是 @next：0.1.2-rc.1 起 /api/* 带 token 认证，扩展不支持会 90s 启动超时。
# 装完清 npm 缓存（不加 --no-cache 也行，这里显式清理，镜像层更薄）。
RUN npm install -g @deepseek-ai/dsh@0.1.1-rc.2 && npm cache clean --force

USER coder
# 预置用户设置：关 workspace trust（否则 Restricted Mode 限制扩展）+ 关欢迎页。
# entrypoint 启动前会按 THEME 覆写 workbench.colorTheme（见 entrypoint.sh）；这里给一个可用的默认值。
RUN mkdir -p /home/coder/.local/share/code-server/User && \
    printf '{\n  "security.workspace.trust.enabled": false,\n  "workbench.startupEditor": "none"\n}\n' \
    > /home/coder/.local/share/code-server/User/settings.json

# 预装插件 vsix：拷贝自构建上下文（构建脚本保证 dsh-one.vsix 一定存在）。
# VSIX 非空才安装；为空则删掉占位文件，镜像仍是干净的 code-server+dsh，不含插件。
COPY --chown=coder:coder dsh-one.vsix /tmp/dsh-one.vsix
RUN if [ -n "$VSIX" ]; then \
      code-server --install-extension /tmp/dsh-one.vsix; \
    else \
      rm -f /tmp/dsh-one.vsix; \
    fi

# 拷入 mock-llm 端点源码：构建脚本把仓库 test/mock-llm/*.ts 暂存到上下文 .build-mock-llm/（见 run-sandbox.sh），
# 这里定在 /app/mock-llm；entrypoint 在 MOCK_LLM=1 时启动它（node 24 直接跑 .ts）。
# 真实模式（--mock-llm 未传）暂存目录为空，镜像 /app/mock-llm 空目录无碍（entrypoint 不会启动）。
COPY --chown=coder:coder .build-mock-llm /app/mock-llm

COPY --chown=coder:coder entrypoint.sh /tmp/entrypoint.sh
ENTRYPOINT ["/bin/bash", "/tmp/entrypoint.sh"]
