#!/usr/bin/env bash
#
# One-click dsh (DeepSeek Harness) installer for macOS / Linux.
# UNOFFICIAL: maintained by the dsh-one project, not by DeepSeek Harness.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/imchangchang/dsh-one/main/install/dsh-install.sh | bash
#
# dsh is installed from npm. This script self-detects the platform and
# architecture, reuses a compatible Node on PATH (>= 22.19, or >= 24), or
# otherwise downloads an official portable Node tarball into ~/.dsh and
# prepends it to PATH. Then pnpm and @deepseek-ai/dsh are installed globally
# into that Node. No admin/root needed.
#
# Optional env:
#   DSH_INSTALL_DIR    base dir, default ~/.dsh
#   DSH_NO_MODIFY_PATH skip PATH modification when set to a non-empty value
#   DSH_NODE_VERSION   pin an exact Node version, e.g. "22.19.1"
#   DSH_SKIP_GIT       skip the best-effort git check
#
# git is optional: dsh core, web UI, and headless runs work without it.

set -euo pipefail

DSH_BASE="${DSH_INSTALL_DIR:-$HOME/.dsh}"
DSH_NO_PATH="${DSH_NO_MODIFY_PATH:-}"
DSH_NODE_PIN="${DSH_NODE_VERSION:-}"
DSH_SKIP_GIT="${DSH_SKIP_GIT:-}"
# Official Node dist + npmmirror mirror (tried in order; auto fallback on network/CDN failures).
NODE_DIST_BASES=(
  "https://nodejs.org/dist"
  "https://registry.npmmirror.com/-/binary/node"
)

say()  { printf '==> %s\n' "$*" >&2; }
warn() { printf 'warn: %s\n' "$*" >&2; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

# ---------- self detection ----------

detect_os() {
  case "$(uname -s)" in
    Darwin) echo macos ;;
    Linux)  echo linux ;;
    *)      die "unsupported platform: $(uname -s) (dsh needs macOS or Linux)" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)   echo x64 ;;
    aarch64|arm64)  echo arm64 ;;
    *) die "unsupported architecture: $(uname -m) (dsh needs x64 or arm64)" ;;
  esac
}

split_node_version() { # -> "major minor patch" or empty
  local m
  m=$(printf '%s' "$1" | sed -nE 's/^v?([0-9]+)\.([0-9]+)\.([0-9]+).*/\1 \2 \3/p')
  [ -n "$m" ] && echo "$m"
}

# dsh requires Node ^22.19.0 || >=24.0.0 (repo engines field): 22.x >= 22.19,
# or any 24+, but NOT 23.x.
node_compatible() {
  local parts
  parts=$(split_node_version "$1") || return 1
  local major minor
  major=$(echo "$parts" | cut -d' ' -f1)
  minor=$(echo "$parts" | cut -d' ' -f2)
  { [ "$major" -eq 22 ] && [ "$minor" -ge 19 ]; } || [ "$major" -ge 24 ]
}

node_on_path() { # -> path | empty
  command -v node 2>/dev/null || true
}

latest_lts_version() {
  if [ -n "$DSH_NODE_PIN" ]; then
    split_node_version "$DSH_NODE_PIN" >/dev/null || die "bad DSH_NODE_VERSION: $DSH_NODE_PIN"
    echo "$DSH_NODE_PIN"
    return
  fi
  say "Resolving latest Node LTS from ${NODE_DIST_BASES[0]}/index.json"
  # entries are newest-first; the first entry whose "lts" is a non-false string
  # is the latest LTS release. Token stream keeps version and its lts paired
  # without a JSON parser: version and lts tokens alternate per entry.
  local ver=""
  local base
  for base in "${NODE_DIST_BASES[@]}"; do
    say "Trying $base/index.json"
    ver=$(curl -fsSL "$base/index.json" 2>/dev/null \
      | grep -oE '"version":"v[0-9.]+"|"lts":(false|"[^"]*")' \
      | awk '/"version":"v/ { v=$0; sub(/.*"version":"v/,"",v); sub(/".*/,"",v) }
             /"lts":"[^"]+"/ { print v; exit }' \
      || true)
    [ -n "$ver" ] && break
    warn "version resolution failed from $base"
  done
  [ -n "$ver" ] || die "could not resolve a Node LTS version (network failure?)"
  node_compatible "v$ver" || die "no Node LTS >= 22.19 found"
  echo "$ver"
}

