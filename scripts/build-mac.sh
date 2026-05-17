#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# AdventShow — Build macOS
# ═══════════════════════════════════════════════════════════════════════════════
# Două moduri:
#   dev (default)  — DMG NESEMNAT, fără hardened runtime, fără notarizare.
#                    Folosit pentru iterație rapidă în dezvoltare. Funcționează
#                    pe Mac-ul acesta dar Gatekeeper îl va refuza pe alte Mac-uri.
#
#   release        — DMG semnat cu Developer ID + hardened runtime + timestamp.
#                    NU notarizează (notarizarea se face în scripts/release.sh).
#                    Necesită scripts/signing.env cu MACOS_SIGNING_IDENTITY.
#
# Usage:
#   ./scripts/build-mac.sh                # dev (default)
#   ./scripts/build-mac.sh release        # signed
#   BUILD_MODE=release ./scripts/build-mac.sh
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."

BUILD_MODE="${BUILD_MODE:-${1:-dev}}"
case "$BUILD_MODE" in
  dev|release) ;;
  *) echo "❌ BUILD_MODE invalid: $BUILD_MODE (dev|release)"; exit 1 ;;
esac

VERSION=$(node -p "require('./package.json').version")

echo "══════════════════════════════════════════════════════════════"
echo "  AdventShow Build macOS — mode: ${BUILD_MODE}  (v${VERSION})"
echo "══════════════════════════════════════════════════════════════"

if [ "$BUILD_MODE" = "release" ]; then
    if [ ! -f scripts/signing.env ]; then
        echo "❌ scripts/signing.env lipsă. Copiază scripts/signing.env.example."
        exit 1
    fi
    # shellcheck disable=SC1091
    source scripts/signing.env
    : "${MACOS_SIGNING_IDENTITY:?MACOS_SIGNING_IDENTITY missing in signing.env}"

    # Verifică că identitatea există în keychain
    security find-identity -v -p codesigning | grep -q "${MACOS_SIGNING_IDENTITY}" \
        || { echo "❌ Developer ID identity lipsă din keychain: ${MACOS_SIGNING_IDENTITY}"; exit 1; }

    echo "🔐 Semnez cu: ${MACOS_SIGNING_IDENTITY}"
    npm run build
    npx electron-builder --mac \
        --config.mac.identity="${MACOS_SIGNING_IDENTITY}"
else
    echo "⚠️  Mode dev — DMG NESEMNAT (doar pentru test local)"
    # CSC_IDENTITY_AUTO_DISCOVERY=false → electron-builder nu caută cert automat
    CSC_IDENTITY_AUTO_DISCOVERY=false npm run build
    CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac
fi

DMG="release/${VERSION}/AdventShow-Mac-${VERSION}.dmg"
[ -f "$DMG" ] || { echo "❌ DMG nu a fost produs: $DMG"; exit 1; }

SIZE=$(du -h "$DMG" | cut -f1)
echo ""
echo "✅ DMG: $DMG ($SIZE)"
[ "$BUILD_MODE" = "release" ] && echo "   Următorul pas: notarizare via scripts/release.sh"
