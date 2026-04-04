# Proiecție Imnuri

Aplicație desktop pentru proiecția imnurilor și versetelor biblice în biserică.

Built cu Electron + React + TypeScript. Biblia Cornilescu integrată (66 cărți, 31.102 versete).

![screenshot](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![version](https://img.shields.io/badge/version-1.0.0-green)

---

## Descărcare

Installerele sunt disponibile în [**Releases**](../../releases/tag/v1.0.0):

| Platformă | Fișier |
|-----------|--------|
| Windows   | `Proiectie-Imnuri-Windows-1.0.0-Setup.exe` |
| macOS     | `Proiectie-Imnuri-Mac-1.0.0-Installer.dmg` |

---

## Funcționalități principale

- **922 imnuri** din „Imnuri Creștine", organizate pe categorii
- **Biblia Cornilescu** completă — căutare inteligentă stil BibleShow
- **Proiecție pe ecran secundar** — fullscreen, fundal configurabil (culoare / imagine / video)
- **Flux rapid de tastatură**: caută → Enter (previzualizare) → Enter (proiectează) → Escape (oprește)
- **Navigare cu săgeți** prin strofe, refrene și versete
- **Schimbare fluidă** — poți trece de la un imn la altul fără a opri proiecția
- **Panou previzualizare** cu etichete „Strofa N" / „Refren" colorate
- **Editor imnuri** — adaugă, editează, reordonează strofe și refrene
- **Meniu contextual** — clic dreapta pe imn pentru editare, ștergere, schimbare categorie
- **Sistem parolă** admin pentru operații destructive
- **Import/Export** backup JSON
- **Memorie fereastră** — poziția și dimensiunea se rețin între sesiuni
- **Font proiecție reglabil** (60%–200%)

## Scurtături tastatură

| Tastă | Acțiune |
|-------|---------|
| `Enter` | Încarcă în previzualizare / Proiectează |
| `Escape` | Oprește proiecția / Curăță previzualizare |
| `↑` `↓` | Navighează lista imnuri / secțiuni |
| `/` | Focus pe câmpul de căutare |
| `Ctrl +/-` | Zoom proiecție |

## Căutare Biblie

Tastezi direct în câmpul de căutare (tab-ul Biblia):

```
gen 1         → Geneza capitolul 1
ps 23         → Psalmul 23
1cor 13 4-7   → 1 Corinteni 13:4-7
deu 6 4       → Deuteronom 6:4
```

---

## Dezvoltare

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

Installerele apar în `release/1.0.0/`.

### Structura proiectului

```
electron/          Main process (Electron)
  main.ts          Fereastra principală, IPC handlers, proiecție
  db.ts            Acces SQLite (imnuri + Biblie)
  preload.ts       Bridge IPC tipizat
  import.ts        Import PPT/PPTX
src/               Renderer (React)
  App.tsx          Componenta principală (3 coloane)
  App.css          Stiluri complete
  ProjectionPage   Fereastra de proiecție
  SearchPage       Pagina de căutare
  AdminPage        Setări admin
public/
  hymns.db         Baza de date seed (922 imnuri)
scripts/
  cornilescu.json  Biblia Cornilescu (auto-import la prima pornire)
```

---

## Credite

- Autor original: [Ovidius S Zanfir](https://github.com/ovidiuszanfir)
- Fork și rescrierea UI/Bible: [Samy Balasa](https://github.com/samybalasa)
- Biblia Cornilescu — text în domeniu public
