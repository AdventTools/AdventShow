#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# AdventShow — Pipeline de release semnat (macOS + Windows + Linux)
# ═══════════════════════════════════════════════════════════════════════════════
# RULEAZĂ DOAR LA CERERE EXPLICITĂ a userului — face commit, push și publică
# release public pe GitHub. Ireversibil.
#
# Durificat după release-urile v1.3.0/v1.3.1 (vezi docs/RELEASE-PROCEDURE.md):
#   • REZILIENT la rețea instabilă: fiecare pas are marker de stare (reluabil cu
#     aceeași comandă), orice operație de rețea are retry generos
#   • codesign trece prin scripts/codesign-retry/ (timestamp server cu retry)
#   • notarizare: submit --no-wait + polling prin FIȘIER (PlistBuddy nu citește pipe)
#   • build Windows DETAȘAT pe VM prin Task Scheduler (supraviețuiește căderii SSH);
#     scriptul .cmd se generează local și se urcă cu scp (echo prin ssh se pierde)
#   • asset-urile se copiază în /tmp înainte de upload (iCloud evacuează fișierele
#     mari din ~/Documents fix în timpul upload-ului — v1.3.0 EXE, v1.3.1 ZIP)
#   • GitHub Release ATOMIC: draft → upload TOT → verificare nume+mărime exactă →
#     publicare. Tag-ul se creează DOAR la publicare, deci utilizatorii nu văd
#     niciodată un release incomplet (la v1.3.1 au prins 404 pe zip mid-upload)
#   • asset obligatoriu lipsă = STOP, nu release parțial
#
# Pași:
#   1. Pre-flight   2. Bump versiune + README + CHANGELOG   3. Build macOS semnat
#   4. Notary submit   5. Sync sursă VM   6. Build Windows detașat   7. Pull EXE
#   8. Notary poll + staple   9. Git push main   10. Release draft→verify→publish
#   11. CI Linux (AppImage) cu fallback workflow_dispatch
#
# Usage:
#   ./scripts/release.sh "descriere modificări" [patch|minor|major]
#   REGULĂ VERSIUNI: patch implicit; minor DOAR la schimbări de schemă DB;
#   major doar la cerere explicită. Nu se decide altfel, nu se întreabă.
#
# Reluare după eșec: rulează EXACT aceeași comandă — pașii terminați se sar
# (stare în scripts/.release-state/<versiune>/).
#
# Toate secretele se citesc din scripts/signing.env (gitignored).
# ═══════════════════════════════════════════════════════════════════════════════

set -uo pipefail
cd "$(dirname "$0")/.."

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

WIN_SSH_OPTS=(-o ProxyJump=jumper -o "Port=${WIN_SSH_PORT}" -o ConnectTimeout=12 -o ServerAliveInterval=10 -o ServerAliveCountMax=2)
WIN_PROJECT="${WIN_REPO}\\AdventShow"

# ── Helpers ───────────────────────────────────────────────────────────────────

log()  { echo "[$(date +%H:%M:%S)] $*"; }
step() { echo ""; echo "═══ $1 ═══"; }
fail() { echo "   ✗ $1"; exit 1; }
ok()   { echo "   ✓ $1"; }

# retry <nume> <max> <pauză> -- cmd...
retry() {
  local name="$1" max="$2" pause="$3"; shift 3; [ "$1" = "--" ] && shift
  local n=0
  until "$@"; do
    n=$((n+1))
    if [ "$n" -ge "$max" ]; then log "✗ ${name}: eșuat după ${max} încercări"; return 1; fi
    log "  …${name}: încercarea ${n}/${max} a eșuat, reîncerc în ${pause}s"
    sleep "$pause"
  done
}

# ── Pre-flight ────────────────────────────────────────────────────────────────

step "1/11 Pre-flight"

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

