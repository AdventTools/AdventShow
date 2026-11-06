// ═════════════════════════════════════════════════════════════════════════════
// Acompaniament instrumental — descărcare la cerere din hangar
//
// Câte un MP3 per imn (922 fișiere, ~3,4 GB în total). NU se împachetează în
// installer: se descarcă la cerere, iar ce s-a descărcat o dată rămâne.
//
// REGULA modulului, aceeași ca la hangar.ts: nimic de aici nu blochează
// pornirea, proiecția sau închiderea. Fără internet totul tace, iar butonul
// de acompaniament rămâne pur și simplu gri.
//
// STAREA E FOLDERUL. Nu ținem un index paralel cu ce s-a descărcat — un fișier
// e „prezent" dacă există pe disc cu mărimea din manifest. Un index separat ar
// putea ajunge să mintă (ștergere manuală, sincronizare, disc plin), iar o
// minciună aici înseamnă un buton care promite sunet și livrează tăcere.
// ═════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs'
import path from 'node:path'
import { HANGAR_FEED_URL } from './hangar'

/** Manifestul publicat de hangar prin `content:put`. */
export const ACCOMPANIMENT_MANIFEST_URL = `${HANGAR_FEED_URL}audio.json`
/** Marcajele de sincronizare — doar imnurile APROBATE de autor ajung aici. */
export const SYNC_URL = `${HANGAR_FEED_URL}sync.json`

const MANIFEST_CACHE = 'acompaniament-manifest.json'
const SYNC_CACHE = 'acompaniament-sync.json'
/**
 * Marcajele făcute cu mâna, în panoul de administrare.
 *
 * Fișier SEPARAT de cache-ul feed-ului, nu o scriere peste el: altfel prima
 * publicare de marcaje de pe server ar șterge munca omului care tocmai le-a
 * marcat. Localul are prioritate — cine a marcat aici știe mai bine decât ce
 * a ghicit detectorul.
 */
const SYNC_LOCAL = 'acompaniament-sync-local.json'
const TIMEOUT_MS = 15000

const SYNC_META = 'acompaniament-sync-meta.json'

/**
 * `[index_slide, sfârșit_ms, reintrare_ms]` — vezi §8 din planul de sincronizare.
 * `index_slide = -1` e preludiul: sfârșitul lui e clipa în care începe cântarea.
 */
export type SyncMark = [number, number, number]

/** Înregistrarea nu se potrivește cu textul: pianul cântă mai puțin (`short`) sau mai mult (`long`). */
export interface SyncWarning {
  kind: 'short' | 'long'
  /** Câte tururi cântă înregistrarea. */
  audio: number
  /** Câte strofe are textul. */
  text: number
}

export interface SyncFile {
  v: number
  /** Cheia e numărul imnului, ca text. */
  h: Record<string, SyncMark[]>
  /** Forma imnului pentru care s-au făcut marcajele: o literă pe slide, `S` sau `R`. */
  f?: Record<string, string>
  w?: Record<string, SyncWarning>
  /** Sfârșitul preludiului, când hangarul îl ține lângă `h`, nu în el. */
  p?: Record<string, number>
}

/** Ce s-a întâmplat cu marcajele unui imn făcute pe calculatorul ăsta. */
export interface LocalSyncInfo {
  /** Secunde Unix; e și cheia de idempotență a trimiterii în hangar. */
  at: number
  /** Apăsările omului, înainte de lipirea de liniște. */
  raw?: number[]
  sent?: boolean
  /** Hangarul a refuzat trimiterea (`422 form` etc.); nu se mai retrimite. */
  error?: string
}

export interface LocalSyncFile extends SyncFile {
  m?: Record<string, LocalSyncInfo>
}

/** Marcajele pe care le folosește redarea pentru un imn, cu tot ce trebuie știut despre ele. */
export interface HymnSync {
  marks: SyncMark[]
  form: string | null
  warn: SyncWarning | null
  source: 'local' | 'hangar'
}

export interface AccompanimentItem {
  /** Numărul imnului, nepadat (2, nu „002") — vezi seed-numbers-unpadded. */
  n: number
  /** Numele fișierului pe server: „001.mp3". */
  f: string
  bytes: number
  sha256: string
  /** Durata, în milisecunde. */
  ms: number
}

