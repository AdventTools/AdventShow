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
#   • asset obligatoriu lipsă = STOP, nu release parțial
#
# DIN v1.4.0 DISTRIBUȚIA E ÎN HANGAR (hangar.it4all.ro), nu pe GitHub Releases:
#   • artefactele se urcă prin API-ul hub-ului (uploader reluabil, pe bucăți) și
#     ajung în STAGING — nevăzute de nimeni până când OMUL le promovează din
#     interfață. Scriptul NU promovează; token-ul nici n-are dreptul.
#   • GitHub primește doar tag-ul și notele de versiune, fără binare.
#   • feed-urile (latest.yml, latest-mac.yml) NU se urcă: hangar le generează din
#     baza lui de date la fiecare promovare.
#   • AppImage-ul de Linux îl urcă direct CI-ul, cu secretul HANGAR_TOKEN.
#
# Pași:
#   1. Pre-flight   2. Bump versiune + README + CHANGELOG   3. Build macOS semnat
#   4. Notary submit   5. Sync sursă VM   6. Build Windows detașat   7. Pull EXE
#   8. Notary poll + staple   9. Git push main   10. Upload în hangar + verificare
#   11. Tag + note pe GitHub (declanșează CI-ul de Linux)
#   La final: oglinda corecturilor din hangar pe GitHub, pentru instalările de sub 1.4.0
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

# ── Câți mai atârnă de puntea GitHub ──────────────────────────────────────────
#
# Instalările de sub 1.4.0 nu știu de hangar: ele întreabă GitHub dacă e ceva nou,
# și fac asta descărcând `latest.yml` din release-ul marcat „latest". Contorul ăla
# e singurul semn de viață pe care îl avem de la ele — în hangar nu apar deloc.
#
# electron-updater se uită DOAR la ultimul release: dacă publicăm unul fără
# `latest.yml`, ele nu se întorc la cel precedent, ci rămân blocate pentru
# totdeauna. Deci puntea (GITHUB_BRIDGE=1) se stinge abia când numărul de mai jos
# rămâne 0 pe un release întreg. Atunci, și doar atunci, pui GITHUB_BRIDGE=0.
PUNTE_HITS=$(gh api "repos/AdventTools/AdventShow/releases/latest" \
  --jq '[.assets[] | select(.name == "latest.yml" or .name == "latest-mac.yml") | .download_count] | add // 0' 2>/dev/null || echo "?")
log "Punte GitHub: ${PUNTE_HITS} verificări de actualizare venite de la instalări sub 1.4.0 (0 = puntea poate fi oprită)"

security find-identity -v -p codesigning | grep -q "${MACOS_SIGNING_IDENTITY}" \
    || fail "Developer ID lipsă din keychain: ${MACOS_SIGNING_IDENTITY}"
ok "Keychain identity OK"

# Autentificarea la notarizare: profilul din keychain dacă se poate CITI, altfel
# credențialele directe din signing.env.
#
# Profilul e mai curat (parola nu ajunge în linia de comandă), dar keychain-ul îl
# poate face inaccesibil oricând: itemul stă în „Local Items", iar accesul cere o
# aprobare care nu vine când nimeni nu e la ecran. La 1.5.2 asta a costat patru
# submisii trimise degeaba — notarytool nu-l mai găsea, iar scriptul reîncerca.
# Un release nu are voie să depindă de starea de spirit a keychain-ului.
if xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
    NOTARY_AUTH=(--keychain-profile "$NOTARY_PROFILE")
    ok "Notary: profil din keychain ($NOTARY_PROFILE)"
else
    : "${APPLE_ID:?APPLE_ID lipsă din signing.env — profilul de keychain nu e citibil}"
    : "${APPLE_TEAM_ID:?APPLE_TEAM_ID lipsă din signing.env}"
    : "${APPLE_APP_SPECIFIC_PASSWORD:?APPLE_APP_SPECIFIC_PASSWORD lipsă din signing.env}"
    NOTARY_AUTH=(--apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID"
                 --password "$APPLE_APP_SPECIFIC_PASSWORD")
    xcrun notarytool history "${NOTARY_AUTH[@]}" >/dev/null 2>&1 \
        || fail "Nici profilul de keychain, nici credențialele din signing.env nu merg"
    ok "Notary: credențiale din signing.env (profilul de keychain nu e citibil)"
fi

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
# reluare: DOAR dacă package.json e la o versiune cu release început și NETERMINAT.
# Marcajul de „terminat" e cel scris de ULTIMUL pas — `gh.done`. (A fost `ci.done`
# până când pașii 10-11 au devenit „upload în hangar" + „tag pe GitHub"; condiția
# rămăsese pe numele vechi, deci orice release nou reintra în cel precedent.)
if [ -f "$STATE_ROOT/${OLD_VERSION}/bump.done" ] && [ ! -f "$STATE_ROOT/${OLD_VERSION}/gh.done" ]; then
    NEW_VERSION="$OLD_VERSION"