# ---------- PATH ----------

add_to_user_path() {
  local dir="$1"
  # This process always needs the dir on PATH: npm's shebang is
  # #!/usr/bin/env node, so without it even the npm call fails.
  # Persisting to rc files is a separate concern, gated below.
  export PATH="$dir:$PATH"
  if [ -n "$DSH_NO_PATH" ]; then
    say "Skipping persistent PATH update (DSH_NO_MODIFY_PATH set)"
    return
  fi
  # Append the export snippet to existing shell rc files (bash and zsh);
  # ~/.bashrc also covers sh-starting-from-bash setups.
  local snippet="export PATH=\"$dir:\$PATH\""
  local rc wrote=0
  for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile"; do
    [ -f "$rc" ] || continue
    if grep -qF -- "$snippet" "$rc" 2>/dev/null; then continue; fi
    printf '\n# dsh installer PATH\n%s\n' "$snippet" >> "$rc"
    wrote=1
  done
  # no rc file existed at all: create ~/.bashrc rather than silently skipping
  if [ "$wrote" -eq 0 ] && ! grep -qF -- "$snippet" "$HOME/.bashrc" 2>/dev/null; then
    printf '\n# dsh installer PATH\n%s\n' "$snippet" >> "$HOME/.bashrc"
  fi
  # right now, for this script's own verification
  export PATH="$dir:$PATH"
  say "Added $dir to PATH (new shells will pick it up; see ~/.zshrc / ~/.bashrc)"
}

# ---------- Node.js ----------

install_portable_node() { # $1=version $2=os $3=arch
  local version="$1" os="$2" arch="$3"
  # nodejs.org ships macOS artifacts with a darwin prefix (node-vX-darwin-arm64.tar.gz).
  local tar_os
  [ "$os" = macos ] && tar_os=darwin || tar_os="$os"
  local tarball="node-v$version-$tar_os-$arch"
  local ext
  [ "$os" = macos ] && ext=tar.gz || ext=tar.xz
  local node_home="$DSH_BASE/node-$os-$arch"

  if [ -x "$node_home/bin/node" ]; then
    say "Portable Node already installed at $node_home"
    echo "$node_home"
    return
  fi

  say "Downloading Node $version ($os-$arch)"
  mkdir -p "$DSH_BASE"
  local tmp="$DSH_BASE/.node-extract-$$"
  rm -rf "$tmp"; mkdir -p "$tmp"
  local base ok=0
  for base in "${NODE_DIST_BASES[@]}"; do
    if curl -fsSL "$base/v$version/$tarball.$ext" -o "$tmp/$tarball.$ext" 2>/dev/null; then
      ok=1; case "$base" in *nodejs.org*) : ;; *) say "downloaded from mirror $base" ;; esac
      break
    fi
    warn "download failed from $base; trying the next source"
  done
  [ "$ok" -eq 1 ] || die "Node download failed from all mirrors"

  say "Verifying SHA256"
  local sums expected actual
  sums=""
  for base in "${NODE_DIST_BASES[@]}"; do
    sums=$(curl -fsSL "$base/v$version/SHASUMS256.txt" 2>/dev/null || true)
    [ -n "$sums" ] && break
  done
  [ -n "$sums" ] || die "could not fetch SHASUMS256.txt from any mirror"
  expected=$(printf '%s\n' "$sums" | awk -v f="$tarball.$ext" '$2 == f { print $1 }')
  [ -n "$expected" ] || die "no checksum entry for $tarball.$ext"
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$tmp/$tarball.$ext" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$tmp/$tarball.$ext" | awk '{print $1}')
  else
    die "no sha256 tool (install sha256sum or shasum)"
  fi
  [ "$actual" = "$expected" ] || die "checksum mismatch: expected $expected, got $actual"

  case "$ext" in
    tar.gz) tar -xzf "$tmp/$tarball.$ext" -C "$tmp" ;;
    tar.xz) tar -xJf "$tmp/$tarball.$ext" -C "$tmp" ;;
  esac
  [ -x "$tmp/$tarball/bin/node" ] || die "extracted archive missing bin/node"
  rm -rf "$node_home"
  mv "$tmp/$tarball" "$node_home"
  rm -rf "$tmp"
  say "Node installed to $node_home"
  echo "$node_home"
}

