# AdventShow

**Aplicație gratuită și open-source pentru proiecția imnurilor și versetelor biblice în biserici.**

Construită cu Electron + React + TypeScript. Include Biblia Cornilescu completă (66 cărți, 31.102 versete) și 922 de imnuri din „Imnuri Creștine".

![platform](https://img.shields.io/badge/platforme-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![version](https://img.shields.io/badge/versiune-1.1.1-green)
![license](https://img.shields.io/badge/licență-gratuită-brightgreen)

---

## 📥 Descărcare și instalare

1. Mergi la pagina **[Releases](https://github.com/AdventTools/AdventShow/releases/latest)**
2. Descarcă fișierul potrivit platformei tale din tabelul de mai jos
3. Instalează și rulează aplicația

| Platformă | Fișier de descărcat |
|-----------|---------------------|
| **Windows** | [`AdventShow-Windows-1.1.1-Setup.exe`](https://github.com/AdventTools/AdventShow/releases/latest) |
| **macOS** | [`AdventShow-Mac-1.1.1-Installer.dmg`](https://github.com/AdventTools/AdventShow/releases/latest) |
| **Linux** | [`AdventShow-Linux-1.1.1.AppImage`](https://github.com/AdventTools/AdventShow/releases/latest) |

> 💡 La prima pornire, aplicația creează automat baza de date cu toate imnurile și Biblia Cornilescu. Nu trebuie să imporți nimic manual.

### ⚠️ Aplicația nu este semnată digital

AdventShow este distribuit gratuit și nu deține un certificat de semnare. Sistemele de operare pot afișa un avertisment la prima rulare. Iată cum procedezi:

#### Windows
1. La mesajul **„Windows protected your PC"** (SmartScreen), apasă **„More info"** (Mai multe informații)
2. Apoi apasă **„Run anyway"** (Rulează oricum)
3. Acest pas este necesar doar la prima instalare

#### macOS
1. Deschide fișierul `.dmg` și trage aplicația în **Applications**
2. La prima deschidere, macOS va afișa **„AdventShow can't be opened because it is from an unidentified developer"**
3. Mergi la **System Settings → Privacy & Security** (Setări sistem → Confidențialitate și securitate)
4. În secțiunea de jos vei vedea mesajul despre AdventShow — apasă **„Open Anyway"** (Deschide oricum)
5. Alternativ: clic dreapta pe aplicație → **Open** → **Open** (funcționează din prima)

#### Linux
1. Fă fișierul executabil: `chmod +x AdventShow-Linux-*.AppImage`
2. Rulează-l: `./AdventShow-Linux-*.AppImage`

---

## ✨ Ce face această aplicație

AdventShow este un instrument complet de proiecție pentru biserică, gândit să fie simplu, rapid și să funcționeze fără internet.

### 🎵 Imnuri Creștine
- **922 de imnuri** din colecția „Imnuri Creștine", organizate pe categorii
- Fiecare imn are strofe și refren clar delimitate
- Căutare instantanee după **număr**, **titlu** sau **cuvinte din text**
- Import suplimentar din fișiere PowerPoint (`.pptx`)
- Editor integrat — adaugă, editează, reordonează strofe și refrene

### 📖 Biblia Cornilescu
- **66 de cărți**, **31.102 versete** — Biblia Cornilescu completă
- Navigare pe cărți → capitole → versete
- Căutare inteligentă: tastezi `gen 1`, `ps 23`, `1cor 13 4-7` și se încarcă direct
- Proiecție cu text mare și referința versetului afișată dedesubt

### 🖥️ Proiecție pe ecran secundar
- Proiecție fullscreen pe monitorul secundar (sau pe orice ecran ales)
- Fundal configurabil: **culoare solidă**, **imagine** sau **video**, cu opacitate reglabilă
- Font proiecție reglabil (60% – 200%)
- Culori personalizabile pentru numărul imnului și text
- Navigare fluidă între strofe cu **săgeți** sau **clic**
- Indicatori de poziție albi, vizibili, în partea de jos a ecranului

### ⌨️ Flux rapid de tastatură
- **Enter (1×)** — încarcă primul rezultat din căutare în previzualizare
- **Enter (2×)** — proiectează imnul sau versetul
- **Escape (1×)** — oprește proiecția
- **Escape (2×)** — curăță previzualizarea și focus pe câmpul de căutare
- **Săgeți ↑↓** — navighează prin lista de imnuri sau secțiuni proiectate
- **/** — focus rapid pe câmpul de căutare

### 🔄 Funcții suplimentare
- **Schimbare fluidă** — treci de la un imn la altul fără a opri proiecția
- **Memorie fereastră** — poziția și dimensiunea ferestrei se rețin între sesiuni
- **Previne hibernarea** — laptopul/PC-ul nu intră în sleep cât timp aplicația e pornită
- **Import/Export** backup JSON pentru baza de date
- **Sistem parolă** admin pentru operații destructive (ștergere date)
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
| `↑` `↓` (în proiecție) | Zoom text proiecție |

---

## 🔎 Căutare Biblie — Exemple

Tastezi direct în câmpul de căutare (tab-ul Biblia):

| Tastezi | Rezultat |
|---------|----------|
| `gen 1` | Geneza capitolul 1 |
| `ps 23` | Psalmul 23 |
| `1cor 13 4-7` | 1 Corinteni 13:4-7 |
| `deu 6 4` | Deuteronom 6:4 |
| `ioa 3 16` | Ioan 3:16 |

---

## 🛠️ Dezvoltare

### Cerințe
- Node.js 18+
- npm 9+

### Instalare dependențe
```bash
npm install
```

### Mod dezvoltare
```bash
npm run dev
```

### Build producție
```bash
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

Installerele apar în `release/<versiune>/`.

### Structura proiectului

```
electron/             Main process (Electron)
  main.ts             Fereastra principală, IPC handlers, proiecție, keep-alive
  db.ts               Acces SQLite (imnuri + Biblie)
  preload.ts          Bridge IPC tipizat
  import.ts           Import PPT/PPTX
src/                  Renderer (React)
  App.tsx             Componenta principală (3 coloane)
  App.css             Stiluri complete
  ProjectionPage.tsx  Fereastra de proiecție fullscreen
  ProjectorController.tsx  Controller navigare proiecție
public/
  hymns.db            Baza de date seed (922 imnuri)
scripts/
  cornilescu.json     Biblia Cornilescu (auto-import la prima pornire)
```

---

## 👥 Despre

**AdventShow** este dezvoltat și distribuit **gratuit** de:

- **Ovidius Zanfir** — autor original, structura aplicației
- **Samy Balasa** — rescrierea interfeței, integrare Biblie, funcționalități noi

Organizație: [**AdventTools**](https://github.com/AdventTools)
Cod sursă: [**github.com/AdventTools/AdventShow**](https://github.com/AdventTools/AdventShow)

Biblia Cornilescu — text în domeniu public.

---

## 📋 Changelog

Vezi [CHANGELOG.md](CHANGELOG.md) pentru istoricul complet al modificărilor.
