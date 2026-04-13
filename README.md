# AdventShow

**Aplicație gratuită și open-source pentru proiecția imnurilor și versetelor biblice în biserici.**

Include Biblia Cornilescu completă (66 cărți, 31.102 versete) și 922 de imnuri din „Imnuri Creștine".

![platform](https://img.shields.io/badge/platforme-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![version](https://img.shields.io/badge/versiune-1.1.17-green)
![license](https://img.shields.io/badge/licență-gratuită-brightgreen)

---

## 📥 Descărcare și instalare

Mergi la pagina **[Releases](https://github.com/AdventTools/AdventShow/releases/latest)** și descarcă fișierul potrivit platformei tale:

| Platformă | Fișier |
|-----------|--------|
| **Windows** | `AdventShow-Windows-...-Setup.exe` |
| **macOS** | `AdventShow-Mac-...-Installer.dmg` |
| **Linux** | `AdventShow-Linux-....AppImage` |

> 💡 La prima pornire, aplicația creează automat baza de date cu toate imnurile și Biblia Cornilescu. Nu trebuie să imporți nimic manual.

### ⚠️ Aplicația nu este semnată digital

AdventShow este distribuit gratuit și nu deține un certificat de semnare. Sistemele de operare pot afișa un avertisment la prima rulare.

#### Windows
1. Installerul importă automat certificatul AdventShow — în majoritatea cazurilor, SmartScreen nu va mai apărea
2. Dacă totuși apare mesajul **„Windows protected your PC"**, apasă **„More info"** apoi **„Run anyway"**
3. Acest pas este necesar doar la prima instalare

#### macOS
1. Deschide fișierul `.dmg` și trage aplicația în **Applications**
2. La prima deschidere, macOS va afișa un mesaj că aplicația nu poate fi deschisă
3. Mergi la **System Settings → Privacy & Security**
4. În secțiunea de jos vei vedea mesajul despre AdventShow — apasă **„Open Anyway"**
5. Alternativ: clic dreapta pe aplicație → **Open** → **Open**

#### Linux
1. Fă fișierul executabil: `chmod +x AdventShow-Linux-*.AppImage`
2. Rulează-l: `./AdventShow-Linux-*.AppImage`

---

## ✨ Funcționalități

### 🎵 Imnuri Creștine
- **922 de imnuri** din colecția „Imnuri Creștine", organizate pe categorii
- Fiecare imn are strofe și refren clar delimitate
- Căutare instantanee după **număr**, **titlu** sau **cuvinte din text**
- Previzualizare text complet pe un singur rând pentru fiecare imn din listă
- Import suplimentar din fișiere PowerPoint (`.pptx`)
- Editor integrat — adaugă, editează, reordonează strofe și refrene

### 📖 Biblia Cornilescu
- **66 de cărți**, **31.102 versete** — Biblia Cornilescu completă
- Navigare pe cărți → capitole → versete, cu capitolele mereu vizibile la selectarea unui capitol
- Căutare inteligentă: tastezi `gen 1`, `ps 23`, `1cor 13 4-7` și se încarcă direct
- Căutare în text se declanșează la **Enter** (nu în timp real), fără limită de rezultate
- Proiecție cu text mare și referința versetului afișată dedesubt

### 🖥️ Proiecție pe ecran secundar
- Proiecție fullscreen pe monitorul secundar
- Fundal configurabil: **culoare solidă**, **imagine** sau **video**, cu opacitate reglabilă
- Font reglabil (60% – 200%), uniform pe toate strofele unui imn
- Culori personalizabile pentru numărul imnului și text
- Navigare între strofe cu **săgeți** sau **clic**
- Indicatori de poziție în partea de jos a ecranului

### 🎬 Redare Video
- Redă fișiere video direct pe ecranul de proiecție (**MP4**, **WebM**, **MOV**, **MKV**, **AVI**)
- Conversie automată a formatelor nesuportate (MKV, AVI) în MP4 via FFmpeg
- **Previzualizare video sincronizată** — videoul rulează simultan în panoul de previzualizare (muted) și pe proiecție
- Controale: play, pauză, stop, bară de progres, volum
- Selectare ieșire audio din Setări
- **Suport YouTube** — lipește un link YouTube și se redă direct pe proiecție (necesită yt-dlp, se instalează din Setări)

### 🔄 Altele
- **Layout redimensionabil** — marginile dintre coloane (sidebar, conținut, previzualizare) se trag cu mouse-ul; pozițiile se salvează automat
- **Verificare actualizări** — la pornire, aplicația verifică dacă există o versiune nouă și afișează un buton de descărcare
- **Schimbare fluidă** — treci de la un imn la altul fără a opri proiecția
- **Memorie fereastră** — poziția și dimensiunea ferestrei se rețin între sesiuni
- **Previne hibernarea** — PC-ul nu intră în sleep cât timp aplicația e pornită
- **Import/Export** backup JSON
- **Meniu contextual** — clic dreapta pe imn pentru editare, ștergere, schimbare categorie

---

## ⌨️ Scurtături tastatură

| Tastă | Acțiune |
|-------|---------|
| `Enter` | Încarcă în previzualizare / Proiectează |
| `Escape` | Oprește proiecția / Curăță previzualizare |
| `↑` `↓` | Navighează lista imnuri / secțiuni |
| `←` `→` | Navighează între strofe în proiecție |
| `/` | Focus pe câmpul de căutare |

---

## 🔎 Căutare Biblie — Exemple

| Tastezi | Rezultat |
|---------|----------|
| `gen 1` | Geneza capitolul 1 |
| `ps 23` | Psalmul 23 |
| `1cor 13 4-7` | 1 Corinteni 13:4-7 |
| `deu 6 4` | Deuteronom 6:4 |
| `ioa 3 16` | Ioan 3:16 |

---

## 👥 Despre

**AdventShow** este dezvoltat și distribuit **gratuit** de:

- **Ovidius Zanfir** — autor original, interfață
- **Samy Balasa** — redare video, YouTube, auto-update, funcționalități noi, corecții

Organizație: [**AdventTools**](https://github.com/AdventTools)

Biblia Cornilescu — text în domeniu public.

---

## 📋 Changelog

Vezi [CHANGELOG.md](CHANGELOG.md) pentru istoricul modificărilor.
