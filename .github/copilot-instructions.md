# Instrucțiuni GitHub Copilot — AdventShow

## Despre proiect

AdventShow este o aplicație desktop Electron (React + TypeScript + TailwindCSS + DaisyUI) pentru proiecția imnurilor și versetelor biblice în biserică. Baza de date folosește SQLite (better-sqlite3).

Repo: https://github.com/AdventTools/AdventShow

## Stack tehnic

- **Main process:** Electron 30, TypeScript, better-sqlite3
- **Renderer:** React 18, TypeScript, Vite 5, TailwindCSS, DaisyUI 5
- **IPC:** preload bridge tipizat (`electron/preload.ts` ↔ `src/vite-env.d.ts`)
- **Build:** electron-builder (NSIS pe Windows, DMG pe macOS, AppImage pe Linux)

## Structura folderelor

- `electron/` — main process (main.ts, db.ts, preload.ts, import.ts)
- `src/` — renderer React (App.tsx, ProjectionPage.tsx, ProjectorController.tsx)
- `public/` — fișiere statice (hymns.db)
- `scripts/` — scripturi Python de import date, cornilescu.json
- `build/` — icoane pentru electron-builder

## Reguli obligatorii

### Limba
- Interfața utilizator (UI) este în **română**. Toate textele vizibile utilizatorului trebuie să fie în română.
- Comentariile din cod pot fi în engleză sau română, dar preferabil în engleză.
- README-ul principal este în română.

### Repo public — ce se publică și ce nu
- Acesta este un **repo public**. Tot ce e comis este vizibil oricui.
- **README.md** conține **exclusiv informații pentru utilizatorul final**: descărcare, instalare, funcționalități, scurtături. Nimic despre procese interne, Copilot, reguli de versionare, structura codului, comenzi de build sau arhitectură.
- **CHANGELOG.md** conține **doar modificări vizibile utilizatorului** (funcționalități, fix-uri, UI). Nu se menționează Copilot, instrucțiuni interne, procese de CI/CD, refactorizări tehnice invizibile.
- **Nu se comit NICIODATĂ**: token-uri, chei API, parole, secrete de orice fel. Verifică de două ori înainte de commit.
- Detaliile tehnice și de dezvoltare rămân **doar** în `.github/copilot-instructions.md` și în comentariile din cod.
- Regula de bază: **nu ne spălăm rufele în public**.

### Versionare (Semantic Versioning)
- Folosim **SemVer**: `MAJOR.MINOR.PATCH`
  - **MAJOR** — schimbări incompatibile / rescrierea majoră a funcționalității
  - **MINOR** — funcționalități noi, compatibile înapoi
  - **PATCH** — bug fixes, corecții minore, îmbunătățiri mici
- **Copilot incrementează automat DOAR clasa PATCH** (ex: 1.1.0 → 1.1.1 → 1.1.2). La fiecare commit pe `main` care modifică cod sau funcționalitate, versiunea PATCH crește cu 1.
- **Clasele MAJOR și MINOR se incrementează DOAR la instrucțiunea explicită a utilizatorului.** Niciodată automat.
- Versiunea se actualizează în **`package.json`** (`version` field). Vite o preia automat prin `import.meta.env.VITE_APP_VERSION`.
- La fiecare schimbare de versiune, actualizează și **`CHANGELOG.md`** cu descrierea modificărilor.
- Nu uita să actualizezi badge-ul de versiune și link-urile de descărcare din **`README.md`**.

### Convenții de cod
- TypeScript strict — fără `any` unde se poate evita
- Formatare: indentare cu 2 spații, punct și virgulă opțional (stilul existent fără `;` la final)
- Componente React: funcții (nu clase), hooks
- Stiluri: TailwindCSS classes, CSS custom doar în App.css pentru componente complexe
- IPC: orice funcție nouă expusă rendererului trebuie adăugată în trei locuri:
  1. `electron/main.ts` — `ipcMain.handle(...)`
  2. `electron/preload.ts` — `ipcRenderer.invoke(...)`
  3. `src/vite-env.d.ts` — tipizare TypeScript

### Gramatică română în UI
- Se scrie **„Strofa 1"**, NU „Strofă 1"
- Se scrie **„Refren"**, nu „Chorus"
- Numele aplicației este **AdventShow** (un singur cuvânt, CamelCase)

### Proiecție
- Fereastra de proiecție este fullscreen, pe ecranul secundar
- Textul trebuie să fie lizibil: font mare, contrast ridicat, text-shadow
- Indicatorii de poziție (dots) din subsol trebuie să fie **albi** și vizibili

### Performanță și stabilitate
- Aplicația trebuie să prevină sleep-ul/screensaver-ul sistemului cât timp e activă (`powerSaveBlocker`)
- Baza de date SQLite trebuie inițializată o singură dată la pornire
- Evenimentele IPC trebuie curățate corect (cleanup pe unmount)

### Build și distribuție
- Installerele trebuie generate prin `npm run build:win`, `npm run build:mac`, `npm run build:linux`
- Numele installerului folosește `${productName}` din electron-builder.json5
- `hymns.db` și `cornilescu.json` sunt incluse ca `extraResources`
- **macOS** — build-ul se face **local** pe mașina dezvoltatorului (este necesar macOS nativ pentru a genera `.dmg`)
- **Windows și Linux** — build-urile se fac prin **GitHub Actions** (workflow CI/CD)

### Release-uri (OBLIGATORIU)
- **La FIECARE modificare** care ajunge pe branch-ul `main`, trebuie creat un **GitHub Release** nou.
- Release-ul trebuie să conțină **installerele** pentru toate platformele (Windows `.exe`, macOS `.dmg`, Linux `.AppImage`).
- Fără excepție: orice commit pe `main` care schimbă funcționalitatea, corectează bug-uri sau actualizează versiunea **trebuie** să fie însoțit de un release cu fișierele binare atașate.
- Link-urile de descărcare din `README.md` trebuie să rămână mereu funcționale și să corespundă ultimului release.
- La schimbarea versiunii, actualizează și numele fișierelor din tabelul de descărcare din `README.md`.
- Tag-ul git pentru release este `v<MAJOR>.<MINOR>.<PATCH>` (ex: `v1.1.0`).
- Procedura de release:
  1. Actualizează `version` în `package.json`
  2. Actualizează `CHANGELOG.md` cu modificările
  3. Actualizează badge-ul de versiune și link-urile din `README.md`
  4. Commit + push pe `main`
  5. Creează tag: `git tag v<versiune>`
  6. Push tag: `git push origin v<versiune>`
  7. Build local macOS: `npm run build:mac` → încarcă `.dmg` în release
  8. GitHub Actions construiește automat Windows + Linux și le atașează la release
  9. Verifică că toate link-urile de descărcare funcționează

### Git
- Branch principal: `main`
- Commit messages: descriptive, în engleză, prefixate cu tipul: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`
- Tag-uri de versiune: `v1.0.0`, `v1.1.0`, etc.
- Nu commita `node_modules/`, `dist/`, `dist-electron/`, `release/`
