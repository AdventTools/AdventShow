#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# AdventShow — Pipeline de release semnat (macOS + Windows + Linux)
# ═══════════════════════════════════════════════════════════════════════════════
# RULEAZĂ DOAR LA CERERE EXPLICITĂ a userului — face commit, tag, push și
# publică release public pe GitHub. Ireversibil.
#
# Pași:
#   1. Pre-flight (signing.env, keychain, notary, SSH la Windows VM, gh CLI)
#   2. Bump versiune (patch|minor|major) + actualizare README + CHANGELOG
#   3. Build macOS semnat → DMG
#   4. Submit DMG la Apple notary (în BACKGROUND, durează 5–15 min)
#   5. Build Windows semnat pe VM via SSH → Setup.exe (paralel cu notary)
#   6. Așteaptă notary → staple DMG → verificare semnătură
#   7. Git commit + tag + push
#   8. GitHub Release cu DMG + EXE (Linux AppImage urcă CI separat)
#
# Usage:
#   ./scripts/release.sh "descriere modificări" [patch|minor|major]
#   ./scripts/release.sh "fix critic Windows" patch
#
# Toate secretele se citesc din scripts/signing.env (gitignored).
# Template: scripts/signing.env.example
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."

# ── Args ──────────────────────────────────────────────────────────────────────

DESCRIPTION="${1:?Usage: ./scripts/release.sh \"description\" [patch|minor|major]}"
BUMP_TYPE="${2:-patch}"

case "$BUMP_TYPE" in
  patch|minor|major) ;;
  *) echo "❌ Bump invalid: $BUMP_TYPE (patch|minor|major)"; exit 1 ;;
esac

# ── Load secrets ──────────────────────────────────────────────────────────────

if [ ! -f scripts/signing.env ]; then
    echo "❌ scripts/signing.env lipsă. Copiază scripts/signing.env.example."
    exit 1
fi
# shellcheck disable=SC1091
source scripts/signing.env

: "${MACOS_SIGNING_IDENTITY:?MACOS_SIGNING_IDENTITY missing in signing.env}"
: "${APPLE_TEAM_ID:?APPLE_TEAM_ID missing}"
: "${NOTARY_PROFILE:?NOTARY_PROFILE missing}"
: "${WIN_HOST:?WIN_HOST missing}"
: "${WIN_SSH_PORT:?WIN_SSH_PORT missing}"
: "${WIN_REPO:?WIN_REPO missing}"

WIN_SSH_OPTS=(-o ProxyJump=jumper -o "Port=${WIN_SSH_PORT}")

# ── Helpers ───────────────────────────────────────────────────────────────────

step() { echo ""; echo "═══ $1 ═══"; }
ok()   { echo "   ✓ $1"; }
fail() { echo "   ✗ $1"; exit 1; }

# ── Pre-flight ────────────────────────────────────────────────────────────────

step "1/8 Pre-flight"

[ -z "$(git status --porcelain)" ] || fail "Working tree dirty — commit/stash înainte de release"
ok "Git curat"

command -v gh >/dev/null || fail "gh CLI lipsă (brew install gh)"
gh auth status >/dev/null 2>&1 || fail "gh nu e autentificat (gh auth login)"
ok "gh CLI OK"

security find-identity -v -p codesigning | grep -q "${MACOS_SIGNING_IDENTITY}" \
    || fail "Developer ID lipsă din keychain: ${MACOS_SIGNING_IDENTITY}"
ok "Keychain identity OK"

xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1 \
    || fail "Notary profile lipsă: $NOTARY_PROFILE"
ok "Notary profile OK"

ssh -o ConnectTimeout=10 "${WIN_SSH_OPTS[@]}" "$WIN_HOST" 'echo OK' >/dev/null 2>&1 \
    || fail "SSH la Windows VM ($WIN_HOST) a eșuat"
ok "SSH Windows VM OK"

# ── Version bump ──────────────────────────────────────────────────────────────

step "2/8 Bump versiune"

