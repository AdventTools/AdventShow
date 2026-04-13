#!/usr/bin/env bash
# Upload all macOS release artifacts to a GitHub Release.
# Usage: ./scripts/release-mac.sh          (auto-detects version from package.json)
#        ./scripts/release-mac.sh v1.2.3   (explicit tag)

set -euo pipefail
cd "$(dirname "$0")/.."

TAG="${1:-v$(node -p "require('./package.json').version")}"
VERSION="${TAG#v}"
DIR="release/${VERSION}"

echo "📦 Uploading macOS artifacts for ${TAG}..."

FILES=(
  "${DIR}/AdventShow-Mac-${VERSION}-Installer.dmg"
  "${DIR}/AdventShow-Mac-${VERSION}-Installer.zip"
  "${DIR}/latest-mac.yml"
)

MISSING=0
for f in "${FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "❌ Missing: $f"
    MISSING=1
  fi
done
if [[ $MISSING -eq 1 ]]; then
  echo "Run 'npm run build:mac' first."
  exit 1
fi

gh release upload "$TAG" "${FILES[@]}" --clobber
echo "✅ All macOS artifacts uploaded to ${TAG}"