else
    NEW_VERSION="$CANDIDATE_VERSION"
fi
STATE="$STATE_ROOT/${NEW_VERSION}"
mkdir -p "$STATE"

# ── Amprenta codului din care s-a construit fiecare pas ───────────────────────
#
# Un marker gol spune doar „pasul ăsta e făcut", nu și DIN CE cod. Atâta timp cât
# reluarea vine la zece minute după o cădere de rețea, e exact ce trebuie. Dar la
# 1.5.2 starea a stat o lună: codul a mers mai departe, iar o reluare ar fi urcat
# binarele vechi sub un tag care arată spre codul nou — bisericile ar fi primit o
# versiune fără reparațiile din ea, iar noi n-am fi avut de unde afla.
#
# Deci fiecare pas care produce un binar își notează amprenta fișierelor care intră
# în build. La reluare, dacă amprenta diferă, markerul se aruncă și pasul se reface.
# Reluarea după o cădere de rețea rămâne gratuită (amprentă identică), reluarea
# peste cod nou reconstruiește. Markerele vechi, fără amprentă, sunt tratate ca
# nesigure — se reface pasul.
#
# Amprenta se ia din FIȘIERELE DE PE DISC, nu din commit, din două motive: bump-ul
# și pasul 9 (commit + push) schimbă HEAD fără să schimbe conținutul build-ului,
# iar o editare NECOMISĂ în arbore trebuie să invalideze build-ul — tarball-ul
# pentru VM-ul de Windows se face din arbore, nu din git (pățit la v1.3.2).
FP_PATHS=(electron src public templates build index.html vite.config.ts
          tsconfig.json tsconfig.node.json electron-builder.json5
          package.json package-lock.json
          scripts/afterPack.cjs scripts/sign-windows.cjs scripts/cornilescu.json)

source_fingerprint() {
  git ls-files -z -- "${FP_PATHS[@]}" | xargs -0 shasum -a 256 | shasum -a 256 | cut -d' ' -f1
}

