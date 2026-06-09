#!/bin/bash
# Build OneSwitch.app: compile (release), assemble the bundle, and sign it with the
# stable self-signed identity so Accessibility/Automation grants persist across rebuilds.
# Run scripts/setup-signing.sh once first.
set -euo pipefail
cd "$(dirname "$0")/.."

IDENTITY="OneSwitch Self-Signed"
KEYCHAIN="oneswitch-signing.keychain"
APP="OneSwitch.app"
CONFIG="${1:-release}"   # pass "debug" for a faster build

if ! security find-identity -p codesigning "$KEYCHAIN" 2>/dev/null | grep -q "$IDENTITY"; then
    echo "Signing identity '$IDENTITY' not found. Run scripts/setup-signing.sh first." >&2
    exit 1
fi
security unlock-keychain -p oneswitch "$KEYCHAIN" 2>/dev/null || true

echo "Building ($CONFIG)..."
swift build -c "$CONFIG" >/dev/null
BIN="$(swift build -c "$CONFIG" --show-bin-path)/OneSwitch"

echo "Assembling ${APP}..."
rm -rf "$APP"
mkdir -p "${APP}/Contents/MacOS" "${APP}/Contents/Resources"
cp "$BIN" "${APP}/Contents/MacOS/OneSwitch"
cp Resources/Info.plist "${APP}/Contents/Info.plist"
cp Resources/AppIcon.icns "${APP}/Contents/Resources/AppIcon.icns"

echo "Signing..."
codesign --force --sign "$IDENTITY" --timestamp=none "$APP"

echo "Verifying signature..."
codesign -dv --verbose=2 "$APP" 2>&1 | grep -Ei "Identifier|Authority|Signature"
codesign --verify --strict "$APP" && echo "signature valid"

echo "Built $(pwd)/${APP}"