# release/ trebuie să fie ÎN AFARA iCloud (symlink spre ~/Library/Caches) — altfel
# iCloud evacuează DMG/ZIP/EXE între build și upload (pățit la v1.3.0 și v1.3.1).
if [ ! -L release ]; then
    fail "release/ nu e symlink în afara iCloud. Rulează: mkdir -p ~/Library/Caches/AdventShowBuild && rm -rf release && ln -s ~/Library/Caches/AdventShowBuild release"
fi
ok "release/ e în afara iCloud ($(readlink release))"

# ── Stare reluabilă, cheiată pe versiunea release-ului ────────────────────────

OLD_VERSION=$(node -p "require('./package.json').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$OLD_VERSION"
case "$BUMP_TYPE" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac
CANDIDATE_VERSION="${MAJOR}.${MINOR}.${PATCH}"

STATE_ROOT="scripts/.release-state"
mkdir -p "$STATE_ROOT"
# reluare: dacă package.json e DEJA la o versiune cu release început, continuăm acela
if [ -f "$STATE_ROOT/${OLD_VERSION}/bump.done" ]; then
    NEW_VERSION="$OLD_VERSION"
else
    NEW_VERSION="$CANDIDATE_VERSION"
fi
STATE="$STATE_ROOT/${NEW_VERSION}"
mkdir -p "$STATE"

TAG="v${NEW_VERSION}"
RELEASE_DIR="release/${NEW_VERSION}"
DMG="${RELEASE_DIR}/AdventShow-Mac-${NEW_VERSION}.dmg"
ZIP="${RELEASE_DIR}/AdventShow-Mac-${NEW_VERSION}.zip"
EXE="${RELEASE_DIR}/AdventShow-Setup.exe"

# working tree curat — doar la început de release nou (la reluare e deja bumped)
if [ ! -f "$STATE/bump.done" ]; then
    [ -z "$(git status --porcelain)" ] || fail "Working tree dirty — comite featurile înainte de release"
    ok "Git curat"
fi

# ── Bump versiune ─────────────────────────────────────────────────────────────

if [ ! -f "$STATE/bump.done" ]; then
  step "2/11 Bump versiune"
  DATE=$(date +"%d %B %Y" | sed 's/January/Ianuarie/;s/February/Februarie/;s/March/Martie/;s/April/Aprilie/;s/May/Mai/;s/June/Iunie/;s/July/Iulie/;s/August/August/;s/September/Septembrie/;s/October/Octombrie/;s/November/Noiembrie/;s/December/Decembrie/')
  echo "   ${OLD_VERSION} → ${NEW_VERSION}"
  sed -i '' "s/\"version\": \"${OLD_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" package.json
  sed -i '' "s/versiune-${OLD_VERSION}-green/versiune-${NEW_VERSION}-green/" README.md
  sed -i '' "s|releases/download/v${OLD_VERSION}/AdventShow-Setup\.exe|releases/download/v${NEW_VERSION}/AdventShow-Setup.exe|g" README.md
  sed -i '' "s|releases/download/v${OLD_VERSION}/AdventShow-Linux\.AppImage|releases/download/v${NEW_VERSION}/AdventShow-Linux.AppImage|g" README.md
  sed -i '' "s|AdventShow-Mac-${OLD_VERSION}\.dmg|AdventShow-Mac-${NEW_VERSION}.dmg|g" README.md
  sed -i '' "s|releases/download/v${OLD_VERSION}/AdventShow-Mac|releases/download/v${NEW_VERSION}/AdventShow-Mac|g" README.md
  # CHANGELOG prin Node (nu sed) — descrierea e text liber; slash/ampersand au
  # crăpat release-ul 1.2.5 pe varianta sed
  CL_VERSION="$NEW_VERSION" CL_DATE="$DATE" CL_DESC="$DESCRIPTION" node -e '
    const fs = require("fs");
    const f = "CHANGELOG.md";
    const title = "# Changelog — AdventShow";
    const entry = `## v${process.env.CL_VERSION} (${process.env.CL_DATE})\n\n### Modificări\n- ${process.env.CL_DESC}\n\n---\n`;
    let s = fs.readFileSync(f, "utf8");
    const i = s.indexOf(title);
    if (i === -1) { console.error("CHANGELOG title not found"); process.exit(1); }
    const after = i + title.length;
    s = s.slice(0, after) + "\n\n" + entry + s.slice(after).replace(/^\n+/, "\n");
    fs.writeFileSync(f, s);
  ' || fail "Actualizarea CHANGELOG a eșuat"
  echo "$NEW_VERSION" > "$STATE/bump.done"
  ok "package.json + README + CHANGELOG actualizate"
fi
log "Versiune release: $NEW_VERSION"

# ── Build macOS semnat ────────────────────────────────────────────────────────

if [ ! -f "$STATE/mac.done" ]; then
  step "3/11 Build macOS (signed)"
  # codesign cu retry — fiecare semnătură cere serverul de timestamp Apple;
  # o singură cerere picată omora tot build-ul pe rețea instabilă
  export PATH="$PWD/scripts/codesign-retry:$PATH"
  built=""
  for attempt in 1 2 3 4; do
    log "build mac — încercarea $attempt"
    rm -rf "$RELEASE_DIR"
    if ./scripts/build-mac.sh release; then built=1; break; fi
    log "  …build mac eșuat, reîncerc în 30s"; sleep 30
  done
  [ -n "$built" ] || fail "build mac eșuat de 4 ori"
  [ -f "$DMG" ] || fail "DMG nu există: $DMG"
  [ -f "$ZIP" ] || fail "ZIP mac nu există: $ZIP (necesar pentru auto-update)"
  [ -f "${RELEASE_DIR}/latest-mac.yml" ] || fail "latest-mac.yml lipsă (necesar pentru auto-update macOS)"
  touch "$STATE/mac.done"
  ok "DMG + ZIP + latest-mac.yml"
fi

# ── Notary submit (doar upload; polling la pasul 8) ───────────────────────────

if [ ! -f "$STATE/notary-id.done" ]; then
  step "4/11 Notary submit (--no-wait)"
  submit_notary() {
    xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" \
      --no-wait --output-format plist > /tmp/adventshow-notary-submit.plist 2>/tmp/adventshow-notary-submit.err
  }
  retry "notary submit (upload DMG)" 40 20 -- submit_notary || fail "notary submit"
  /usr/libexec/PlistBuddy -c "Print :id" /tmp/adventshow-notary-submit.plist > "$STATE/notary-id.done" \
    || fail "nu pot citi submission id"
  ok "submission id: $(cat "$STATE/notary-id.done")"
fi
NOTARY_ID=$(cat "$STATE/notary-id.done")

# ── Sync sursă pe VM Windows ──────────────────────────────────────────────────

if [ ! -f "$STATE/winsync.done" ]; then
  step "5/11 Sync sursă pe VM Windows"
  TAR="/tmp/_adventshow_src_${NEW_VERSION}.tar.gz"
  COPYFILE_DISABLE=1 tar --exclude=node_modules --exclude=dist --exclude=dist-electron \
      --exclude=release --exclude=.git --exclude='._*' --exclude='*.log' \
      --exclude=analyze_pptx.mjs --exclude=pptx-example --exclude=tmp --exclude=.venv \
      --exclude=scripts/.release-state \
      -czf "$TAR" .
  log "tar: $(du -h "$TAR" | cut -f1)"
  retry "ssh mkdir" 40 15 -- ssh "${WIN_SSH_OPTS[@]}" "$WIN_HOST" "if not exist ${WIN_REPO} mkdir ${WIN_REPO}" 2>/dev/null || true
  retry "ssh mkdir proj" 40 15 -- ssh "${WIN_SSH_OPTS[@]}" "$WIN_HOST" "if not exist ${WIN_PROJECT} mkdir ${WIN_PROJECT}" 2>/dev/null || true
  retry "scp sursă pe VM" 40 20 -- scp "${WIN_SSH_OPTS[@]}" -C "$TAR" "$WIN_HOST:${WIN_REPO//\\/\/}/_src.tar.gz" || fail "scp sursă"
  retry "extract pe VM" 40 15 -- ssh "${WIN_SSH_OPTS[@]}" "$WIN_HOST" "cd ${WIN_PROJECT} && tar -xzf ${WIN_REPO}\\_src.tar.gz && del ${WIN_REPO}\\_src.tar.gz" || fail "extract pe VM"
  rm -f "$TAR"
  touch "$STATE/winsync.done"
  ok "sursa pe VM"
fi

# ── Build Windows DETAȘAT (Task Scheduler — supraviețuiește căderii SSH) ──────

if [ ! -f "$STATE/winbuild.done" ]; then
  step "6/11 Build Windows detașat"
  if [ ! -f "$STATE/winbuild.started" ]; then
    BAT="${WIN_REPO}\\_build_v${NEW_VERSION}.cmd"
    BAT_LOCAL="/tmp/_build_v${NEW_VERSION}.cmd"
    WIN_REPO_ENV="$WIN_REPO" WIN_PROJECT_ENV="$WIN_PROJECT" BAT_LOCAL_ENV="$BAT_LOCAL" python3 -c "
import os
repo = os.environ['WIN_REPO_ENV']; proj = os.environ['WIN_PROJECT_ENV']
lines = [
    '@echo off',
    'cd /d ' + proj,
    'del /q ' + repo + r'\_build.done 2>nul',
    'call npm ci > ' + repo + r'\_build.log 2>&1 || goto :fail',
    'call npm run build:win >> ' + repo + r'\_build.log 2>&1 || goto :fail',
    'echo ok>' + repo + r'\_build.done',
    'exit /b 0',
    ':fail',
    'echo fail>' + repo + r'\_build.done',
    'exit /b 1',
]
open(os.environ['BAT_LOCAL_ENV'],'w',newline='').write('\r\n'.join(lines) + '\r\n')
" || fail "generare script build"
    retry "scp script build pe VM" 40 15 -- scp "${WIN_SSH_OPTS[@]}" "$BAT_LOCAL" "$WIN_HOST:${WIN_REPO//\\//}/_build_v${NEW_VERSION}.cmd" || fail "scp script build"
    retry "ștergere marker vechi" 10 10 -- ssh "${WIN_SSH_OPTS[@]}" "$WIN_HOST" "del /q ${WIN_REPO}\\_build.done 2>nul & exit /b 0" || true
    schedule_build() {
      ssh "${WIN_SSH_OPTS[@]}" "$WIN_HOST" "schtasks /create /tn AdventShowRelease /tr \"${BAT}\" /sc once /st 23:59 /f && schtasks /run /tn AdventShowRelease"
    }
    retry "pornire build detașat" 40 15 -- schedule_build || fail "pornire build"
    touch "$STATE/winbuild.started"
    ok "build pornit detașat pe VM"
  fi
  log "aștept build-ul Windows (polling la 30s)…"
  while true; do
    STATUS=$(ssh "${WIN_SSH_OPTS[@]}" "$WIN_HOST" "type ${WIN_REPO}\\_build.done 2>nul" 2>/dev/null | tr -d '\r\n ' || true)
    if [ "$STATUS" = "ok" ]; then ok "build Windows terminat"; break; fi
    if [ "$STATUS" = "fail" ]; then
      log "✗ build Windows EȘUAT — ultimele linii din log:"
      ssh "${WIN_SSH_OPTS[@]}" "$WIN_HOST" "powershell -Command \"Get-Content '${WIN_REPO}\\_build.log' -Tail 30\"" 2>/dev/null || true
      fail "build Windows"
    fi
    sleep 30
  done
  ssh "${WIN_SSH_OPTS[@]}" "$WIN_HOST" "schtasks /delete /tn AdventShowRelease /f" >/dev/null 2>&1 || true
  touch "$STATE/winbuild.done"
fi

# ── Pull artefacte Windows ────────────────────────────────────────────────────

if [ ! -f "$STATE/winpull.done" ]; then
  step "7/11 Pull EXE + latest.yml"
  REMOTE_DIR_FWD="$(echo "${WIN_PROJECT}\\release\\${NEW_VERSION}" | tr '\\' '/')"
  mkdir -p "$RELEASE_DIR"
  retry "scp Setup.exe" 40 20 -- scp "${WIN_SSH_OPTS[@]}" -C "$WIN_HOST:${REMOTE_DIR_FWD}/AdventShow-Setup.exe" "$EXE" || fail "scp Setup.exe"
  retry "scp latest.yml" 40 15 -- scp "${WIN_SSH_OPTS[@]}" -C "$WIN_HOST:${REMOTE_DIR_FWD}/latest.yml" "${RELEASE_DIR}/latest.yml" || fail "scp latest.yml (necesar pentru auto-update Windows)"
  scp "${WIN_SSH_OPTS[@]}" -C "$WIN_HOST:${REMOTE_DIR_FWD}/AdventShow-Setup.exe.blockmap" "${RELEASE_DIR}/AdventShow-Setup.exe.blockmap" 2>/dev/null \
    || log "  (blockmap exe lipsă — non-critic)"
  SIZE_BYTES=$(stat -f%z "$EXE")
  [ "$SIZE_BYTES" -gt 50000000 ] || { rm -f "$EXE"; fail "EXE pare incomplet ($SIZE_BYTES bytes)"; }
  touch "$STATE/winpull.done"
  ok "EXE ($(du -h "$EXE" | cut -f1)) + latest.yml"
fi

# ── Notary poll + staple ──────────────────────────────────────────────────────

if [ ! -f "$STATE/staple.done" ]; then
  step "8/11 Notary status + staple"
  while true; do
    # PlistBuddy nu poate citi din pipe (cere fișier seekable) → fișier temporar
    xcrun notarytool info "$NOTARY_ID" --keychain-profile "$NOTARY_PROFILE" --output-format plist \
      > /tmp/adventshow-notary-info.plist 2>/dev/null
    NSTATUS=$(/usr/libexec/PlistBuddy -c "Print :status" /tmp/adventshow-notary-info.plist 2>/dev/null || echo "NetworkDown")
    log "  notary: $NSTATUS"
    case "$NSTATUS" in
      Accepted) break ;;
      Invalid|Rejected)
        xcrun notarytool log "$NOTARY_ID" --keychain-profile "$NOTARY_PROFILE" || true
        fail "notarizare: $NSTATUS" ;;
      *) sleep 30 ;;
    esac
  done
  retry "stapler staple" 40 15 -- xcrun stapler staple "$DMG" || fail "stapler staple"
  xcrun stapler validate "$DMG" || fail "stapler validate"
  touch "$STATE/staple.done"
  ok "DMG notarizat + stapled"
