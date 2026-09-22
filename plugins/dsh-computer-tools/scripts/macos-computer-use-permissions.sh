#!/usr/bin/env bash
# Open the macOS TCC panes Computer Use needs. Does not write TCC.db and
# does not click the grant dialogs — those stay user-owned.
set -euo pipefail

APP="${DSH_DESKTOP_APP:-/Applications/DSH-Desktop.app}"
CUA_APP="${CUA_DRIVER_APP:-/Applications/CuaDriver.app}"

open 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
open 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

if [[ -d "$APP" ]]; then
  codesign -dv --verbose=4 "$APP" 2>&1 | awk '
    /^Identifier=|^TeamIdentifier=|^Signature=/ { print }
  ' || true
fi

if [[ -d "$CUA_APP" ]] && command -v cua-driver >/dev/null 2>&1; then
  cua-driver permissions grant || true
fi
