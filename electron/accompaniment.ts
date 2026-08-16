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
const TIMEOUT_MS = 15000

/** `[index_slide, sfârșit_ms, reintrare_ms]` — vezi §8 din planul de sincronizare. */
export type SyncMark = [number, number, number]

export interface SyncFile {
  v: number
  /** Cheia e numărul imnului, ca text. */
  h: Record<string, SyncMark[]>
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
      fs.writeFileSync(path.join(deps.userDataDir, SYNC_CACHE), JSON.stringify(s), 'utf-8')
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

export function marksFor(sync: SyncFile | null, numar: number): SyncMark[] | null {
  if (!sync) return null
  const m = sync.h[String(numar)]
  return Array.isArray(m) && m.length ? m : null
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
    let scris = 0
    const reader = res.body.getReader()
    for (;;) {
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
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve())
      out.on('error', reject)
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
): Promise<{ ok: number; esuate: number; oprit: boolean }> {
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
    const rez = await downloadOne(deps, manifest, item, (n, p) => {
      onProgress(idx, lipsa.length, n, p)
    })
    if (rez) ok++
    else esuate++
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
