#!/usr/bin/env bash
set -euo pipefail

# Wipe this machine's user-level Memmy/Cuby data/config/cache/state/preferences/logs, returning the App to a clean "freshly installed, never run" state.
# Difference from clear-config.sh: this script keeps the installed App and its CLI symlink, deleting only rebuildable local data — no reinstall needed.
# Covers both products and both appIds. rm -rf is irreversible, but everything deleted can be regenerated at runtime.

# Installed apps (only used to quit processes / verify results, never deleted)
APP_PATHS=(
  "/Applications/Memmy.app"
  "/Applications/Cuby.app"
)

# User-level data/config/cache/state/preferences/logs (covers both products and both appIds)
USER_PATHS=(
  "$HOME/Library/Application Support/Memmy"
  "$HOME/.memmy"
  "$HOME/Library/Logs/Memmy"
  "$HOME/Library/Caches/Memmy"
  "$HOME/Library/Caches/cn.memtensor.memmy"
  "$HOME/Library/Caches/ai.memmy.desktop"
  "$HOME/Library/Preferences/cn.memtensor.memmy.plist"
  "$HOME/Library/Preferences/ai.memmy.desktop.plist"
  "$HOME/Library/Saved Application State/cn.memtensor.memmy.savedState"
  "$HOME/Library/Saved Application State/ai.memmy.desktop.savedState"
  "$HOME/Library/HTTPStorages/cn.memtensor.memmy"
  "$HOME/Library/HTTPStorages/cn.memtensor.memmy.binarycookies"
  "$HOME/Library/WebKit/cn.memtensor.memmy"
  "$HOME/Library/Application Support/Cuby"
  "$HOME/.cuby"
  "$HOME/Library/Logs/Cuby"
  "$HOME/Library/Caches/Cuby"
  "$HOME/Library/Caches/cn.memtensor.cuby"
  "$HOME/Library/Preferences/cn.memtensor.cuby.plist"
  "$HOME/Library/Saved Application State/cn.memtensor.cuby.savedState"
  "$HOME/Library/HTTPStorages/cn.memtensor.cuby"
  "$HOME/Library/HTTPStorages/cn.memtensor.cuby.binarycookies"
  "$HOME/Library/WebKit/cn.memtensor.cuby"
)

# 1. Quit all Memmy and Cuby processes (app, helper, and the memory/agent runtimes they spawn) so files aren't locked and undeletable
echo "==> Quitting Memmy/Cuby processes"
osascript -e 'quit app "Memmy"' 2>/dev/null || true
osascript -e 'quit app "Cuby"' 2>/dev/null || true
sleep 1
for app_path in "${APP_PATHS[@]}"; do
  pkill -f "$app_path" 2>/dev/null || true
done
pkill -f "memory-service/memory.sqlite" 2>/dev/null || true

# 2. Delete user-level data/config/cache/state/preferences/logs (keep App and CLI)
echo "==> Cleaning up local user-level data (keeping the installed App)"
for path in "${USER_PATHS[@]}"; do
  rm -rf "$path"
done

# Result check: any installed App should still exist, user data should be gone
echo "path-check:"
for app_path in "${APP_PATHS[@]}"; do
  if [ -e "$app_path" ]; then
    echo "kept:    $app_path"
  else
    echo "missing: $app_path (App not installed or already removed; this script does not reinstall it)"
  fi
done
for path in "${USER_PATHS[@]}"; do
  if [ -e "$path" ] || [ -L "$path" ]; then
    echo "still-exists: $path"
  else
    echo "deleted: $path"
  fi
done

echo "Done. Local data has been wiped; the App remains installed and will initialize fresh on next launch."