export interface AccompanimentManifest {
  format: string
  revision: number
  /** URL absolut. Vine din manifest ca stocarea să se poată muta fără versiune nouă. */
  base: string
  count: number
  items: AccompanimentItem[]
}

export interface AccompanimentDeps {
  userDataDir: string
  /** `settings.accompanimentFolder`, dacă utilizatorul a ales altul. */
  getFolder: () => string | undefined
  log: (...args: unknown[]) => void
}

export interface AccompanimentStats {
  /** Câte fișiere sunt pe disc. */
  have: number
  /** Câte are manifestul. */
  total: number
  /** Octeți ocupați local. */
  bytes: number
  /** Octeți dacă s-ar descărca tot. */
  totalBytes: number
  folder: string
  revision: number | null
}

// ─────────────────────────────────────────────────────────────────── folder ──

/** Folderul de acompaniamente. Implicit în userData, sau cel ales în Setări. */
export function accompanimentDir(deps: AccompanimentDeps): string {
  const ales = deps.getFolder()
  if (ales && ales.trim()) {
    try {
      fs.mkdirSync(ales, { recursive: true })
      return ales
    } catch {
      // Folderul ales nu mai e scriibil (stick scos, cale de rețea căzută).
      // Cădem pe cel implicit în loc să oprim funcția.
    }
  }
  const implicit = path.join(deps.userDataDir, 'acompaniament')
  try {
    fs.mkdirSync(implicit, { recursive: true })
  } catch {
    /* îl încercăm oricum la scriere */
  }
  return implicit
}

export function localPath(deps: AccompanimentDeps, item: AccompanimentItem): string {
  return path.join(accompanimentDir(deps), item.f)
}

/** Un fișier e „prezent" doar dacă are exact mărimea din manifest. */
export function isPresent(deps: AccompanimentDeps, item: AccompanimentItem): boolean {
  try {
    return fs.statSync(localPath(deps, item)).size === item.bytes
  } catch {
    return false
  }
}

// ───────────────────────────────────────────────────────────────── manifest ──

function manifestCachePath(deps: AccompanimentDeps): string {
  return path.join(deps.userDataDir, MANIFEST_CACHE)
}

export function cachedManifest(deps: AccompanimentDeps): AccompanimentManifest | null {
  try {
    const raw = fs.readFileSync(manifestCachePath(deps), 'utf-8')
    const m = JSON.parse(raw) as AccompanimentManifest
    return Array.isArray(m?.items) && m.items.length ? m : null
  } catch {
    return null
  }
}

/**
 * Aduce manifestul de pe hangar. La orice eșec întoarce copia locală, dacă
 * există — funcția trebuie să meargă offline pentru fișierele deja descărcate.
 */
export async function refreshManifest(
  deps: AccompanimentDeps,
): Promise<AccompanimentManifest | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    const res = await fetch(ACCOMPANIMENT_MANIFEST_URL, { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const m = (await res.json()) as AccompanimentManifest
    if (!Array.isArray(m?.items) || !m.items.length) throw new Error('manifest gol')
    try {
      fs.writeFileSync(manifestCachePath(deps), JSON.stringify(m), 'utf-8')
    } catch {
      /* nu putem scrie cache-ul — mergem mai departe cu ce am adus */
    }
    deps.log('[Acompaniament] Manifest r' + m.revision + ',', m.items.length, 'imnuri')
    return m
  } catch (e) {
    deps.log('[Acompaniament] Manifest indisponibil:', (e as Error).message)
    return cachedManifest(deps)
  }
}

// ───────────────────────────────────────────────── marcaje de sincronizare ──

export function cachedSync(deps: AccompanimentDeps): SyncFile | null {
  try {
    const s = JSON.parse(
      fs.readFileSync(path.join(deps.userDataDir, SYNC_CACHE), 'utf-8')) as SyncFile
    return s && typeof s.h === 'object' ? s : null
  } catch {
    return null
  }
}

/**
 * Aduce marcajele publicate. Fișierul lipsește cât timp autorul n-a aprobat
 * nimic — 404 e o stare normală, nu o eroare, și nu trebuie să se vadă nicăieri.
 */
