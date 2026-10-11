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
#   MAC_ARCH=x64 ./scripts/build-mac.sh release   # Intel (implicit: arm64, Apple)
#
# O singură arhitectură pe rulare. node_modules ține un singur ffmpeg; pentru Intel
# îl punem pe al lui, construim, apoi îl punem la loc pe cel de Apple, ca
# `npm run dev` să meargă în continuare. better-sqlite3 are deja ambele arhitecturi.
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."

BUILD_MODE="${BUILD_MODE:-${1:-dev}}"
case "$BUILD_MODE" in
  dev|release) ;;
  *) echo "❌ BUILD_MODE invalid: $BUILD_MODE (dev|release)"; exit 1 ;;
esac

VERSION=$(node -p "require('./package.json').version")
MAC_ARCH="${MAC_ARCH:-arm64}"
case "$MAC_ARCH" in
  arm64|x64) ;;
  *) echo "❌ MAC_ARCH invalid: $MAC_ARCH (arm64|x64)"; exit 1 ;;
esac
HOST_ARCH=$(node -p "process.arch")
# electron-builder pune aplicația despachetată în mac-arm64/ pentru Apple și în mac/
# pentru Intel.
if [ "$MAC_ARCH" = "arm64" ]; then UNPACKED="mac-arm64"; else UNPACKED="mac"; fi

echo "══════════════════════════════════════════════════════════════"
echo "  AdventShow Build macOS — mode: ${BUILD_MODE}  (v${VERSION}, ${MAC_ARCH})"
echo "══════════════════════════════════════════════════════════════"

# ── ffmpeg pentru arhitectura cerută ──────────────────────────────────────────
#
# ffmpeg-static descarcă la instalare binarul mașinii pe care rulează npm, deci pe
# acest Mac doar pe cel de Apple. Pachetul de Intel cu ffmpeg de Apple n-ar putea
# converti nimic. Binarele stau în cache, în afara iCloud, ca să nu fie descărcate
# la fiecare build.
FFMPEG="node_modules/ffmpeg-static/ffmpeg"
FFMPEG_CACHE="$HOME/Library/Caches/AdventShowBuild-ffmpeg"
# lipo spune arhitecturii Intel x86_64, electron-builder și npm îi spun x64.
lipo_arch() { if [ "$1" = "x64" ]; then echo x86_64; else echo "$1"; fi; }
pune_ffmpeg() {
    local arch="$1" tinta="$FFMPEG_CACHE/$1/ffmpeg"
    if [ ! -x "$tinta" ]; then
        mkdir -p "$FFMPEG_CACHE/$arch"
        # install.js nu descarcă nimic dacă găsește deja un binar.
        mv "$FFMPEG" "$FFMPEG_CACHE/_host" 2>/dev/null || true
        npm_config_arch="$arch" node node_modules/ffmpeg-static/install.js
        [ "$(lipo -archs "$FFMPEG")" = "$(lipo_arch "$arch")" ] || { echo "❌ ffmpeg descărcat nu e pentru $arch"; exit 1; }
        mv "$FFMPEG" "$tinta"
        [ -f "$FFMPEG_CACHE/_host" ] && mv "$FFMPEG_CACHE/_host" "$FFMPEG"
    fi
    cp "$tinta" "$FFMPEG"
    chmod 755 "$FFMPEG"
    [ "$(lipo -archs "$FFMPEG")" = "$(lipo_arch "$arch")" ] || { echo "❌ ffmpeg nu e pentru $arch: $(lipo -archs "$FFMPEG")"; exit 1; }
}

if [ "$MAC_ARCH" != "$HOST_ARCH" ]; then
    # Orice ar fi, la ieșire node_modules revine la mașina asta.
    trap 'echo "↩︎  ffmpeg înapoi pe ${HOST_ARCH}"; pune_ffmpeg "$HOST_ARCH"' EXIT
fi
pune_ffmpeg "$MAC_ARCH"
echo "🎬 ffmpeg: $(lipo -archs "$FFMPEG")"

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
    # Clean intermediate state — stale builds cu identity diferit pot duce la framework-uri
    # parțial semnate care fac notarizarea Apple să eșueze (vezi electron-builder.json5).
    rm -rf dist dist-electron "release/${VERSION}/${UNPACKED}" 2>/dev/null || true
    # CSC_NAME e calea standard prin care electron-builder primește identitatea pt. signing
    # complet (main exe + helpers + frameworks). Comparativ cu --config.mac.identity=...
    # CLI override, CSC_NAME prinde toate sub-componentele.
    export CSC_NAME="${MACOS_SIGNING_IDENTITY}"
    npm run build
    npx electron-builder --mac "--${MAC_ARCH}"
else
    echo "⚠️  Mode dev — DMG NESEMNAT (doar pentru test local)"
    # CSC_IDENTITY_AUTO_DISCOVERY=false → electron-builder nu caută cert automat
    CSC_IDENTITY_AUTO_DISCOVERY=false npm run build
    CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac "--${MAC_ARCH}"
fi

DMG="release/${VERSION}/AdventShow-Mac-${VERSION}-${MAC_ARCH}.dmg"
[ -f "$DMG" ] || { echo "❌ DMG nu a fost produs: $DMG"; exit 1; }

for old in release/*/; do
    old="${old%/}"
    [ "$old" = "release/${VERSION}" ] || rm -rf -- "$old"
done

SIZE=$(du -h "$DMG" | cut -f1)
echo ""
echo "✅ DMG: $DMG ($SIZE)"
if [ "$BUILD_MODE" = "release" ]; then echo "   Următorul pas: notarizare via scripts/release.sh"; fi
