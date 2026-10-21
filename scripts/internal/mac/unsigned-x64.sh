#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DESKTOP_VERSION="${CUBY_DESKTOP_VERSION:-$(node -p "require('$ROOT_DIR/App/shell/desktop/package.json').version")}"

case "${CUBY_ACCOUNT_CHANNEL:-phone}" in
  email)
    PACKAGE_EDITION="intl"
    ;;
  phone|"")
    PACKAGE_EDITION="cn"
    ;;
  *)
    echo "Unsupported CUBY_ACCOUNT_CHANNEL: ${CUBY_ACCOUNT_CHANNEL:-}" >&2
    exit 1
    ;;
esac

ARTIFACT_NAME="Cuby-$DESKTOP_VERSION-darwin-x64-unsigned.\${ext}"

export CUBY_SKIP_CODESIGN=1
export CUBY_PACKAGE_SIGNING=unsigned
bash "$ROOT_DIR/scripts/internal/mac/build-dmg.sh" \
  --x64 \
  "$@" \
  --config.extraMetadata.version="$DESKTOP_VERSION" \
  --config.artifactName="$ARTIFACT_NAME"