FP=$(source_fingerprint)
[ ${#FP} -eq 64 ] || fail "nu pot calcula amprenta codului (am primit: '${FP}')"

# stamp_done: pașii care își scriu singuri conținutul în marker (ex. notary-id)
stamp_done() { printf '%s\n' "$FP" > "$STATE/$1.fp"; git rev-parse HEAD > "$STATE/$1.commit"; }
mark_done()  { : > "$STATE/$1.done"; stamp_done "$1"; }

# step_done <pas> — 0 doar dacă pasul e făcut ȘI din exact același cod
step_done() {
  [ -f "$STATE/$1.done" ] || return 1
  local vechi=""
  [ -f "$STATE/$1.fp" ] && vechi=$(tr -d '[:space:]' < "$STATE/$1.fp")
  if [ "$vechi" = "$FP" ]; then return 0; fi
  local aratare="fără amprentă"
  [ -n "$vechi" ] && aratare="amprenta ${vechi:0:12}"
  log "pasul '$1' a fost făcut din alt cod ($aratare, acum ${FP:0:12}) — îl refac"
  rm -f "$STATE/$1.done" "$STATE/$1.fp" "$STATE/$1.commit"
  return 1
}

log "Amprenta codului: ${FP:0:12}  (commit $(git rev-parse --short HEAD))"

TAG="v${NEW_VERSION}"
RELEASE_DIR="release/${NEW_VERSION}"
DMG="${RELEASE_DIR}/AdventShow-Mac-${NEW_VERSION}.dmg"
ZIP="${RELEASE_DIR}/AdventShow-Mac-${NEW_VERSION}.zip"
EXE="${RELEASE_DIR}/AdventShow-Setup-${NEW_VERSION}.exe"

# ── Baza livrată preia ce s-a publicat în hangar ──────────────────────────────
#
# Sursa de adevăr pentru conținut e hangar. Ce accepți și publici acolo trebuie să
# ajungă și în baza din installer, altfel cine instalează mâine primește textul
# vechi. Se face automat, la fiecare release, înainte de orice build — nu depinde
# de memoria nimănui. Dacă feed-ul nu poate fi luat sau o intrare e stricată,
# scriptul se oprește și oprește release-ul: mai bine tăiat aici decât livrat greșit.
if ! step_done seed; then
    step "1b/11 Baza livrată preia corecturile din hangar"
    npm run --silent sync:seed || fail "sincronizarea bazei livrate a eșuat — vezi mesajul de mai sus"
    if ! git diff --quiet public/hymns.db; then
        git add public/hymns.db
        git commit -q -m "content: baza livrată preia corecturile publicate în hangar"
        # Baza livrată intră în installer, deci orice build de dinainte devine
        # nevalabil. Recalculăm amprenta ÎNAINTE de a ștampila pașii următori.
        FP=$(source_fingerprint)
        ok "baza livrată actualizată și comisă (amprentă nouă: ${FP:0:12})"
    else
        ok "baza livrată era deja la zi"
    fi
    mark_done seed
fi

# working tree curat — doar la început de release nou (la reluare e deja bumped)
if [ ! -f "$STATE/bump.done" ]; then
    [ -z "$(git status --porcelain)" ] || fail "Working tree dirty — comite featurile înainte de release"
    ok "Git curat"
fi

# ── Bump versiune ─────────────────────────────────────────────────────────────

# Markerul poate minți. Dacă starea a rămas de la un release abandonat, iar între
# timp versiunea din arbore a fost dusă înapoi, „bump făcut" ar sări peste
# ridicarea versiunii și am construi 1.5.2 din fișiere care scriu înăuntru 1.5.1.
# Se verifică starea reală, nu marcajul.
if [ -f "$STATE/bump.done" ] && [ "$(node -p "require('./package.json').version")" != "$NEW_VERSION" ]; then
  log "marker de bump din altă rulare (package.json e la $(node -p "require('./package.json').version"), nu la ${NEW_VERSION}) — refac bump-ul"
  rm -f "$STATE/bump.done" "$STATE/bump.fp" "$STATE/bump.commit"
fi

if [ ! -f "$STATE/bump.done" ]; then
  step "2/11 Bump versiune"
  DATE=$(date +"%d %B %Y" | sed 's/January/Ianuarie/;s/February/Februarie/;s/March/Martie/;s/April/Aprilie/;s/May/Mai/;s/June/Iunie/;s/July/Iulie/;s/August/August/;s/September/Septembrie/;s/October/Octombrie/;s/November/Noiembrie/;s/December/Decembrie/')
  echo "   ${OLD_VERSION} → ${NEW_VERSION}"
  sed -i '' "s/\"version\": \"${OLD_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" package.json
  # Link-urile de descărcare din README sunt permanente (hangar detectează
  # sistemul de operare), deci nu mai trebuie rescrise la fiecare versiune —
  # doar badge-ul de versiune.
  sed -i '' "s/versiune-${OLD_VERSION}-green/versiune-${NEW_VERSION}-green/" README.md
  # CHANGELOG prin Node (nu sed) — descrierea e text liber; slash/ampersand au
  # crăpat release-ul 1.2.5 pe varianta sed.
  #
  # Ce s-a lucrat între două release-uri se scrie sub „## Nepublicat". La bump,
  # blocul ăla se MUTĂ în blocul versiunii noi. Altfel notele publicate ar conține
  # doar descrierea din linia de comandă, iar restul ar rămâne pentru totdeauna
  # sub un titlu pe care nu-l citește nimeni (pățit cu 1.5.2: patru rânduri de
  # lucru rămase pe dinafară, dintre care două reparații raportate de biserici).
  CL_VERSION="$NEW_VERSION" CL_DATE="$DATE" CL_DESC="$DESCRIPTION" node -e '
    const fs = require("fs");
    const f = "CHANGELOG.md";
    const title = "# Changelog — AdventShow";
    const NEPUB = "## Nepublicat";
    let s = fs.readFileSync(f, "utf8");
    const i = s.indexOf(title);
    if (i === -1) { console.error("CHANGELOG title not found"); process.exit(1); }

    let randuri = [];
    const ni = s.indexOf(NEPUB);
    if (ni !== -1) {
      const sep = s.indexOf("\n---", ni);
      const sfarsit = sep === -1 ? s.length : sep + 5;   // „\n---\n"
      randuri = s.slice(ni, sfarsit).split("\n").filter(l => l.startsWith("- "));
      s = (s.slice(0, ni) + s.slice(sfarsit)).replace(/\n{3,}/g, "\n\n");
    }
    // Descrierea din linia de comandă e nota publică pentru hangar. În CHANGELOG
    // intră doar dacă n-a scris nimeni nimic sub „Nepublicat" — altfel ar repeta,
    // cu alte cuvinte, ce scrie deja mai sus.
    if (randuri.length === 0) randuri.push("- " + process.env.CL_DESC);

    const entry = `## v${process.env.CL_VERSION} (${process.env.CL_DATE})\n\n### Modificări\n${randuri.join("\n")}\n\n---\n`;
    // Locul de scris pentru ce urmează rămâne sus, sub versiunea proaspătă, nu
    // coboară în istoric pe măsură ce se adaugă versiuni deasupra lui.
    const gol = `${NEPUB}\n\n_(nimic încă)_\n\n---\n`;
    const after = s.indexOf(title) + title.length;
    s = s.slice(0, after) + "\n\n" + entry + "\n" + gol + s.slice(after).replace(/^\n+/, "\n");
    fs.writeFileSync(f, s);
    console.log("   CHANGELOG: " + randuri.length + " rânduri în v" + process.env.CL_VERSION);
  ' || fail "Actualizarea CHANGELOG a eșuat"
  echo "$NEW_VERSION" > "$STATE/bump.done"
  stamp_done bump
  ok "package.json + README + CHANGELOG actualizate"
fi
log "Versiune release: $NEW_VERSION"

# ── Build macOS semnat ────────────────────────────────────────────────────────

if ! step_done mac; then
  step "3/11 Build macOS (signed)"
  # codesign cu retry — fiecare semnătură cere serverul de timestamp Apple;
  # o singură cerere picată omora tot build-ul pe rețea instabilă
  export PATH="$PWD/scripts/codesign-retry:$PATH"
  built=""
  for attempt in 1 2 3 4; do
    log "build mac — încercarea $attempt"
    # Se curăță DOAR artefactele de mac. Un `rm -rf` pe tot folderul ar mătura și
    # EXE-ul adus de pe VM-ul de Windows, în timp ce markerul lui ar rămâne pe
    # „adus" — a rămas așa la 1.5.2, fără blockmap și fără latest.yml.
    rm -rf "${RELEASE_DIR}/mac-arm64" "$DMG" "$ZIP" "${DMG}.blockmap" "${ZIP}.blockmap" \
           "${RELEASE_DIR}/latest-mac.yml" "${RELEASE_DIR}/builder-debug.yml"
    if ./scripts/build-mac.sh release; then built=1; break; fi
    log "  …build mac eșuat, reîncerc în 30s"; sleep 30
  done
  [ -n "$built" ] || fail "build mac eșuat de 4 ori"
  [ -f "$DMG" ] || fail "DMG nu există: $DMG"
  [ -f "$ZIP" ] || fail "ZIP mac nu există: $ZIP (necesar pentru auto-update)"
  # Nu se urcă nicăieri (hangar își face singur feed-urile), dar absența lui
  # înseamnă că `publish` a dispărut din electron-builder.json5 — iar fără el
  # installerul nu mai știe de unde să-și ia update-urile.
  [ -f "${RELEASE_DIR}/latest-mac.yml" ] || fail "latest-mac.yml lipsă — verifică blocul publish din electron-builder.json5"
  mark_done mac
  ok "DMG + ZIP + latest-mac.yml"
fi

# ── Notary submit (doar upload; polling la pasul 8) ───────────────────────────

if ! step_done notary-id; then
  step "4/11 Notary submit (--no-wait)"
  submit_notary() {
    xcrun notarytool submit "$DMG" "${NOTARY_AUTH[@]}" \
      --no-wait --output-format plist > /tmp/adventshow-notary-submit.plist 2>/tmp/adventshow-notary-submit.err
  }
  retry "notary submit (upload DMG)" 40 20 -- submit_notary || fail "notary submit"
  /usr/libexec/PlistBuddy -c "Print :id" /tmp/adventshow-notary-submit.plist > "$STATE/notary-id.done" \
    || fail "nu pot citi submission id"
  stamp_done notary-id
  ok "submission id: $(cat "$STATE/notary-id.done")"
fi
NOTARY_ID=$(cat "$STATE/notary-id.done")

# ── Sync sursă pe VM Windows ──────────────────────────────────────────────────

if ! step_done winsync; then
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
  mark_done winsync
  ok "sursa pe VM"
fi

# ── Build Windows DETAȘAT (Task Scheduler — supraviețuiește căderii SSH) ──────

if ! step_done winbuild; then
  step "6/11 Build Windows detașat"
  # `winbuild-started` spune „taskul rulează deja pe VM, nu-l porni a doua oară".
  # E ștampilat la fel ca restul: dacă s-a pornit din alt cod, nu-l mai așteptăm.
  rm -f "$STATE/winbuild.started"   # marker din formatul vechi, fără amprentă
  if ! step_done winbuild-started; then
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
    mark_done winbuild-started
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
  mark_done winbuild
fi

# ── Pull artefacte Windows ────────────────────────────────────────────────────

if ! step_done winpull; then
  step "7/11 Pull EXE de pe VM"
  REMOTE_DIR_FWD="$(echo "${WIN_PROJECT}\\release\\${NEW_VERSION}" | tr '\\' '/')"
  mkdir -p "$RELEASE_DIR"
  EXE_NAME="AdventShow-Setup-${NEW_VERSION}.exe"
  retry "scp Setup.exe" 40 20 -- scp "${WIN_SSH_OPTS[@]}" -C "$WIN_HOST:${REMOTE_DIR_FWD}/${EXE_NAME}" "$EXE" || fail "scp ${EXE_NAME}"
  # blockmap-ul NU mai e opțional: hangar face update diferențial pe baza lui, iar
  # fără el fiecare biserică descarcă 113 MB întregi la fiecare versiune.
  retry "scp blockmap exe" 20 15 -- scp "${WIN_SSH_OPTS[@]}" -C "$WIN_HOST:${REMOTE_DIR_FWD}/${EXE_NAME}.blockmap" "${RELEASE_DIR}/${EXE_NAME}.blockmap" \
    || fail "blockmap exe lipsă — fără el update-ul diferențial moare în tăcere pe Windows"
  # latest.yml nu se urcă nicăieri (hangar își generează singur feed-urile, iar pe
  # GitHub puntea e fixată pe un release vechi), dar absența lui ar însemna că
  # blocul `publish` a dispărut din electron-builder.json5 — adică installerul de
  # Windows n-ar mai ști de unde să-și ia update-urile. Îl aducem ca verificare.
  retry "scp latest.yml" 30 15 -- scp "${WIN_SSH_OPTS[@]}" -C "$WIN_HOST:${REMOTE_DIR_FWD}/latest.yml" "${RELEASE_DIR}/latest.yml" \
    || fail "scp latest.yml — fără el puntea GitHub nu se poate publica"
  SIZE_BYTES=$(stat -f%z "$EXE")
  [ "$SIZE_BYTES" -gt 50000000 ] || { rm -f "$EXE"; fail "EXE pare incomplet ($SIZE_BYTES bytes)"; }
  mark_done winpull
  ok "EXE ($(du -h "$EXE" | cut -f1))"
fi

# ── Notary poll + staple ──────────────────────────────────────────────────────

if ! step_done staple; then
  step "8/11 Notary status + staple"
  while true; do
    # PlistBuddy nu poate citi din pipe (cere fișier seekable) → fișier temporar
    xcrun notarytool info "$NOTARY_ID" "${NOTARY_AUTH[@]}" --output-format plist \
      > /tmp/adventshow-notary-info.plist 2>/dev/null
    NSTATUS=$(/usr/libexec/PlistBuddy -c "Print :status" /tmp/adventshow-notary-info.plist 2>/dev/null || echo "NetworkDown")
    log "  notary: $NSTATUS"
    case "$NSTATUS" in
      Accepted) break ;;
      Invalid|Rejected)
        xcrun notarytool log "$NOTARY_ID" "${NOTARY_AUTH[@]}" || true
        fail "notarizare: $NSTATUS" ;;
      *) sleep 30 ;;
    esac
  done
  retry "stapler staple" 40 15 -- xcrun stapler staple "$DMG" || fail "stapler staple"
  xcrun stapler validate "$DMG" || fail "stapler validate"
  mark_done staple
  ok "DMG notarizat + stapled"
