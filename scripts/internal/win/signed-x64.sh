#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

unset CUBY_SKIP_CODESIGN
export CUBY_PACKAGE_SIGNING=signed
bash "$ROOT_DIR/scripts/internal/win/build-nsis.sh" "$@"
