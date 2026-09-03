#!/usr/bin/env bash
#
# dsh-one uninstaller for macOS / Linux: remove the dsh installation managed by
# install/dsh-install.sh and restore the machine to the "dsh not installed"
# state (handy to retest the install flow). UNOFFICIAL tooling from the dsh-one
# repo, unrelated to dsh itself.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/imchangchang/dsh-one/main/install/dsh-uninstall.sh | bash
#
# Removes:
#   - running dsh node processes started from the install dir
#   - the install dir (portable Node, dsh CLI, profiles, settings.yaml)
#   - the "# dsh installer PATH" entries the installer added to shell rc files
# Before deleting, the install dir is copied to $TMPDIR/dsh-backup-<timestamp>
# because settings.yaml may hold API keys. No root needed (all paths are under
# the user profile); dsh processes started by another user would survive.
#
# Optional env:
#   DSH_INSTALL_DIR  base dir to remove, default ~/.dsh (mirrors the installer)
#   DSH_NO_BACKUP    skip the backup copy when set to a non-empty value

set -euo pipefail

DSH_BASE="${DSH_INSTALL_DIR:-$HOME/.dsh}"
DSH_NO_BACKUP="${DSH_NO_BACKUP:-}"

say()  { printf '==> %s\n' "$*" >&2; }
warn() { printf 'warn: %s\n' "$*" >&2; }

# 1. Stop running dsh node processes (they lock files under the install dir).
say "Stopping running dsh processes"
if command -v pgrep >/dev/null 2>&1; then
  pids="$(pgrep -f "$DSH_BASE" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    for pid in $pids; do
      say "Killing dsh node pid $pid"
      kill -TERM "$pid" 2>/dev/null || true
    done
    sleep 1
    for pid in $pids; do kill -9 "$pid" 2>/dev/null || true; done
  else
    say "No running dsh processes"
  fi
else
  say "pgrep not found; skipping process check"
fi

# 2. Backup, then remove the install dir (config may hold API keys).
say "Backing up and removing $DSH_BASE"
if [ -d "$DSH_BASE" ]; then
  if [ -n "$DSH_NO_BACKUP" ]; then
    warn "Skipping backup (DSH_NO_BACKUP set)"
  else
    backup="${TMPDIR:-/tmp}/dsh-backup-$(date +%Y%m%d-%H%M%S)"
    cp -R "$DSH_BASE" "$backup"
    say "Backed up to: $backup (delete it once you no longer need the old config)"
  fi
  rm -rf "$DSH_BASE"
else
  say "$DSH_BASE not present"
fi

# 3. Remove the installer's rc-file entries ("# dsh installer PATH" marker line
# plus the export line the installer wrote right after it). awk for a portable
# implementation across BSD/GNU sed.
say "Cleaning shell rc files"
for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile"; do
  [ -f "$rc" ] || continue
  if ! grep -qF '# dsh installer PATH' "$rc" 2>/dev/null; then
    continue
  fi
  tmp="$rc.dsh-uninstall.$$"
  awk '
    /^# dsh installer PATH$/ { skip = 2; next }
    skip > 0 { skip--; next }
    { print }
  ' "$rc" > "$tmp"
  mv "$tmp" "$rc"
  say "Cleaned $rc"
done

# 4. Verify the clean state.
say "Verifying"
printf '%-22s: %s\n' "$DSH_BASE exists" "$([ -d "$DSH_BASE" ] && echo yes || echo no)"
printf '%-22s: %s\n' 'dsh on PATH' "$(command -v dsh >/dev/null 2>&1 && echo yes || echo no)"
printf '%-22s: %s\n' 'node on PATH' "$(command -v node >/dev/null 2>&1 && echo yes || echo no)"
remaining=""
for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile"; do
  if [ -f "$rc" ] && grep -qF '# dsh installer PATH' "$rc" 2>/dev/null; then
    remaining="$remaining $rc"
  fi
done
printf '%-22s: %s\n' 'rc marker lines' "${remaining:-none}"
printf '\n'
printf 'Machine is back to the %s state. Reinstall anytime with:\n' "'dsh not installed'"
printf '  curl -fsSL https://raw.githubusercontent.com/imchangchang/dsh-one/main/install/dsh-install.sh | bash\n'