fi

# ── Git commit + push main (FĂRĂ tag — tag-ul îl creează publicarea) ──────────

if [ ! -f "$STATE/git.done" ]; then
  step "9/11 Git commit + push main"
  # DOAR fișierele de bump — nu `git add -A`, care ar mătura în commit-ul de
  # release orice lucrare în curs din working tree (pățit la v1.3.2)
  git add package.json README.md CHANGELOG.md
  git commit -m "release: v${NEW_VERSION} — ${DESCRIPTION}" || true
  retry "git push main" 40 20 -- git push origin main || fail "git push"
  touch "$STATE/git.done"
  ok "main push-uit"
fi

# ── GitHub Release: DRAFT → upload TOT → verificare → publicare ───────────────

if ! step_done hangar; then
  step "10/11 Upload în hangar (staging)"

  # Poarta finală: nu urcăm binare care nu vin din codul ăsta. Pașii de build sunt
  # deja ștampilați cu amprenta, dar dacă cineva a șters markere cu mâna sau a
  # copiat fișiere în release/, aici se oprește — după upload e prea târziu.
  for pas in mac winpull; do
    [ "$(tr -d '[:space:]' < "$STATE/${pas}.fp" 2>/dev/null)" = "$FP" ] \
      || fail "artefactele de la pasul '${pas}' nu vin din codul de acum — șterge scripts/.release-state/${NEW_VERSION} și reia releaseul"
  done
  ok "binarele vin din codul curent (${FP:0:12})"

  # Token-ul de upload NU stă în repo. Trăiește în ~/.hangar/tokens.env, mod 600.
  # Nu poate promova — tot ce urcăm rămâne invizibil până când promovezi din interfață.
  # shellcheck disable=SC1090
  [ -f "$HOME/.hangar/tokens.env" ] || fail "lipsește ~/.hangar/tokens.env (ADVENTSHOW_HUB_TOKEN=hub_…)"
  . "$HOME/.hangar/tokens.env"
  [ -n "${ADVENTSHOW_HUB_TOKEN:-}" ] || fail "ADVENTSHOW_HUB_TOKEN nesetat în ~/.hangar/tokens.env"

  # Staging în /tmp: iCloud evacuează fișierele mari din ~/Documents fix în timpul
  # upload-ului (pățit la v1.3.0 EXE și v1.3.1 ZIP).
  STAGING="/tmp/ashow-assets-${NEW_VERSION}"
  mkdir -p "$STAGING"
  # Feed-urile .yml NU se urcă: hangar le generează din baza lui la promovare.
  # Blockmap-urile sunt OBLIGATORII, nu opționale. Fără ele update-ul diferențial
  # se dezactivează în tăcere: fiecare biserică descarcă binarul întreg la fiecare
  # versiune, iar singurul semn e traficul. Hangar verifică asta acum automat, dar
  # verificăm și noi aici — mai bine cade release-ul decât să treacă mut.
  REQUIRED=("$DMG" "$ZIP" "$EXE"
            "${RELEASE_DIR}/AdventShow-Mac-${NEW_VERSION}.zip.blockmap"
            "${RELEASE_DIR}/AdventShow-Mac-${NEW_VERSION}.dmg.blockmap"
            "${RELEASE_DIR}/AdventShow-Setup-${NEW_VERSION}.exe.blockmap")
  UPLOAD=()
  for f in "${REQUIRED[@]}"; do
    [ -f "$f" ] || fail "ASSET OBLIGATORIU LIPSĂ: $f — nu urc un release incomplet"
    cp "$f" "$STAGING/" || fail "staging a eșuat pentru $f"
    UPLOAD+=("$STAGING/$(basename "$f")")
  done
  ok "staged ${#UPLOAD[@]} fișiere (toate cele obligatorii prezente)"

  # Uploaderul oficial al hub-ului: pe bucăți de 1 MB, reluabil — după o cădere de
  # rețea rulezi aceeași comandă și continuă de unde a rămas.
  PUSHER="$STAGING/hub-push.mjs"
  retry "descarc hub-push.mjs" 20 10 -- curl -sfLo "$PUSHER" https://hangar.it4all.ro/hub/tools/hub-push.mjs \
    || fail "nu pot lua hub-push.mjs de pe hangar"

  # --url explicit: uploaderul servit de hub are încă în el adresa de dinainte de
  # mutarea pe hangar.it4all.ro, iar apex-ul nu mai are /hub — postarea acolo se
  # întoarce cu pagina de eroare a panoului, nu cu JSON.
  # Note de versiune pentru pagina publică de descărcare. Fără ele, omul care
  # instalează vede doar un număr și nu știe ce primește.
  #
  # Text PUBLIC, citit de operatori care de multe ori nu sunt tehnici. Scrie ce se
  # schimbă pentru ei, în cuvintele lor. Fără nume de fișiere, funcții, tabele,
  # adrese interne sau explicații despre cum e făcut înăuntru.
  #
  # Implicit se folosește descrierea release-ului. Pentru un text pe mai multe
  # rânduri, pune-l într-un fișier și dă-i calea:
  #   HANGAR_NOTES_FILE=note-1.5.1.md npm run release:signed -- "descriere" patch
  NOTES="$DESCRIPTION"
  if [ -n "${HANGAR_NOTES_FILE:-}" ]; then
    [ -f "$HANGAR_NOTES_FILE" ] || fail "HANGAR_NOTES_FILE nu există: $HANGAR_NOTES_FILE"
    NOTES=$(cat "$HANGAR_NOTES_FILE")
  fi
  [ -n "$NOTES" ] || fail "note de versiune goale — oamenii trebuie să știe ce primesc"
  ok "note de versiune: $(printf '%s' "$NOTES" | wc -c | tr -d ' ') caractere"

  push_hangar() {
    HUB_TOKEN="$ADVENTSHOW_HUB_TOKEN" node "$PUSHER" \
      --url https://hangar.it4all.ro/hub/upload.php \
      --notes "$NOTES" \
      --project adventshow --version "$NEW_VERSION" "${UPLOAD[@]}"
  }
  retry "upload în hangar" 60 20 -- push_hangar || fail "upload în hangar"

  # Verificăm ce a ajuns efectiv, nu ce credem că am trimis.
  verify_hangar() {
    local n
    n=$(curl -sf -H "Authorization: Bearer $ADVENTSHOW_HUB_TOKEN" \
      "https://hangar.it4all.ro/hub/api.php?do=releases&project=adventshow" \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
          const v=(JSON.parse(s).versions||[]).find(x=>x.version===process.argv[1]);
          console.log(v?v.files:0);});' "$NEW_VERSION") || return 1
    [ "${n:-0}" -ge "${#UPLOAD[@]}" ] || { log "  …hangar are $n fișiere, am urcat ${#UPLOAD[@]}"; return 1; }
  }
  retry "verificare în hangar" 20 15 -- verify_hangar || fail "hangar nu are toate fișierele"
  rm -rf "$STAGING"
  mark_done hangar
  ok "v${NEW_VERSION} e în hangar, în STAGING (invizibil public până promovezi)"
