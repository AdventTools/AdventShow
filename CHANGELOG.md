# Changelog — AdventShow

## v1.1.1 (10 Aprilie 2026)

### Proiecție
- **Font uniform per imn** — dimensiunea fontului se calculează pe baza celei mai dificile strofe/refren din imn și se aplică identic pe toate slide-urile. Fontul nu mai variază de la o strofă la alta, dar rămâne cât mai mare posibil fără a depăși ecranul, indiferent de rezoluția monitorului.
- Versetele biblice rămân cu dimensionare individuală (sunt independente).

### Documentație
- Reguli de versionare clarificate în instrucțiunile Copilot: PATCH se incrementează automat la fiecare modificare, MINOR/MAJOR doar la instrucțiunea explicită a utilizatorului.

---

## v1.1.0 (10 Aprilie 2026)

### Redenumire proiect
- Aplicația se numește acum **AdventShow** (anterior „Proiecție Imnuri")
- AppId, productName, shortcut și titlu actualizate peste tot
- Repo mutat la [github.com/AdventTools/AdventShow](https://github.com/AdventTools/AdventShow)

### Corecții interfață
- „Strofa 1/2/3..." în loc de „Strofă 1/2/3..." — corecție de gramatică românească în proiecție, controller și editor
- Indicatorii de poziție (dots) din partea de jos a proiecției sunt acum **albi** și vizibili (anterior erau gri, aproape invizibili)

### Funcționalitate nouă
- **Previne hibernarea / screensaver-ul** — laptopul/PC-ul nu mai intră în sleep cât timp AdventShow e pornit (folosește `powerSaveBlocker` din Electron)
- **Pagina Despre** — tab nou în Setări cu informații despre aplicație, versiune, dezvoltatori și link-uri GitHub

### Documentație
- README complet rescris în română, cu instrucțiuni clare de descărcare pentru utilizatori non-tehnici
- Fișier `.github/copilot-instructions.md` cu reguli de dezvoltare și versionare

---

## v1.0.0 (4 Aprilie 2026)

Fork complet rescris al aplicației originale, cu interfață nouă, integrare Biblie, căutare inteligentă și flux de lucru optimizat pentru proiecție în biserică.

---

### Schimbări vizibile (UI / funcționalitate)

#### Interfață complet nouă
- Layout cu 3 coloane: sidebar navigare · lista imnuri/Biblie · panou previzualizare
- Tema „night" (întunecată), optimizată pentru utilizare în semiîntuneric
- Iconuri Lucide React, design compact și modern
- Panoul de previzualizare arată secțiunile imnului cu etichete „Strofa N" / „Refren" colorate distinct
- Textul în previzualizare este aliniat la stânga, etichetele vizibile (albastru deschis pentru strofe, amber pentru refren)

#### Integrare Biblie Cornilescu
- 66 cărți, 31.102 versete — Biblia Cornilescu completă
- Biblia se auto-încarcă la prima pornire (inclusă în installer)
- Navigare pe cărți → capitole → versete, cu previzualizare și proiecție
- Proiecția Bible: text mare, referința versetului dedesubt, fără elemente inutile

#### Căutare inteligentă
- Căutare imnuri după număr, titlu sau conținut
- Căutare Biblie: tastezi „gen 1 1" sau „ps 23" sau „1cor 13 4-7" → se încarcă direct
- Suport pentru cărți cu prefix numeric: „1 imp", „2 cor", „1 tes" etc.
- Căutare parțială funcțională: „deu" → Deuteronom, „ioa" → Ioan

#### Flux tastatură Enter → previzualizare → proiecție
- **Enter (1)** — încarcă primul rezultat din căutare în previzualizare
- **Enter (2)** — proiectează imnul/versetul
- **Escape (1)** — oprește proiecția (păstrează previzualizarea)
- **Escape (2)** — curăță previzualizarea + focus pe câmpul de căutare
- **Săgeți ↑↓** — navighează prin lista de imnuri / secțiuni proiectate
- **/** — focus rapid pe câmpul de căutare

#### Navigare imn curent în proiecție
- Clic pe secțiune în previzualizare → sare la acea secțiune
- Dublu-clic → proiectează direct de la acea secțiune
- Butoane ← → pentru navigare între strofe/refrene

#### Schimbare fluidă între imnuri
- Poți căuta alt imn în timp ce proiectezi — Enter încarcă noul imn fără întrerupere
- Trecerea de la un imn la altul se face fără a opri/reporni proiecția

#### Gestionare categorii și imnuri
- Meniu contextual (clic dreapta): editează, schimbă categoria, șterge
- Editor de imnuri cu strofe/refrene individuale, reordonare, adăugare/ștergere secțiuni
- Sistem parolă admin pentru operații destructive (cu perioadă de grație 5 min)
- Import/export JSON backup

#### Snippet inline în lista de imnuri
- Primul vers al imnului apare pe aceeași linie cu titlul (nu pe rând separat)
- Trunchiat cu „…" dacă nu încape — economisește spațiu vertical

#### Fereastră cu memorie
- Poziția și dimensiunea ferestrei principale se salvează la ieșire
- La repornire, fereastra apare exact unde a fost lăsată

#### Imnuri completate
- 18 imnuri care lipseau au fost importate din fișierele PPT originale
- Total: 922 imnuri în „Imnuri Creștine" (anterior 904)
- Imnuri adăugate: 122, 250–259, 311, 314, 379, 404, 664 A, 664 B, 869

#### Setări proiecție
- Alegere ecran de proiecție (display secundar)
- Fundal: culoare solidă, imagine sau video, cu opacitate reglabilă
- Culoare număr imn și culoare text configurabile
- Dimensiune font proiecție reglabilă (60%–200%, implicit 120%)

---

### Îmbunătățiri tehnice

#### Arhitectură
- Electron 30.5.1 + React 18 + TypeScript + Vite 5 + TailwindCSS + DaisyUI 5
- better-sqlite3 v12.6.2 pentru acces rapid la baza de date
- Preload bridge tipizat complet (IPC typesafe între main ↔ renderer)
- Protocol custom `localfile://` pentru imagini/video locale fără probleme CORS

#### Baza de date
- Schema unificată: `hymns`, `hymn_sections`, `categories`, `bible_books`, `bible_verses`
- Căutare normalizată (diacritice, lowercase) pentru potriviri flexibile
- `seedBibleFromJson()` — auto-import Biblie din `cornilescu.json` la prima pornire
- Script `import_missing_hymns.py` pentru import PPT/PPTX → SQLite

#### Proiecție
- Font sizing dinamic cu fit-to-page: imnuri clamp 2–8rem, Biblie 2.5–9rem
- Multiplicator font configurabil (`projectionFontSize` în settings)
- `contentType` / `bibleRef` propagate prin tot pipeline-ul (main → preload → projection)
- Fereastră proiecție: fullscreen, transparentă, always-on-top pe monitor principal

#### Persistență setări
- `settings.json` în `app.getPath('userData')` — supraviețuiește actualizărilor
- `windowBounds` salvate la move/resize cu debounce 500ms
- Validare: bounds-urile sunt verificate că sunt pe un display vizibil

#### Build & distribuție
- electron-builder cu NSIS (Windows) + DMG (macOS) + AppImage (Linux)
- Baza de date `hymns.db` și `cornilescu.json` incluse ca `extraResources`
- Versiune corectă (1.0.0) în numele installerului
- Installere disponibile direct în [GitHub Releases](../../releases)
