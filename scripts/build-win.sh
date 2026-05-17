#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# AdventShow — Build Windows (via SSH la VM Windows)
# ═══════════════════════════════════════════════════════════════════════════════
# Două moduri:
#   dev (default)  — EXE NESEMNAT (SKIP_WIN_SIGN=1). Pentru test rapid.
#                    SmartScreen îl va flag-a, dar funcționează.
#
#   release        — EXE semnat cu Azure Trusted Signing (SCIT TEHNOLOGY SRL).
#                    Necesită sesiune `az login` validă pe VM Windows.
#
# Ambele moduri:
#   - tar gzip al sursei locale (fără node_modules, dist, release, .git)
#   - scp pe VM Windows în WIN_REPO
#   - npm ci + electron-builder --win pe VM
#   - scp înapoi pe Mac în release/<version>/AdventShow-Setup.exe
#
# Usage:
#   ./scripts/build-win.sh                # dev (default, nesemnat)
#   ./scripts/build-win.sh release        # signed
#   BUILD_MODE=release ./scripts/build-win.sh
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."

BUILD_MODE="${BUILD_MODE:-${1:-dev}}"
case "$BUILD_MODE" in
  dev|release) ;;
  *) echo "❌ BUILD_MODE invalid: $BUILD_MODE (dev|release)"; exit 1 ;;
esac

if [ ! -f scripts/signing.env ]; then
    echo "❌ scripts/signing.env lipsă (avem nevoie de WIN_HOST/WIN_SSH_PORT/WIN_REPO)"
    echo "   Copiază scripts/signing.env.example → scripts/signing.env"
    exit 1
fi
# shellcheck disable=SC1091
source scripts/signing.env

: "${WIN_HOST:?WIN_HOST missing in signing.env}"
: "${WIN_SSH_PORT:?WIN_SSH_PORT missing}"
: "${WIN_REPO:?WIN_REPO missing}"

WIN_SSH_OPTS=(-o ProxyJump=jumper -o "Port=${WIN_SSH_PORT}")
WIN_PROJECT="${WIN_REPO}\\AdventShow"
VERSION=$(node -p "require('./package.json').version")

echo "══════════════════════════════════════════════════════════════"
echo "  AdventShow Build Windows — mode: ${BUILD_MODE}  (v${VERSION})"
echo "══════════════════════════════════════════════════════════════"

# Pre-flight SSH
ssh -o ConnectTimeout=10 "${WIN_SSH_OPTS[@]}" "$WIN_HOST" 'echo OK' >/dev/null 2>&1 \
    || { echo "❌ SSH la $WIN_HOST a eșuat"; exit 1; }
echo "   ✓ SSH OK"

# ── Sync sursă ────────────────────────────────────────────────────────────────

echo ""
echo "📦 Sync sursă pe VM..."
TAR="/tmp/_adventshow_src_${VERSION}.tar.gz"
COPYFILE_DISABLE=1 tar --exclude=node_modules --exclude=dist --exclude=dist-electron \
    --exclude=release --exclude=.git --exclude='._*' --exclude='*.log' \
    --exclude=analyze_pptx.mjs --exclude=pptx-example --exclude=tmp --exclude=.venv \
    -czf "$TAR" .

ssh "${WIN_SSH_OPTS[@]}" "$WIN_HOST" "if not exist ${WIN_REPO} mkdir ${WIN_REPO}" 2>/dev/null
ssh "${WIN_SSH_OPTS[@]}" "$WIN_HOST" "if not exist ${WIN_PROJECT} mkdir ${WIN_PROJECT}" 2>/dev/null

scp "${WIN_SSH_OPTS[@]}" -C "$TAR" "$WIN_HOST:${WIN_REPO//\\/\/}/_src.tar.gz" \
    || { echo "❌ scp sursa a eșuat"; exit 1; }
rm -f "$TAR"

ssh "${WIN_SSH_OPTS[@]}" "$WIN_HOST" \
    "cd ${WIN_PROJECT} && tar -xzf ${WIN_REPO}\\_src.tar.gz && del ${WIN_REPO}\\_src.tar.gz" \
    || { echo "❌ Extract pe Windows a eșuat"; exit 1; }
echo "   ✓ Sursa pe VM"

# ── Build ─────────────────────────────────────────────────────────────────────

echo ""
if [ "$BUILD_MODE" = "release" ]; then
    echo "🔐 Build SEMNAT (Azure Trusted Signing)..."
    BUILD_CMD="cd ${WIN_PROJECT} && npm ci && npm run build:win"
else
    echo "⚠️  Build NESEMNAT (SKIP_WIN_SIGN=1)..."
    BUILD_CMD="cd ${WIN_PROJECT} && set SKIP_WIN_SIGN=1 && npm ci && npm run build:win"
fi

ssh "${WIN_SSH_OPTS[@]}" "$WIN_HOST" "$BUILD_CMD" \
    || { echo "❌ Build pe Windows a eșuat"; exit 1; }

# ── Pull EXE înapoi ───────────────────────────────────────────────────────────

mkdir -p "release/${VERSION}"
EXE_REMOTE="${WIN_PROJECT}\\release\\${VERSION}\\AdventShow-Setup.exe"
EXE_LOCAL="release/${VERSION}/AdventShow-Setup.exe"

scp "${WIN_SSH_OPTS[@]}" -C "$WIN_HOST:$(echo "$EXE_REMOTE" | tr '\\' '/')" "$EXE_LOCAL" \
    || { echo "❌ scp Setup.exe înapoi a eșuat"; exit 1; }

SIZE_BYTES=$(stat -f%z "$EXE_LOCAL")
[ "$SIZE_BYTES" -gt 50000000 ] \
    || { echo "❌ EXE pare incomplet ($SIZE_BYTES bytes)"; exit 1; }

echo ""
echo "✅ EXE: $EXE_LOCAL ($(du -h "$EXE_LOCAL" | cut -f1))"
if [ "$BUILD_MODE" = "dev" ]; then
    echo "   ⚠️  EXE-ul e NESEMNAT — Windows SmartScreen va afișa avertisment."
fi
# Explicit exit 0: un `[ test ] && echo` în mod release returnează 1 (test fail, fără else)
# și omoară release.sh care e sub `set -e`. Bug fix după release v1.2.1.
exit 0
