#!/usr/bin/env bash
# Sign an already-built Windows NSIS installer with the local Certum SimplySign
# cloud certificate (non-exportable private key in the cloud HSM).
#
# This is a LOCAL convenience wrapper. It does not build anything: hand it an
# unsigned installer and it produces a timestamped, signed copy next to it,
# leaving the original untouched.
#
# Prerequisites:
#   1. SimplySign Desktop running and logged in (taskbar icon blue). If the
#      session expired, sign in again with the 6-digit token from the phone app.
#   2. signtool.exe — either the Windows SDK one, or the one from the vendor's
#      sign-tool.rar. Override the lookup with --signtool or SIGNTOOL.
#   3. The code-signing certificate present in Cert:\CurrentUser\My with its
#      private key exposed by SimplySign CSP.
#   4. A Python 3 interpreter for the NSIS integrity CRC helper (see below).
#
# NSIS integrity check: the installer recomputes a CRC-32 over [512, crc) at
# startup and shows "Installer integrity check has failed" when it does not
# match. signtool only rewrites PE header fields below offset 512, so signing
# alone keeps the CRC valid — but any other edit of the image (for example
# patching the VERSIONINFO strings) invalidates it. This script therefore
# validates the CRC before signing, repairs it when needed, and re-checks it
# afterwards.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/internal/shared/package-logging.sh"

INPUT=""
OUTPUT=""
SHA1="${WIN_CSC_SHA1:-EA7218FBF9D20E0726A5CF565144B0155048836E}"
TIMESTAMP_SERVER="${WIN_CSC_TIMESTAMP_SERVER:-http://time.certum.pl/}"
SIGNTOOL_OVERRIDE="${SIGNTOOL:-}"
FORCE=0

usage() {
  cat <<'USAGE'
Usage: sign-windows-local.sh --input <unsigned.exe> [options]

Options:
  --input <path>             Unsigned installer to sign (required unless an
                             *-unsigned.exe is found automatically).
  --output <path>            Signed output path. Default: input name with
                             "-unsigned" replaced by "-signed".
  --sha1 <thumbprint>        Certificate SHA1. Default: the project's Certum
                             cert, or WIN_CSC_SHA1 if set.
  --signtool <path>          Path to signtool.exe. Default: auto-detect the
                             Windows SDK copy, then the vendor sign-tool.rar
                             extract. Or set SIGNTOOL.
  --timestamp-server <url>   RFC3161 TSA. Default: http://time.certum.pl/
                             (or WIN_CSC_TIMESTAMP_SERVER).
  --force                    Overwrite --output if it already exists.
  --help, -h                 Show this help.

Examples:
  bash scripts/sign-windows-local.sh \
    --input ~/Downloads/Cuby-<version>-win32-x64-unsigned.exe
  bash scripts/sign-windows-local.sh \
    --input /c/path/Cuby-x-unsigned.exe --output /c/path/Cuby-x-signed.exe --force
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --input)
      [ "$#" -ge 2 ] || { echo "--input requires a path" >&2; exit 1; }
      INPUT="$2"; shift 2 ;;
    --input=*) INPUT="${1#--input=}"; shift ;;
    --output)
      [ "$#" -ge 2 ] || { echo "--output requires a path" >&2; exit 1; }
      OUTPUT="$2"; shift 2 ;;
    --output=*) OUTPUT="${1#--output=}"; shift ;;
    --sha1)
      [ "$#" -ge 2 ] || { echo "--sha1 requires a thumbprint" >&2; exit 1; }
      SHA1="$2"; shift 2 ;;
    --sha1=*) SHA1="${1#--sha1=}"; shift ;;
    --signtool)
      [ "$#" -ge 2 ] || { echo "--signtool requires a path" >&2; exit 1; }
      SIGNTOOL_OVERRIDE="$2"; shift 2 ;;
    --signtool=*) SIGNTOOL_OVERRIDE="${1#--signtool=}"; shift ;;
    --timestamp-server)
      [ "$#" -ge 2 ] || { echo "--timestamp-server requires a URL" >&2; exit 1; }
      TIMESTAMP_SERVER="$2"; shift 2 ;;
    --timestamp-server=*) TIMESTAMP_SERVER="${1#--timestamp-server=}"; shift ;;
    --force) FORCE=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

package_log_init "sign-windows-local" "$ROOT_DIR/App/shell/desktop/release/logs"
package_install_error_trap