OLD_VERSION=$(node -p "require('./package.json').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$OLD_VERSION"

case "$BUMP_TYPE" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
TAG="v${NEW_VERSION}"
RELEASE_DIR="release/${NEW_VERSION}"
DATE=$(date +"%d %B %Y" | sed 's/January/Ianuarie/;s/February/Februarie/;s/March/Martie/;s/April/Aprilie/;s/May/Mai/;s/June/Iunie/;s/July/Iulie/;s/August/August/;s/September/Septembrie/;s/October/Octombrie/;s/November/Noiembrie/;s/December/Decembrie/')

echo "   ${OLD_VERSION} → ${NEW_VERSION}"

sed -i '' "s/\"version\": \"${OLD_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" package.json
sed -i '' "s/versiune-${OLD_VERSION}-green/versiune-${NEW_VERSION}-green/" README.md

# Actualizează linkurile de download din README (Windows + Linux: doar URL; Mac: și filename-ul)
sed -i '' "s|releases/download/v${OLD_VERSION}/AdventShow-Setup\.exe|releases/download/v${NEW_VERSION}/AdventShow-Setup.exe|g" README.md
sed -i '' "s|releases/download/v${OLD_VERSION}/AdventShow-Linux\.AppImage|releases/download/v${NEW_VERSION}/AdventShow-Linux.AppImage|g" README.md
sed -i '' "s|AdventShow-Mac-${OLD_VERSION}\.dmg|AdventShow-Mac-${NEW_VERSION}.dmg|g" README.md
sed -i '' "s|releases/download/v${OLD_VERSION}/AdventShow-Mac|releases/download/v${NEW_VERSION}/AdventShow-Mac|g" README.md

CHANGELOG_ENTRY="## v${NEW_VERSION} (${DATE})\n\n### Modificări\n- ${DESCRIPTION}\n\n---\n"
sed -i '' "s/^# Changelog — AdventShow$/# Changelog — AdventShow\n\n${CHANGELOG_ENTRY}/" CHANGELOG.md

ok "package.json + README (badge + 3 linkuri download) + CHANGELOG actualizate"

# ── Build macOS semnat ────────────────────────────────────────────────────────

step "3/8 Build macOS (signed)"

rm -rf "$RELEASE_DIR"
./scripts/build-mac.sh release

DMG="${RELEASE_DIR}/AdventShow-Mac-${NEW_VERSION}.dmg"
[ -f "$DMG" ] || fail "DMG nu există: $DMG"
ok "DMG: $DMG"

# ── Notary în background ──────────────────────────────────────────────────────

step "4/8 Submit DMG la Apple notary (background)"

NOTARY_LOG="/tmp/adventshow-notary-${NEW_VERSION}.log"
xcrun notarytool submit "$DMG" \
    --keychain-profile "$NOTARY_PROFILE" \
    --wait --output-format plist > "$NOTARY_LOG" 2>&1 &
NOTARY_PID=$!
ok "notarytool PID=$NOTARY_PID — log: $NOTARY_LOG"

# ── Build Windows semnat (în paralel cu notary) ───────────────────────────────

step "5/8 Build Windows (signed) — paralel cu notary"

# build-win.sh face tot: sync sursă, npm ci, build:win cu Azure TS, scp înapoi
./scripts/build-win.sh release

EXE="${RELEASE_DIR}/AdventShow-Setup.exe"
[ -f "$EXE" ] || fail "EXE nu există: $EXE"
ok "EXE: $EXE"

# ── Așteaptă notary + staple ──────────────────────────────────────────────────

step "6/8 Așteaptă notary + staple"

wait "$NOTARY_PID" || true

NOTARY_STATUS=$(/usr/libexec/PlistBuddy -c "Print :status" "$NOTARY_LOG" 2>/dev/null || echo "Unknown")
NOTARY_ID=$(/usr/libexec/PlistBuddy -c "Print :id" "$NOTARY_LOG" 2>/dev/null || echo "")

if [ "$NOTARY_STATUS" != "Accepted" ]; then
    echo "   --- notarytool log ---"
    cat "$NOTARY_LOG"
    [ -n "$NOTARY_ID" ] && xcrun notarytool log "$NOTARY_ID" --keychain-profile "$NOTARY_PROFILE" || true
    fail "Notarizare: $NOTARY_STATUS (așteptat: Accepted)"
fi
ok "Notarizare Accepted (id=$NOTARY_ID)"

xcrun stapler staple "$DMG" || fail "stapler staple"
xcrun stapler validate "$DMG" || fail "stapler validate"
ok "DMG stapled + verificat"

# ── Git commit + tag + push ───────────────────────────────────────────────────

step "7/8 Git commit + tag + push"

git add -A
git commit -m "release: v${NEW_VERSION} — ${DESCRIPTION}"
git tag "$TAG"
git push origin main
git push origin "$TAG"
ok "Tag $TAG push-uit"

# ── GitHub Release ────────────────────────────────────────────────────────────

step "8/8 GitHub Release ${TAG}"

NOTES=$(awk "/^## v${NEW_VERSION}/{f=1; next} f && /^---/{exit} f" CHANGELOG.md)

gh release create "$TAG" \
    --title "${TAG}" \
    --notes "${NOTES}" \
    "$DMG" \
    "$EXE"

ok "Release ${TAG} publicat"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  ✅ Release ${TAG} complete!"
echo "  macOS:  DMG semnat + notarizat + stapled"
echo "  Win:    Setup.exe semnat (Azure Trusted Signing)"
echo "  Linux:  AppImage urcă automat din GitHub Actions la push tag"
echo "══════════════════════════════════════════════════════════════"
echo ""
echo "  ⚠️  Verifică pe GitHub release-ul și ȘTERGE arhivele 'Source code'"
echo "     dacă apar (vezi to-do.md #1)."