export async function refreshSync(deps: AccompanimentDeps): Promise<SyncFile | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    const res = await fetch(SYNC_URL, { signal: ctrl.signal })
    clearTimeout(t)
    if (res.status === 404) {
      const c = cachedSync(deps)
      deps.log('[Acompaniament] Marcaje: niciunul publicat pe server;',
        c ? `folosesc ${Object.keys(c.h).length} din cache` : 'nici în cache')
      return c
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const s = (await res.json()) as SyncFile
    if (!s || typeof s.h !== 'object') throw new Error('fișier de marcaje nevalid')
    try {
      const nou = JSON.stringify(s)
      let vechi = ''
      try { vechi = fs.readFileSync(path.join(deps.userDataDir, SYNC_CACHE), 'utf-8') } catch { /* primul */ }
      if (nou !== vechi) {
        fs.writeFileSync(path.join(deps.userDataDir, SYNC_CACHE), nou, 'utf-8')
        fs.writeFileSync(path.join(deps.userDataDir, SYNC_META),
          JSON.stringify({ changedAt: Math.floor(Date.now() / 1000) }), 'utf-8')
      }
    } catch {
      /* fără cache — mergem cu ce am adus */
    }
    deps.log('[Acompaniament] Marcaje pentru', Object.keys(s.h).length, 'imnuri')
    return s
  } catch (e) {
    deps.log('[Acompaniament] Marcaje indisponibile:', (e as Error).message)
    return cachedSync(deps)
  }
}

/** Când s-a schimbat ultima oară fișierul publicat, în secunde Unix; 0 dacă niciodată. */
export function syncChangedAt(deps: AccompanimentDeps): number {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(deps.userDataDir, SYNC_META), 'utf-8'))
    return Number(m?.changedAt) || 0
  } catch {
    return 0
  }
}

/** Marcajele publicate ale unui imn, cu preludiul pus la locul lui dacă vine separat. */
function publishedMarks(sync: SyncFile, k: string): SyncMark[] | null {
  const m = sync.h[k]
  if (!Array.isArray(m) || !m.length) return null
  const p = sync.p?.[k]
  if (typeof p === 'number' && m[0][0] !== -1) return [[-1, p, p], ...m]
  return m
}

/**
 * Ce marcaje folosește redarea: cele făcute aici sau cele publicate.
 *
 * Localul câștigă cât timp e munca nouă a omului de la calculatorul ăsta: încă
 * netrimisă, sau trimisă după ultima publicare. Odată ce hangarul publică după
 * trimitere, varianta aprobată acolo e cea bună — altfel o corectură publicată
 * n-ar mai ajunge niciodată la cine a marcat cândva imnul.
 */
export function syncFor(
  local: LocalSyncFile, pub: SyncFile | null, pubChangedAt: number, numar: number,
): HymnSync | null {
  const k = String(numar)
  const lm = local.h[k]
  const info = local.m?.[k]
  const pm = pub ? publishedMarks(pub, k) : null
  const warn = pub?.w?.[k] ?? null
  if (Array.isArray(lm) && lm.length && (!pm || !info?.sent || info.at > pubChangedAt)) {
    return { marks: lm, form: local.f?.[k] ?? null, warn, source: 'local' }
  }
  if (pm) return { marks: pm, form: pub?.f?.[k] ?? null, warn, source: 'hangar' }
  return null
}

// ─────────────────────────────────────────────── marcaje făcute cu mâna ──

export function localMarks(deps: AccompanimentDeps): LocalSyncFile {
  try {
    const s = JSON.parse(
      fs.readFileSync(path.join(deps.userDataDir, SYNC_LOCAL), 'utf-8')) as LocalSyncFile
    if (s && typeof s.h === 'object') return s
  } catch {
    /* încă niciunul */
  }
  return { v: 1, h: {} }
}

function writeLocal(deps: AccompanimentDeps, f: LocalSyncFile): void {
  fs.writeFileSync(path.join(deps.userDataDir, SYNC_LOCAL), JSON.stringify(f), 'utf-8')
}

/**
 * Scrie marcajele unui imn. `null` le șterge, ca imnul să revină la ce spune
 * feed-ul (sau la nimic).
 *
 * Se scriu întregi, nu incremental: fișierul e mic, iar o scriere parțială
 * întreruptă ar lăsa un imn cu jumătate de marcaje — mai rău decât fără.
 * Preludiul (`-1`) poate fi doar primul în timp; restul se numără de la 0.
 * Orice salvare e o trimitere nouă, încă neplecată în hangar.
 */