to_win_path() {
  local p="$1"
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$p"
  else
    printf '%s\n' "$p"
  fi
}

NSIS_CRC_SCRIPT="$ROOT_DIR/scripts/internal/win/fix-nsis-crc.py"

find_python() {
  if [ -n "${PYTHON:-}" ] && [ -x "$PYTHON" ]; then
    printf '%s\n' "$PYTHON"; return 0
  fi
  local candidate
  for candidate in python3 python \
    "$HOME/.workbuddy/binaries/python/envs/default/Scripts/python.exe"; do
    if command -v "$candidate" >/dev/null 2>&1; then
      printf '%s\n' "$candidate"; return 0
    fi
  done
  return 1
}

# Returns 0 when the NSIS integrity CRC in $1 is valid, 1 when stale, 2 when the
# helper cannot run (not an NSIS installer, no Python, ...).
nsis_crc_check() {
  [ -f "$NSIS_CRC_SCRIPT" ] || return 2
  local py
  py="$(find_python)" || return 2
  MSYS_NO_PATHCONV=1 "$py" "$(to_win_path "$NSIS_CRC_SCRIPT")" "$(to_win_path "$1")" --check \
    >/dev/null 2>&1 && return 0
  return 1
}

nsis_crc_fix() {
  local py
  py="$(find_python)" || return 1
  MSYS_NO_PATHCONV=1 "$py" "$(to_win_path "$NSIS_CRC_SCRIPT")" "$(to_win_path "$1")"
}

# If no input was given, look in a couple of standard spots.
if [ -z "$INPUT" ]; then
  candidates=()
  for dir in "$HOME/Downloads" "$ROOT_DIR/App/shell/desktop/release"; do
    while IFS= read -r found; do
      [ -n "$found" ] && candidates+=("$found")
    done < <(find "$dir" -maxdepth 1 -type f -iname "*-unsigned.exe" 2>/dev/null | sort)
  done
  if [ "${#candidates[@]}" -eq 1 ]; then
    INPUT="${candidates[0]}"
    package_log "Auto-selected installer: $INPUT"
  elif [ "${#candidates[@]}" -gt 1 ]; then
    echo "Multiple unsigned installers found; pass --input:" >&2
    printf '  %s\n' "${candidates[@]}" >&2
    exit 1
  else
    echo "No unsigned installer found. Pass --input <path>." >&2
    exit 1
  fi
fi

if [ ! -f "$INPUT" ]; then
  echo "Input file not found: $INPUT" >&2
  exit 1
fi

if [ -z "$OUTPUT" ]; then
  OUTPUT="${INPUT%-unsigned.exe}-signed.exe"
  if [ "$OUTPUT" = "$INPUT" ]; then
    OUTPUT="${INPUT%.exe}-signed.exe"
  fi
fi

if [ "$OUTPUT" = "$INPUT" ]; then
  echo "Refusing to sign in place; choose a different --output." >&2
  exit 1
fi
if [ -e "$OUTPUT" ] && [ "$FORCE" -ne 1 ]; then
  echo "Output already exists: $OUTPUT (pass --force to overwrite)" >&2
  exit 1
fi

find_signtool() {
  if [ -n "$SIGNTOOL_OVERRIDE" ]; then
    printf '%s\n' "$SIGNTOOL_OVERRIDE"; return
  fi
  local found
  # Windows SDK copy first.
  found="$(find "/c/Program Files (x86)/Windows Kits/10/bin" \
    "/c/Program Files/Windows Kits/10/bin" -type f -iname signtool.exe 2>/dev/null \
    | grep -i '/x64/' | head -n 1 || true)"
  if [ -n "$found" ]; then printf '%s\n' "$found"; return; fi
  # Vendor sign-tool.rar extract (downloaded from the certificate provider).
  found="$(find "$HOME/Downloads" -type f -ipath '*sign-tool*/signtool.exe' 2>/dev/null | head -n 1 || true)"
  if [ -n "$found" ]; then printf '%s\n' "$found"; return; fi
  return 1
}

SIGNTOOL="$(find_signtool)" || {
  echo "signtool.exe not found. Install the Windows SDK or pass --signtool <path>." >&2
  exit 1
}
[ -f "$SIGNTOOL" ] || { echo "signtool path is not a file: $SIGNTOOL" >&2; exit 1; }