fi

# ── Tag + note pe GitHub (fără binare) ───────────────────────────────────────

if [ ! -f "$STATE/gh.done" ]; then
  step "11/11 Tag + note pe GitHub"
  NOTES=$(awk "/^## v${NEW_VERSION}/{f=1; next} f && /^---/{exit} f" CHANGELOG.md)

  # ── PUNTEA PENTRU INSTALĂRILE DE SUB 1.4.0 ──────────────────────────────────
  #
  # Ele au în `app-update.yml` adresa GitHub, scrisă la build, și nu știu de hangar
  # (modulul care vorbește cu el a apărut abia în 1.4.0, deci nici update forțat,
  # nici mesaj nu ajunge la ele). Întreabă GitHub la fiecare pornire și la 6 ore,
  # iar electron-updater cere `latest.yml` STRICT din release-ul pe care GitHub îl
  # marchează „Latest". Dacă acolo nu-l găsește, NU se întoarce la unul mai vechi:
  # se oprește tăcut, pentru totdeauna (verificat în GitHubProvider.js din
  # node_modules — aruncă ERR_UPDATER_CHANNEL_FILE_NOT_FOUND, fără alternativă).
  #
  # Deci nu mai retrimitem binarele la fiecare versiune, dar LĂSĂM marcajul
  # „Latest" pe release-ul care le are: PUNTE_TAG. Cine deschide o instalare veche
  # sare acolo, iar de la 1.4.0 în sus aplicația se actualizează din hangar.
  # Tag-urile noi se creează cu `--latest=false`, ca să nu fure marcajul.
  #
  # Puntea se poate desființa (șterge PUNTE_TAG și pune GITHUB_BRIDGE=1 la un
  # release) abia când contorul afișat la pre-flight rămâne 0 un ciclu întreg —
  # atunci nu mai verifică nimeni de acolo.
  PUNTE_TAG="${PUNTE_TAG:-v1.5.1}"
  if [ -n "$PUNTE_TAG" ] && [ "$PUNTE_TAG" != "$TAG" ]; then
    verifica_puntea() {
      gh api "repos/AdventTools/AdventShow/releases/latest" > /tmp/ashow-punte.json 2>/dev/null || return 1
      node -e '
        const r = JSON.parse(require("fs").readFileSync("/tmp/ashow-punte.json", "utf8"));
        const nume = (r.assets || []).map(a => a.name);
        const lipsa = ["latest.yml", "latest-mac.yml"].filter(n => !nume.includes(n));
        const instalatoare = nume.filter(n => /\.(exe|dmg|zip)$/.test(n));
        if (r.tag_name !== process.argv[1]) {
          console.error(`  …„Latest" pe GitHub e ${r.tag_name}, nu ${process.argv[1]}`); process.exit(1);
        }
        if (lipsa.length) { console.error("  …lipsesc din punte: " + lipsa.join(", ")); process.exit(1); }
        if (!instalatoare.length) { console.error("  …puntea nu are niciun instalator"); process.exit(1); }
      ' "$PUNTE_TAG"
    }
    retry "verificare punte GitHub" 20 15 -- verifica_puntea \
      || fail "puntea GitHub (${PUNTE_TAG}) nu mai e întreagă — instalările de sub 1.4.0 ar rămâne fără actualizare, fără cale de întoarcere. Repar-o înainte de a publica."
    ok "puntea GitHub e întreagă: ${PUNTE_TAG} rămâne «Latest», cu feed și instalatoare"
  fi

  GITHUB_BRIDGE="${GITHUB_BRIDGE:-0}"
  BRIDGE_ASSETS=()
  if [ "$GITHUB_BRIDGE" = "1" ]; then
    BRIDGE_STAGING="/tmp/ashow-bridge-${NEW_VERSION}"
    mkdir -p "$BRIDGE_STAGING"
    for f in "$DMG" "$ZIP" "$EXE" "${RELEASE_DIR}/latest.yml" "${RELEASE_DIR}/latest-mac.yml"; do
      [ -f "$f" ] || fail "PUNTE: lipsește $f — fără el, instalările vechi rămân blocate pe versiunea veche"
      cp "$f" "$BRIDGE_STAGING/"
      BRIDGE_ASSETS+=("$BRIDGE_STAGING/$(basename "$f")")
    done
    for f in "${RELEASE_DIR}/AdventShow-Mac-${NEW_VERSION}.zip.blockmap" \
             "${RELEASE_DIR}/AdventShow-Mac-${NEW_VERSION}.dmg.blockmap" \
             "${RELEASE_DIR}/AdventShow-Setup-${NEW_VERSION}.exe.blockmap"; do
      [ -f "$f" ] && cp "$f" "$BRIDGE_STAGING/" && BRIDGE_ASSETS+=("$BRIDGE_STAGING/$(basename "$f")")
    done
    NOTES="${NOTES}