export function setLocalMarks(
  deps: AccompanimentDeps, numar: number, marks: SyncMark[] | null,
  extra: { form?: string | null; raw?: number[] } = {},
): number {
  const f = localMarks(deps)
  const k = String(numar)
  if (marks && marks.length) {
    const sortate = [...marks].sort((a, b) => a[1] - b[1])
    const cuPreludiu = sortate[0][0] === -1
    f.h[k] = sortate.map(([, sfarsit, reintrare], i) =>
      [cuPreludiu ? i - 1 : i, Math.round(sfarsit), Math.round(Math.max(sfarsit, reintrare))])
    if (extra.form) (f.f ??= {})[k] = extra.form
    else if (f.f) delete f.f[k]
    let at = Math.floor(Date.now() / 1000)
    // Două salvări în aceeași secundă ar avea aceeași cheie în hangar și a doua s-ar pierde.
    if (f.m?.[k] && f.m[k].at >= at) at = f.m[k].at + 1
    ;(f.m ??= {})[k] = {
      at,
      ...(extra.raw?.length ? { raw: extra.raw.map(Math.round) } : {}),
      sent: false,
    }
  } else {
    delete f.h[k]
    if (f.f) delete f.f[k]
    if (f.m) delete f.m[k]
  }
  writeLocal(deps, f)
  return Object.keys(f.h).length
}

/** Rezultatul unei trimiteri. Se scrie doar dacă între timp nu s-a salvat altceva peste. */
export function markLocalSent(
  deps: AccompanimentDeps, numar: number, at: number, rezultat: { ok: true } | { ok: false; error: string },
): void {
  const f = localMarks(deps)
  const info = f.m?.[String(numar)]
  if (!info || info.at !== at) return
  if (rezultat.ok) { info.sent = true; delete info.error }
  else info.error = rezultat.error
  writeLocal(deps, f)
}

/** Ce așteaptă să plece în hangar: salvat, netrimis, nerefuzat. */
export function pendingLocal(deps: AccompanimentDeps): {
  n: number; form: string | null; marks: SyncMark[]; raw: number[]; at: number
}[] {
  const f = localMarks(deps)
  return Object.entries(f.m ?? {})
    .filter(([k, info]) => !info.sent && !info.error && Array.isArray(f.h[k]) && f.h[k].length)
    .map(([k, info]) => ({
      n: Number(k), form: f.f?.[k] ?? null, marks: f.h[k], raw: info.raw ?? [], at: info.at,
    }))
    .filter(x => Number.isFinite(x.n))
}

export function findItem(
  manifest: AccompanimentManifest | null,
  numar: number,
): AccompanimentItem | null {
  if (!manifest) return null
  return manifest.items.find(i => i.n === numar) ?? null
}

/**
 * Numărul imnului dintr-un „number" din baza de date. Baza ține numerele
 * nepadate, dar au trecut prin padare la prima pornire — acceptăm ambele forme,
 * plus sufixe („664a"), la care numărul de bază e tot ce ne interesează.
 */
export function hymnNumberToInt(number: string | number | null | undefined): number | null {
  if (number === null || number === undefined) return null
  const m = String(number).match(/\d+/)
  if (!m) return null
  const n = parseInt(m[0], 10)
  return Number.isFinite(n) ? n : null
}

// ────────────────────────────────────────────────────────────────── descărcare ──

export type ProgressFn = (numar: number, procent: number, octeti: number) => void

/**
 * Descarcă un singur fișier. Scrie într-un `.part` și redenumește doar după ce
 * mărimea se potrivește — altfel o descărcare întreruptă ar lăsa în urmă un
 * fișier care „există" și pare bun, iar imnul ar cânta trunchiat în biserică.
 */