package_step_start "Preflight: SimplySign session and certificate"
if command -v powershell.exe >/dev/null 2>&1; then
  cert_state="$(powershell.exe -NoProfile -Command \
    "\$c = Get-ChildItem Cert:\\CurrentUser\\My -CodeSigningCert -ErrorAction SilentlyContinue | Where-Object { \$_.Thumbprint -eq '$SHA1' }; if (\$c -and \$c.HasPrivateKey) { 'OK' } else { 'MISSING' }" \
    2>/dev/null | tr -d '\r\n')"
  if [ "$cert_state" != "OK" ]; then
    echo "Certificate $SHA1 not found with a private key in Cert:\\CurrentUser\\My." >&2
    echo "Make sure SimplySign Desktop is logged in (taskbar icon blue)." >&2
    exit 1
  fi
  if ! powershell.exe -NoProfile -Command \
      "exit [int]-not [bool](Get-Process -Name '*SimplySign*' -ErrorAction SilentlyContinue)" \
      >/dev/null 2>&1; then
    echo "Warning: SimplySign Desktop process not detected; signing may fail." >&2
  fi
else
  echo "Warning: powershell.exe not available; skipping certificate preflight." >&2
fi
package_log "signtool: $SIGNTOOL"
package_log "certificate SHA1: $SHA1"

package_step_start "Copy unsigned installer to signed output"
cp "$INPUT" "$OUTPUT"
package_log "Copied: $INPUT -> $OUTPUT"

package_step_start "Check NSIS integrity CRC (repair before signing if stale)"
crc_state=0
nsis_crc_check "$OUTPUT" || crc_state=$?
case "$crc_state" in
  0)
    package_log "NSIS CRC valid; signing will keep it valid."
    ;;
  1)
    package_log "NSIS CRC stale (image was edited after packaging); repairing before signing."
    nsis_crc_fix "$OUTPUT" >&2 || true
    if ! nsis_crc_check "$OUTPUT"; then
      echo "Failed to repair the NSIS integrity CRC." >&2
      exit 1
    fi
    package_log "NSIS CRC repaired; signing will keep it valid."
    ;;
  *)
    package_log "Could not evaluate the NSIS CRC (helper or Python unavailable); skipping."
    ;;
esac

package_step_start "Sign with SHA-256 and RFC3161 timestamp ($TIMESTAMP_SERVER)"
INPUT_WIN="$(to_win_path "$OUTPUT")"
# A fresh 300+ MB copy is briefly held by the antivirus scanner, which makes
# signtool fail with "The file is being used by another process". Retry a few
# times before giving up.
sign_with_retry() {
  local attempt=1 out
  while :; do
    if out="$(MSYS_NO_PATHCONV=1 "$SIGNTOOL" sign \
        /sha1 "$SHA1" \
        /tr "$TIMESTAMP_SERVER" \
        /td sha256 \
        /fd sha256 \
        /v \
        "$INPUT_WIN" 2>&1)"; then
      printf '%s\n' "$out"
      return 0
    fi
    if [ "$attempt" -ge 5 ]; then
      printf '%s\n' "$out" >&2
      return 1
    fi
    package_log "Sign attempt $attempt failed (file busy?); retrying in 3s..."
    sleep 3
    attempt=$((attempt + 1))
  done
}
# Git Bash (MSYS) rewrites arguments starting with "/" such as /sha1 and /tr
# into Windows paths before handing them to a native .exe. Disable that so the
# signtool flags arrive intact. The file path is already converted by cygpath.
sign_with_retry

package_step_start "Verify signature and timestamp"
MSYS_NO_PATHCONV=1 "$SIGNTOOL" verify /pa "$INPUT_WIN"
MSYS_NO_PATHCONV=1 "$SIGNTOOL" verify /pa /tw "$INPUT_WIN"

package_step_start "Confirm NSIS integrity CRC survived signing"
if ! nsis_crc_check "$OUTPUT"; then
  echo "NSIS integrity CRC is invalid after signing; the installer would fail with" >&2
  echo "'Installer integrity check has failed'. Do not ship it." >&2
  package_log "ERROR: NSIS CRC invalid after signing"
  package_log_finish 1
  exit 1
fi
package_log "NSIS CRC still valid: the installer will start normally."

package_log "Signed installer: $OUTPUT"
if command -v sha256sum >/dev/null 2>&1; then
  package_log "SHA256: $(sha256sum "$OUTPUT" | awk '{print $1}')"
fi
package_log_finish 0
