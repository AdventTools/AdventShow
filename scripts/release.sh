#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# AdventShow — Unified Release Script
# ═══════════════════════════════════════════════════════════════════════════════
# One command to build, tag, push, and release.
#
# Usage:
#   ./scripts/release.sh "Fix auto-update macOS, simplify About"
#   ./scripts/release.sh "Add new feature" minor
#   ./scripts/release.sh "Breaking change" major
#
# What it does:
#   1. Bumps version (patch by default, or minor/major if specified)
#   2. Updates package.json, README.md badge, CHANGELOG.md
#   3. Builds the app (TypeScript + Vite + electron-builder for macOS)
#   4. Extracts app.asar and creates update-manifest.json for delta updates
#   5. Commits, tags, pushes to GitHub
#   6. Creates a GitHub Release
#   7. Uploads macOS artifacts + delta update files
#   8. GitHub Actions automatically builds Windows + Linux via CI
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."

# ── Args ──────────────────────────────────────────────────────────────────────

DESCRIPTION="${1:?Usage: ./scripts/release.sh \"description\" [patch|minor|major]}"
BUMP_TYPE="${2:-patch}"

if [[ "$BUMP_TYPE" != "patch" && "$BUMP_TYPE" != "minor" && "$BUMP_TYPE" != "major" ]]; then
  echo "❌ Invalid bump type: $BUMP_TYPE (must be patch, minor, or major)"
  exit 1
fi

# ── Version bump ──────────────────────────────────────────────────────────────

OLD_VERSION=$(node -p "require('./package.json').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$OLD_VERSION"

case "$BUMP_TYPE" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
TAG="v${NEW_VERSION}"
DATE=$(date +"%d %B %Y" | sed 's/January/Ianuarie/;s/February/Februarie/;s/March/Martie/;s/April/Aprilie/;s/May/Mai/;s/June/Iunie/;s/July/Iulie/;s/August/August/;s/September/Septembrie/;s/October/Octombrie/;s/November/Noiembrie/;s/December/Decembrie/')

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  AdventShow Release: ${OLD_VERSION} → ${NEW_VERSION} (${BUMP_TYPE})"
echo "══════════════════════════════════════════════════════════════"
echo ""

# ── Update version in files ───────────────────────────────────────────────────

echo "📝 Updating version in package.json, README.md, CHANGELOG.md..."

# package.json
sed -i '' "s/\"version\": \"${OLD_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" package.json

# README.md badge
sed -i '' "s/versiune-${OLD_VERSION}-green/versiune-${NEW_VERSION}-green/" README.md

# CHANGELOG.md — prepend new entry
CHANGELOG_ENTRY="## v${NEW_VERSION} (${DATE})\n\n### Modificări\n- ${DESCRIPTION}\n\n---\n"
sed -i '' "s/^# Changelog — AdventShow$/# Changelog — AdventShow\n\n${CHANGELOG_ENTRY}/" CHANGELOG.md

echo "   ✓ Version bumped to ${NEW_VERSION}"

# ── Build ─────────────────────────────────────────────────────────────────────

echo ""
echo "🔨 Building macOS (TypeScript + Vite + electron-builder)..."
npm run build:mac 2>&1 | tail -5

RELEASE_DIR="release/${NEW_VERSION}"
echo "   ✓ Build complete: ${RELEASE_DIR}/"

# ── Extract app.asar for delta updates ────────────────────────────────────────

echo ""
echo "📦 Extracting app.asar for delta updates..."

ASAR_SRC="${RELEASE_DIR}/mac-arm64/AdventShow.app/Contents/Resources/app.asar"
ASAR_DEST="${RELEASE_DIR}/app-update.asar"

if [[ ! -f "$ASAR_SRC" ]]; then
  echo "❌ app.asar not found at ${ASAR_SRC}"
  exit 1
fi

cp "$ASAR_SRC" "$ASAR_DEST"

ASAR_SHA256=$(shasum -a 256 "$ASAR_DEST" | cut -d' ' -f1)
ASAR_SIZE=$(stat -f%z "$ASAR_DEST" 2>/dev/null || stat --printf="%s" "$ASAR_DEST")
ELECTRON_VERSION=$(node -p "require('./node_modules/electron/package.json').version")

cat > "${RELEASE_DIR}/update-manifest.json" << EOF
{
  "version": "${NEW_VERSION}",
  "electronVersion": "${ELECTRON_VERSION}",
  "asarSha256": "${ASAR_SHA256}",
  "asarSize": ${ASAR_SIZE}
}
EOF

echo "   ✓ app-update.asar: $(du -h "$ASAR_DEST" | cut -f1) (sha256: ${ASAR_SHA256:0:16}…)"
echo "   ✓ update-manifest.json created"

# ── Git commit + tag + push ───────────────────────────────────────────────────

echo ""
echo "🚀 Committing and pushing..."

git add -A
git commit -m "release: v${NEW_VERSION} — ${DESCRIPTION}"
git tag "$TAG"
git push origin main
git push origin "$TAG"

echo "   ✓ Pushed to main + tag ${TAG}"

# ── Create GitHub Release ─────────────────────────────────────────────────────

echo ""
echo "📋 Creating GitHub Release ${TAG}..."

gh release create "$TAG" \
  --title "${TAG}" \
  --notes "### Modificări
- ${DESCRIPTION}

### Delta Update
Utilizatorii existenți vor descărca automat doar codul aplicației (~$(du -h "$ASAR_DEST" | cut -f1 | xargs)), nu întregul Electron."

# Exclude source code archives via API (PATCH by release ID, not by tag)
RELEASE_ID=$(gh api "repos/AdventTools/AdventShow/releases/tags/${TAG}" --jq '.id')
curl -s -X PATCH -H "Authorization: token $(gh auth token)" -H "Content-Type: application/json" \
  -d '{"exclude_source_code_archives":true}' \
  "https://api.github.com/repos/AdventTools/AdventShow/releases/${RELEASE_ID}" > /dev/null || true

echo "   ✓ Release created"

# ── Upload macOS + delta assets ───────────────────────────────────────────────

echo ""
echo "📤 Uploading macOS + delta assets..."

UPLOAD_FILES=(
  "${RELEASE_DIR}/AdventShow-Mac-${NEW_VERSION}.dmg"
)

MISSING=0
for f in "${UPLOAD_FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "   ❌ Missing: $f"
    MISSING=1
  fi
done

if [[ $MISSING -eq 1 ]]; then
  echo "❌ Some files are missing. Release created but assets incomplete."
  exit 1
fi

gh release upload "$TAG" "${UPLOAD_FILES[@]}" --clobber
echo "   ✓ Uploaded: DMG"

# Upload delta files to the hidden pre-release (delta-latest)
echo ""
echo "📤 Uploading delta files to delta-latest..."
gh release upload delta-latest \
  "${RELEASE_DIR}/app-update.asar" \
  "${RELEASE_DIR}/update-manifest.json" \
  --clobber
echo "   ✓ Uploaded delta: app-update.asar, update-manifest.json"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  ✅ Release ${TAG} complete!"
echo ""
echo "  macOS:   ✓ Uploaded (DMG + ZIP + delta)"
echo "  Win/Lin: ⏳ GitHub Actions will build automatically"
echo ""
echo "  Check CI: https://github.com/AdventTools/AdventShow/actions"
echo "  Release:  https://github.com/AdventTools/AdventShow/releases/tag/${TAG}"
echo "══════════════════════════════════════════════════════════════"
