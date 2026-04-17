# Changelog — AdventShow

## v1.1.21 (17 Aprilie 2026)

### Modificări
- Verificare actualizări manuală în Setări → Despre (buton „Verifică actualizări" cu descărcare și instalare directă)

---

## v1.1.20 (17 Aprilie 2026)

### Modificări
- Culori proiecție: text alb pe strofă/refren, indicator curent verde elegant
- Windows: shortcut pe desktop la instalare
- Nume installer simplificat (AdventShow-Setup.exe)
- Release curat: doar DMG, Setup.exe, AppImage

---


## v1.1.19 (13 Aprilie 2026)

### Modificări
- Îmbunătățire panou About nativ, test delta update

---


## v1.1.18 (13 Aprilie 2026)

### Modificări
- Îmbunătățire panou About nativ, test delta update

---


## v1.1.17 (13 Aprilie 2026)

### Modificări
- Fix critic: descărcare update nu funcționa (Electron intercepta fs pentru .asar)

---


## v1.1.16 (13 Aprilie 2026)

### Modificări
- Test mecanism delta update v1.1.16

---


## v1.1.15 (13 Aprilie 2026)

### Modificări
- Fix crash la download update, fix CI ffmpeg-static timeout, redesign secțiune Despre

---


## v1.1.14 (13 Aprilie 2026)

### Modificări
- Test delta update

---


## v1.1.13 (13 Aprilie 2026)

### Modificări
- Delta update (descarcă doar codul, nu tot Electron), release script unificat, About simplificat

---


## v1.1.12 (13 Aprilie 2026)

### Corecții
- **Fix auto-update macOS** — înlocuit mecanismul Squirrel/ShipIt (care valida semnătura codului și eșua) cu instalare manuală: extragere zip, înlocuire aplicație, repornire. Funcționează și fără certificat Apple Developer
- **Semnare ad-hoc corectă** — aplicația macOS are acum semnătură ad-hoc completă (resurse sealed) pentru consistență cu Gatekeeper

---

## v1.1.11 (13 Aprilie 2026)

### Corecții
- **Fix auto-update la aceeași versiune** — aplicația nu mai încearcă să se actualizeze la versiunea pe care o rulează deja; comparația corectă a versiunii curente cu cea din release
- **Secțiunea Despre nativă macOS** — dialogul About din meniul aplicației afișează acum numele dezvoltatorilor și contribuțiile lor

---

## v1.1.10 (13 Aprilie 2026)

### Corecții
- **Fix auto-update macOS** — eliminată semnarea ad-hoc care bloca actualizarea automată (macOS Squirrel/ShipIt valida semnătura și eșua). Aplicația rămâne nesemnată, ceea ce este corect pentru distribuție gratuită fără certificat Apple Developer.

---

## v1.1.9 (13 Aprilie 2026)

### Corecții
- **Biblie: toate versetele în previzualizare** — revenire la afișarea tuturor versetelor din capitol în panoul de previzualizare, cu navigare cu săgeți (ca la imnuri)
- **Auto-update: fișierele YAML de metadate** — CI-ul încarcă acum `latest.yml` și `latest-linux.yml` în release, necesare pentru ca electron-updater să detecteze versiuni noi

---

## v1.1.8 (13 Aprilie 2026)

### Corecții
- **Fix build Windows pe CI** — eliminată semnarea cu certificat self-signed care bloca build-ul pe GitHub Actions; eliminat macOS din CI (se face local)
- **Biblie: font auto-resize în previzualizare** — fontul versetului biblic se redimensionează automat la lățimea panoului (interval 12–28px), nu mai rămâne mic și greu de citit

### Îmbunătățiri
- **Secțiunea Despre completată** — afișează lista de funcționalități, numele și contribuțiile fiecărui dezvoltator, link-uri către organizație și cod sursă

---

## v1.1.7 (13 Aprilie 2026)

### Corecții
- **Biblie: previzualizare un singur verset** — previzualizarea afișează doar versetul selectat, nu tot capitolul. Navigare cu săgeți între versete
- **Imnuri: font uniform pe toate strofele** — fontul din panoul de previzualizare se calculează pe baza celui mai lung rând din toate secțiunile și se aplică identic peste tot
- **Video: filtre în sidebar** — bara laterală conține acum butoane de filtrare (Toate / YouTube / Local) cu contoare. Playlist-ul rămâne în zona de conținut
- **Locație fișier clickabilă** — click pe calea fișierului din playlist deschide folderul în Finder / Explorer

### Noutăți
- **Certificat SSL auto-import** — aplicația include un certificat self-signed; pe Windows, installerul NSIS îl importă automat în Trusted Root, eliminând avertismentul SmartScreen

---

## v1.1.6 (12 Aprilie 2026)

### Funcționalități noi
- **Configurare inițială completă** — la prima pornire, aplicația cere și setarea folderului de descărcare pentru videouri (nu doar parola)
- **Import / Export mai clar** — secțiunea de Import / Export este acum etichetată explicit ca fiind pentru imnuri, cu descrieri și butoane clare

---

## v1.1.5 (11 Aprilie 2026)

### Funcționalități noi
- **Previzualizare video sincronizată** — videoul rulează simultan (muted) în panoul de previzualizare și pe proiecție, cu sincronizare automată a timpului
- **Layout redimensionabil** — marginile dintre sidebar, conținut și previzualizare se trag cu mouse-ul; pozițiile se salvează automat între sesiuni
- **Biblie: capitole + versete simultan** — la selectarea unui capitol, capitolele rămân vizibile în partea de sus, versetele apar dedesubt
- **Previzualizare text complet per imn** — în lista de imnuri, textul preview afișează toate strofele pe un singur rând (nu doar prima strofă)

### Îmbunătățiri
- **Căutare Biblie la Enter** — căutarea în textul Bibliei se face doar la apăsarea tastei Enter (nu în timp real), pentru performanță mai bună
- **Fără limită de rezultate** — căutarea în Biblie returnează toate rezultatele (anterior: maxim 200)
- **Panou previzualizare mai lat** — lățimea implicită a panoului de previzualizare a fost dublată (640px)
- **Build macOS pe GitHub Actions** — DMG-ul se compilează acum pe CI, nu doar local

---

## v1.1.4 (12 Aprilie 2026)

### Funcționalități noi
- **Redare video pe proiecție** — suport pentru fișiere MP4, WebM, MOV, MKV, AVI cu conversie automată în MP4 pentru formatele nesuportate nativ
- **Suport YouTube** — lipește un link YouTube direct în aplicație și se redă pe ecranul de proiecție (necesită yt-dlp, se instalează din Setări)
- **Verificare actualizări** — la pornire, aplicația verifică dacă există o versiune mai nouă pe GitHub și afișează un banner cu buton de descărcare
- **Selectare ieșire audio** — alege dispozitivul audio pentru redarea video din Setări

### Îmbunătățiri
- **Căutare Biblie îmbunătățită** — caută corect și fără diacritice (ex: „har" găsește „har" și „hăr")
- **Indicator strofă activă** — strofa care se proiectează este evidențiată vizual cu bară albastră și badge „● LIVE"
- **Pornire proiecție din strofă** — butonul „Proiectează" pornește de la strofa selectată, nu de la prima
- **Căutare în capitol** — căutarea de text funcționează și în cadrul unui capitol selectat

### Corecții
- Imnul 001 afișa o singură strofă — restaurate cele 4 strofe originale

---

## v1.1.3 (11 Aprilie 2026)

### Curățenie
- README simplificat — conține doar informații pentru utilizatorul final
- Linkuri de descărcare corecte, fără versiune hardcodată în fișier
- Fișiere parazite eliminate din release-uri (elevate.exe, AdventShow.exe neambalat)
- Changelog curățat de detalii tehnice interne

---

## v1.1.2 (11 Aprilie 2026)

### Fix proiecție
- **Fix font overflow** — constantele de calcul font au fost ajustate conservativ: zona utilizabilă redusă la ~58vh (din 72vh) pentru a compensa header-ul, footer-ul și padding-ul. Lățimea caracterelor bold compensată cu factor 120 (din 150). Fontul minim coborât la 1.5rem, maxim la 7rem. Imnul 009 și alte imnuri cu text lung nu mai ies din ecran.

---

## v1.1.1 (10 Aprilie 2026)

### Proiecție
- **Font uniform per imn** — dimensiunea fontului se calculează pe baza celei mai dificile strofe/refren din imn și se aplică identic pe toate slide-urile. Fontul nu mai variază de la o strofă la alta, dar rămâne cât mai mare posibil fără a depăși ecranul, indiferent de rezoluția monitorului.
- Versetele biblice rămân cu dimensionare individuală (sunt independente).

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
- README complet rescris în română cu instrucțiuni de descărcare și instalare

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