fi

# ── Git commit + push main (FĂRĂ tag — tag-ul îl creează publicarea) ──────────

if [ ! -f "$STATE/git.done" ]; then
  step "9/11 Git commit + push main"
  git add -A
  git commit -m "release: v${NEW_VERSION} — ${DESCRIPTION}" || true
  retry "git push main" 40 20 -- git push origin main || fail "git push"
  touch "$STATE/git.done"
  ok "main push-uit"
fi

# ── GitHub Release: DRAFT → upload TOT → verificare → publicare ───────────────

if [ ! -f "$STATE/gh.done" ]; then
  step "10/11 GitHub Release (draft → upload → verify → publish)"

  STAGING="/tmp/ashow-assets-${NEW_VERSION}"
  mkdir -p "$STAGING"
  REQUIRED=("$DMG" "$ZIP" "$EXE" "${RELEASE_DIR}/latest.yml" "${RELEASE_DIR}/latest-mac.yml")
  OPTIONAL=("${RELEASE_DIR}/AdventShow-Mac-${NEW_VERSION}.zip.blockmap"
            "${RELEASE_DIR}/AdventShow-Mac-${NEW_VERSION}.dmg.blockmap"
            "${RELEASE_DIR}/AdventShow-Setup.exe.blockmap")
  UPDATE_ASSETS=()
  for f in "${REQUIRED[@]}"; do
    [ -f "$f" ] || fail "ASSET OBLIGATORIU LIPSĂ: $f — nu public un release incomplet"
    cp "$f" "$STAGING/" || fail "staging a eșuat pentru $f"
    UPDATE_ASSETS+=("$STAGING/$(basename "$f")")
  done
  for f in "${OPTIONAL[@]}"; do
    [ -f "$f" ] && cp "$f" "$STAGING/" && UPDATE_ASSETS+=("$STAGING/$(basename "$f")")
  done
  ok "staged ${#UPDATE_ASSETS[@]} asset-uri (toate cele obligatorii prezente)"

  NOTES=$(awk "/^## v${NEW_VERSION}/{f=1; next} f && /^---/{exit} f" CHANGELOG.md)
  create_draft() {
    gh release view "$TAG" >/dev/null 2>&1 && return 0
    gh release create "$TAG" --draft --target main --title "${TAG}" --notes "${NOTES}"
  }
  retry "gh release create (draft)" 40 20 -- create_draft || fail "gh release create"

  upload_assets() { gh release upload "$TAG" "${UPDATE_ASSETS[@]}" --clobber; }
  retry "upload asset-uri" 60 20 -- upload_assets || fail "upload asset-uri"

  verify_assets() {
    local listing
    listing=$(gh release view "$TAG" --json assets --jq '.assets[] | .name + " " + (.size|tostring)') || return 1
    for f in "${REQUIRED[@]}"; do
      local name size
      name=$(basename "$f")
      size=$(stat -f%z "$STAGING/$name")
      echo "$listing" | grep -qx "$name $size" || { log "  …lipsește/mărime greșită: $name ($size)"; return 1; }
    done
  }
  retry "verificare asset-uri" 20 15 -- verify_assets || fail "verificare asset-uri (nume + mărime)"
  ok "toate asset-urile verificate (nume + mărime exactă)"

  publish_release() { gh release edit "$TAG" --draft=false; }
  retry "publicare release" 40 15 -- publish_release || fail "publicare"
  retry "fetch tags" 10 10 -- git fetch origin --tags || true
  touch "$STATE/gh.done"
  ok "release PUBLICAT complet (tag-ul ${TAG} creat de publicare)"
fi

# ── CI Linux (AppImage) ───────────────────────────────────────────────────────

if [ ! -f "$STATE/ci.done" ]; then
  step "11/11 CI Linux (AppImage)"
  sleep 30
  if ! gh run list --workflow=build.yml --json headBranch --jq '.[].headBranch' 2>/dev/null | grep -qx "$TAG"; then
    log "CI nu a pornit de la tag — declanșez manual (workflow_dispatch)"
    retry "workflow_dispatch" 20 15 -- gh workflow run build.yml --ref "$TAG" || true
  fi
  touch "$STATE/ci.done"
  ok "CI pornit pentru ${TAG}"
fi

step "GATA — v${NEW_VERSION} publicat"
gh release view "$TAG" --json assets --jq '.assets[].name' 2>/dev/null || true
echo ""
echo "  Verifică: https://github.com/AdventTools/AdventShow/releases/tag/${TAG}"
echo "  (inclusiv că nu apar arhive 'Source code' — vezi to-do.md #1)"