---

**AdventShow se actualizează singur din hangar.it4all.ro.** Fișierele de aici sunt
pentru instalările mai vechi de 1.4.0, care își caută încă actualizarea pe GitHub;
odată actualizate, trec automat pe hangar și nu mai depind de pagina asta.
Descărcare: https://hangar.it4all.ro/get/ba3166b608233a30/"
    ok "punte GitHub pregătită (${#BRIDGE_ASSETS[@]} fișiere)"
  fi

  NOTES="${NOTES}

---

Descarcă: https://hangar.it4all.ro/get/ba3166b608233a30/ — după instalare,
aplicația se actualizează singură."

  create_release() {
    gh release view "$TAG" >/dev/null 2>&1 && return 0
    # Două lucruri, ambele plătite cu bani mulți:
    # • tag-ul se pune pe commit-ul EXACT din care s-au construit binarele, nu pe
    #   vârful lui main — dacă între pasul 9 și aici mai urcă cineva un commit,
    #   `--target main` ar lega versiunea de alt cod decât cel livrat;
    # • `--latest=false` ca marcajul „Latest" să rămână pe punte (PUNTE_TAG).
    #   Fără el, gh ar muta marcajul aici, pe un release fără fișiere, iar
    #   instalările de sub 1.4.0 ar rămâne blocate definitiv.
    if [ -n "$PUNTE_TAG" ]; then
      gh release create "$TAG" --target "$(git rev-parse HEAD)" --title "${TAG}" --notes "${NOTES}" --latest=false
    else
      gh release create "$TAG" --target "$(git rev-parse HEAD)" --title "${TAG}" --notes "${NOTES}"
    fi
  }
  retry "gh release create" 40 20 -- create_release || fail "gh release create"

  if [ "${#BRIDGE_ASSETS[@]}" -gt 0 ]; then
    upload_bridge() { gh release upload "$TAG" "${BRIDGE_ASSETS[@]}" --clobber; }
    retry "upload punte GitHub" 60 20 -- upload_bridge || fail "upload punte GitHub"
    verify_bridge() {
      local listing; listing=$(gh release view "$TAG" --json assets --jq '.assets[].name') || return 1
      for f in "${BRIDGE_ASSETS[@]}"; do
        echo "$listing" | grep -qx "$(basename "$f")" || { log "  …lipsește $(basename "$f")"; return 1; }
      done
    }
    retry "verificare punte" 20 15 -- verify_bridge || fail "punte incompletă — instalările vechi ar primi 404"
    rm -rf "$BRIDGE_STAGING"
    ok "punte publicată: instalările vechi pot ajunge la ${NEW_VERSION}"
  fi
  retry "fetch tags" 10 10 -- git fetch origin --tags || true

  sleep 20
  if ! gh run list --workflow=build.yml --json headBranch --jq '.[].headBranch' 2>/dev/null | grep -qx "$TAG"; then
    log "CI nu a pornit de la tag — declanșez manual (workflow_dispatch)"
    retry "workflow_dispatch" 20 15 -- gh workflow run build.yml --ref "$TAG" || true
  fi
  touch "$STATE/gh.done"
  ok "tag ${TAG} + note publicate, CI Linux pornit"