export async function downloadOne(
  deps: AccompanimentDeps,
  manifest: AccompanimentManifest,
  item: AccompanimentItem,
  onProgress?: ProgressFn,
  signal?: AbortSignal,
): Promise<string | null> {
  const dest = localPath(deps, item)
  if (isPresent(deps, item)) return dest

  const part = dest + '.part'
  const url = manifest.base + item.f
  try {
    const res = await fetch(url, { signal })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

    const out = fs.createWriteStream(part)
    // Ascultătorul se atașează ÎNAINTE de buclă: dacă discul se umple în timpul
    // scrierii, evenimentul 'error' e emis asincron — fără ascultător aici,
    // Node îl aruncă drept excepție necaptată în procesul main și crapă aplicația.
    let streamError: Error | null = null
    out.on('error', (err) => { streamError = err })

    let scris = 0
    const reader = res.body.getReader()
    for (;;) {
      if (streamError) throw streamError
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        out.write(Buffer.from(value))
        scris += value.byteLength
        if (onProgress && item.bytes > 0) {
          onProgress(item.n, Math.min(100, Math.round((scris / item.bytes) * 100)), scris)
        }
      }
    }
    if (streamError) throw streamError
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve())
      out.once('error', reject)
    })

    if (fs.statSync(part).size !== item.bytes) {
      throw new Error(`mărime greșită: ${fs.statSync(part).size} în loc de ${item.bytes}`)
    }
    fs.renameSync(part, dest)
    onProgress?.(item.n, 100, item.bytes)
    return dest
  } catch (e) {
    try {
      fs.unlinkSync(part)
    } catch {
      /* nu exista */
    }
    deps.log('[Acompaniament] Eșec la imnul', item.n + ':', (e as Error).message)
    if ((e as NodeJS.ErrnoException).code === 'ENOSPC') {
      const discPlin = new Error('disc plin') as NodeJS.ErrnoException
      discPlin.code = 'ENOSPC'
      throw discPlin
    }
    return null
  }
}

/**
 * Descarcă tot ce lipsește, unul câte unul.
 *
 * Se oprește între fișiere dacă `isCancelled`, și AȘTEAPTĂ cât timp `isBusy`
 * (proiecția pe ecran): un serviciu în desfășurare are nevoie de internetul
 * bisericii mai mult decât are nevoie descărcarea să se termine azi.
 */
export async function downloadMissing(
  deps: AccompanimentDeps,
  manifest: AccompanimentManifest,
  onProgress: (facute: number, total: number, numar: number, procent: number) => void,
  isCancelled: () => boolean,
  isBusy: () => boolean = () => false,
): Promise<{ ok: number; esuate: number; oprit: boolean; discPlin?: boolean }> {
  const lipsa = manifest.items.filter(i => !isPresent(deps, i))
  let ok = 0
  let esuate = 0
  for (let idx = 0; idx < lipsa.length; idx++) {
    if (isCancelled()) return { ok, esuate, oprit: true }
    while (isBusy()) {
      if (isCancelled()) return { ok, esuate, oprit: true }
      await new Promise(r => setTimeout(r, 2000))
    }
    const item = lipsa[idx]
    try {
      const rez = await downloadOne(deps, manifest, item, (n, p) => {
        onProgress(idx, lipsa.length, n, p)
      })
      if (rez) ok++
      else esuate++
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOSPC') {
        deps.log('[Acompaniament] Disc plin — descărcarea s-a oprit după', item.n)
        return { ok, esuate, oprit: false, discPlin: true }
      }
      esuate++
    }
  }
  return { ok, esuate, oprit: false }
}

export function stats(
  deps: AccompanimentDeps,
  manifest: AccompanimentManifest | null,
): AccompanimentStats {
  const folder = accompanimentDir(deps)
  if (!manifest) {
    return { have: 0, total: 0, bytes: 0, totalBytes: 0, folder, revision: null }
  }
  let have = 0
  let bytes = 0
  let totalBytes = 0
  for (const item of manifest.items) {
    totalBytes += item.bytes
    if (isPresent(deps, item)) {
      have++
      bytes += item.bytes
    }
  }
  return { have, total: manifest.items.length, bytes, totalBytes, folder, revision: manifest.revision }
}

/** Numerele de imn care au fișierul pe disc — pentru ♪ din listă. */
export function presentNumbers(
  deps: AccompanimentDeps,
  manifest: AccompanimentManifest | null,
): number[] {
  if (!manifest) return []
  return manifest.items.filter(i => isPresent(deps, i)).map(i => i.n)
}

/** Șterge tot ce s-a descărcat. Folosit din Setări, ca să se poată elibera spațiu. */
export function removeAll(deps: AccompanimentDeps): number {
  const dir = accompanimentDir(deps)
  let sterse = 0
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.toLowerCase().endsWith('.mp3')) continue
      try {
        fs.unlinkSync(path.join(dir, f))
        sterse++
      } catch {
        /* fișier blocat — sărim peste */
      }
    }
  } catch {
    /* folderul nu există */
  }
  return sterse
}