# ---------- git (optional, only for git-hosted plugin installs) ----------

ensure_git() {
  if command -v git >/dev/null 2>&1; then return; fi
  if [ -n "$DSH_SKIP_GIT" ]; then
    warn "git not found (DSH_SKIP_GIT set) - git-hosted plugins will not install"
    return
  fi
  warn "git not found - install Git from https://git-scm.com/download/win (or your package manager) if you need git-hosted plugins"
}

# ---------- main ----------

OS="$(detect_os)"
ARCH="$(detect_arch)"
say "Detected: $OS-$ARCH, bash ${BASH_VERSION%%.*}"

if command -v df >/dev/null 2>&1; then
  free_mb=$(df -m "$HOME" | awk 'NR==2 {print $4}')
  if [ -n "$free_mb" ] && [ "$free_mb" -lt 1024 ]; then
    die "not enough disk space on $HOME (need ~1 GB)"
  fi
fi

# 1. Node.js
NODE_MODE=""
NODE_HOME=""
NODE_BIN="$(node_on_path)"
if [ -n "$NODE_BIN" ]; then
  NODE_VER="$("$NODE_BIN" --version)"
  if node_compatible "$NODE_VER"; then
    NODE_MODE=system
    say "Using existing Node $NODE_VER at $NODE_BIN"
  else
    say "Existing Node $NODE_VER is too old (dsh needs Node ^22.19.0 or >= 24.0.0)"
  fi
fi
if [ "$NODE_MODE" != system ]; then
  [ -n "$NODE_BIN" ] || say "Node.js not found"
  VERSION="$(latest_lts_version)"
  NODE_MODE=portable
  NODE_HOME="$(install_portable_node "$VERSION" "$OS" "$ARCH")"
  add_to_user_path "$NODE_HOME/bin"  # PATH update happens before npm runs
fi

# npm lives with node; portable tarball keeps npm in <install>/bin/npm
NPM="$(command -v npm 2>/dev/null || true)"
if [ -z "$NPM" ]; then
  if [ "$NODE_MODE" = portable ] && [ -f "$NODE_HOME/bin/npm" ]; then
    NPM="$NODE_HOME/bin/npm"
  else
    die "npm not found next to Node - reinstall Node or put npm on PATH"
  fi
fi

# 2. pnpm (required by `dsh plugin` for profile plugin management)
say "Ensuring pnpm"
if [ "$NODE_MODE" = portable ]; then
  "$NPM" --prefix "$NODE_HOME" install -g pnpm
else
  "$NPM" install -g pnpm
fi

# 3. dsh itself
say "Installing @deepseek-ai/dsh (this pulls the Web UI + agent plugins; keep the terminal open)"
if [ "$NODE_MODE" = portable ]; then
  "$NPM" --prefix "$NODE_HOME" install -g @deepseek-ai/dsh
  add_to_user_path "$NODE_HOME/bin"   # idempotent; earlier call may have been skipped via DSH_NO_MODIFY_PATH
else
  "$NPM" install -g @deepseek-ai/dsh
fi

# 4. git (best effort)
ensure_git

# 5. verify
DSH_CMD="$(command -v dsh 2>/dev/null || true)"
if [ -z "$DSH_CMD" ]; then
  if [ "$NODE_MODE" = portable ] && [ -x "$NODE_HOME/bin/dsh" ]; then
    DSH_CMD="$NODE_HOME/bin/dsh"
  else
    warn "dsh was installed but the command shim was not found on PATH; run: $NPM install -g @deepseek-ai/dsh"
  fi
fi
if [ -n "$DSH_CMD" ]; then
  DSH_VERSION="$("$DSH_CMD" --version)"
  say "Verified: dsh $DSH_VERSION ($DSH_CMD)"
fi

printf '\n'
printf '\033[32mDone.\033[0m\n'
printf 'Open a NEW terminal, then run:\n'
printf '  dsh web\n'
printf 'The Web UI starts at http://127.0.0.1:3080 - add your DeepSeek API key under Settings -> Models,\n'
printf 'then pick a workspace. Plugin management: dsh plugin --profile <name> add <package>\n'