fi

# ── Oglinda corecturilor pentru instalările de sub 1.4.0 ─────────────────────
#
# Ele citesc corecturile de pe GitHub (content/corrections.json din main), nu din
# hangar. Pasul se uita când era manual: pe 26 sep 2026 oglinda era la seq 9, iar
# hangarul la 22 — cine nu se actualizase rămânea cu baza înghețată. Rulează după
# build-uri, deci nu atinge binarele; commit-ul conține doar fișierul ăsta.
if [ ! -f "$STATE/mirror.done" ]; then
  step "Oglinda corecturilor pe GitHub"
  mirror_fetch() { curl -sfL https://hangar.it4all.ro/d/ba3166b608233a30/corrections.json -o content/corrections.json; }
  retry "descărcare corecturi" 10 10 -- mirror_fetch || fail "nu am putut descărca corecturile din hangar"
  node -e 'if (!Array.isArray(JSON.parse(require("fs").readFileSync("content/corrections.json", "utf8")).entries)) process.exit(1)' \
    || { git checkout -- content/corrections.json; fail "corrections.json descărcat nu e valid"; }
  # Contează doar intrările: hangarul rescrie fișierul cu altă dată („generated") la
  # fiecare publicare, iar un commit doar pentru dată ar fi zgomot.
  if git show HEAD:content/corrections.json | node -e '
      const fs = require("fs");
      const vechi = JSON.parse(fs.readFileSync(0, "utf8")).entries;
      const nou = JSON.parse(fs.readFileSync("content/corrections.json", "utf8")).entries;
      process.exit(JSON.stringify(vechi) === JSON.stringify(nou) ? 0 : 1)'; then
    git checkout -- content/corrections.json
    ok "oglinda era deja la zi"
  else
    git add content/corrections.json
    git commit -q -m "content: corecturile din hangar, oglindite pentru instalările de sub 1.4.0" \
      || fail "commit oglindă"
    retry "git push oglindă" 10 15 -- git push -q origin main || fail "git push oglindă"
    ok "oglinda actualizată și urcată"
  fi
  mark_done mirror
fi

step "GATA — v${NEW_VERSION} urcat"
echo ""
echo "  MAI TREBUIE UN PAS, FĂCUT DE OM: promovează versiunea în hangar."
echo "  https://hangar.it4all.ro/hub/?p=adventshow&t=releases"
echo ""
echo "  Până atunci, v${NEW_VERSION} e în staging: nimeni nu o vede și nimeni nu o"
echo "  primește prin auto-update. La promovare, hangar generează feed-urile."
echo "  AppImage-ul de Linux ajunge singur, din CI, în aceeași versiune."
