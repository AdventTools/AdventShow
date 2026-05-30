import { app, BrowserWindow, dialog, ipcMain, net, powerSaveBlocker, protocol, screen, shell } from 'electron'
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  addSection,
  clearAllData,
  createCategory,
  createHymnWithSections,
  deleteCategory,
  deleteHymn,
  deleteSection,
  exportJsonBackup,
  getAllHymns,
  getAllHymnsWithSnippets,
  getCategories,
  getHymnByNumber,
  getHymnWithSections,
  importJsonBackup,
  initDB,
  reorderSections,
  searchHymns,
  searchHymnsContent,
  updateCategory,
  updateHymn,
  updateHymnCategory,
  updateHymnWithSections,
  updateSection,
  getBibleBooks,
  getBibleChapters,
  getBibleVerses,
  searchBible,
  getBibleVerseRange,
  hasBibleData,
  seedBibleFromJson,
  syncSeedCorrections,
} from './db'
import { importPresentationDirectory, importPresentationFiles } from './import'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null
let projectionWin: BrowserWindow | null = null

// Promise that resolves when the projection renderer signals it's ready
let projectionReadyResolve: (() => void) | null = null
let projectionReadyPromise: Promise<void> | null = null

function resetProjectionReady() {
  projectionReadyPromise = new Promise<void>((resolve) => {
    projectionReadyResolve = resolve
  })
}

function waitForProjectionReady(): Promise<void> {
  if (!projectionReadyPromise) resetProjectionReady()
  return projectionReadyPromise!
}

// ── App settings ──────────────────────────────────────────────────────────────

interface AppSettings {
  projectionDisplayId?: number
  bgType?: 'color' | 'image' | 'video'
  bgColor?: string
  bgImagePath?: string
  bgVideoPath?: string
  bgOpacity?: number
  hymnNumberColor?: string
  contentTextColor?: string
  adminPasswordHash?: string
  projectionFontSize?: number
  audioOutputDeviceId?: string
  debugLog?: boolean
  downloadFolder?: string  // custom folder for YouTube downloads
  windowBounds?: { x: number; y: number; width: number; height: number }
  sidebarWidth?: number // deprecated — use layoutWidths
  previewWidth?: number // deprecated — use layoutWidths
  layoutWidths?: {
    imnuri?: { sidebarWidth: number; previewWidth: number }
    biblia?: { sidebarWidth: number; previewWidth: number }
    video?: { sidebarWidth: number; previewWidth: number }
  }
}

// ── Debug Logger ──────────────────────────────────────────────────────────────

function getLogPath() {
  return path.join(app.getPath('userData'), 'adventshow-debug.log')
}

function debugLog(...args: unknown[]) {
  const settings = readSettings()
  if (!settings.debugLog) return
  const timestamp = new Date().toISOString()
  const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a, null, 2)).join(' ')
  const line = `[${timestamp}] ${message}\n`
  try {
    const logPath = getLogPath()
    const logDir = path.dirname(logPath)
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
    fs.appendFileSync(logPath, line, 'utf-8')
  } catch (err) {
    console.error('[debugLog] Failed to write log:', err)
  }
  console.log('[DEBUG]', ...args)
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function readSettings(): AppSettings {
  try { return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8')) as AppSettings }
  catch { return {} }
}

function writeSettings(settings: AppSettings) {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

// ── Auto-update (electron-updater) ────────────────────────────────────────────
// Native, battle-tested updater. Reads latest.yml / latest-mac.yml from the
// GitHub Release (configured via `publish` in electron-builder.json5), downloads
// the signed artifact, verifies it, and installs:
//   • Windows: runs the one-click NSIS installer silently — it closes the running
//     app, installs, and relaunches automatically (no cmd window, no manual steps).
//   • macOS: Squirrel.Mac swaps the .app in place from the signed+notarized zip
//     and relaunches.
// No custom scripts, no half-finished sequences for the user to clean up.
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater

let updaterWired = false

function wireAutoUpdater() {
  if (updaterWired) return
  updaterWired = true

  // We drive download/install from the UI, so don't auto-download on check.
  autoUpdater.autoDownload = false
  // If an update was downloaded but the user didn't click install, apply on quit.
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = {
    info: (m: unknown) => debugLog('[autoUpdater]', String(m)),
    warn: (m: unknown) => debugLog('[autoUpdater][warn]', String(m)),
    error: (m: unknown) => debugLog('[autoUpdater][error]', String(m)),
    debug: (m: unknown) => debugLog('[autoUpdater][debug]', String(m)),
  }

  autoUpdater.on('download-progress', (p) => {
    if (isWinAlive(win)) win.webContents.send('update:download-progress', {
      percent: Math.round(p.percent),
      bytesPerSecond: p.bytesPerSecond,
      transferred: p.transferred,
      total: p.total,
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    debugLog('[autoUpdater] update-downloaded', info.version)
    if (isWinAlive(win)) win.webContents.send('update:downloaded', { version: info.version })
  })
  autoUpdater.on('error', (err) => {
    debugLog('[autoUpdater] error', err == null ? 'unknown' : (err.stack || err.message || String(err)))
    if (isWinAlive(win)) win.webContents.send('update:error',
      err == null ? 'Eroare necunoscută la actualizare' : (err.message || String(err)))
  })
}

// In dev (not packaged) there is no app-update.yml, so updates are unavailable.
function updatesSupported(): boolean {
  return app.isPackaged
}

// ── Video conversion (FFmpeg) ─────────────────────────────────────────────────

function getFFmpegPath(): string {
  const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'

  // 1) Try ffmpeg-static module. NOT trusted blindly: in packaged Electron its index.js
  //    asserts the binary exists at app.asar/.../ffmpeg, but our binary lives in
  //    app.asar.unpacked/.../ffmpeg (per electron-builder.json5 asarUnpack). The assertion
  //    throws and require returns nothing, falling into our catch.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const p = require('ffmpeg-static') as string
    if (p && fs.existsSync(p)) return p
    // require returned but path doesn't exist on disk — try asar.unpacked rewrite
    if (p) {
      const unpacked = p.replace(/app\.asar(?!\.)/g, 'app.asar.unpacked')
      if (fs.existsSync(unpacked)) return unpacked
    }
  } catch { /* fall through */ }

  // 2) Packaged app: compute the canonical unpacked path from process.resourcesPath.
  //    This works even when ffmpeg-static's existence check threw at module-load time.
  if (app.isPackaged) {
    const guess = path.join(
      process.resourcesPath,
      'app.asar.unpacked', 'node_modules', 'ffmpeg-static', binaryName,
    )
    if (fs.existsSync(guess)) return guess
  }

  // 3) Last resort — system ffmpeg from PATH. Usually missing on Windows.
  return binaryName
}

// ── Universal local-video playback ──────────────────────────────────────────
//
// Chromium (so the projection <video>) can only decode a limited set of
// codec+container combos. Deciding "needs conversion" purely by file extension
// is wrong in both directions:
//   • an .mp4 with AC-3/DTS audio plays with NO SOUND
//   • a .mov/.mp4 with HEVC (e.g. iPhone recordings) plays with NO PICTURE
//   • an .mkv/.avi that is really H.264+AAC gets a slow, pointless full re-encode
// So instead we probe the real streams with ffmpeg and only re-encode the
// stream(s) Chromium can't handle, copying everything else (instant remux).

// Codecs Chromium plays. (HEVC/H.265 is intentionally excluded — support is
// platform-dependent and unreliable, so we always transcode it to H.264.)
const PLAYABLE_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1', 'theora'])
const PLAYABLE_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac'])
// In an .mp4/.mov container Chromium only reliably plays AAC or MP3 audio.
const MP4_AUDIO_CODECS = new Set(['aac', 'mp3'])
// Containers a browser can open directly (when the inner codecs are also fine).
const PLAYABLE_CONTAINERS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.ogg', '.ogv'])

interface MediaInfo {
  vcodec: string | null
  acodec: string | null
  hasAudio: boolean
  probed: boolean
}

// Probe a media file's codecs by parsing `ffmpeg -i` stderr (ffmpeg-static does
// not ship ffprobe). Best-effort: returns { probed:false } if ffmpeg is missing
// or the output can't be parsed, so callers fall back to extension heuristics.
function probeMedia(filePath: string): Promise<MediaInfo> {
  return new Promise((resolve) => {
    const ffmpeg = getFFmpegPath()
    execFile(ffmpeg, ['-hide_banner', '-i', filePath], { timeout: 30000 }, (_err, _stdout, stderr) => {
      const text = stderr || ''
      const vMatch = text.match(/Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Video:\s*([a-zA-Z0-9_]+)/)
      const aMatch = text.match(/Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Audio:\s*([a-zA-Z0-9_]+)/)
      if (!vMatch && !aMatch) {
        resolve({ vcodec: null, acodec: null, hasAudio: false, probed: false })
        return
      }
      resolve({
        vcodec: vMatch ? vMatch[1].toLowerCase() : null,
        acodec: aMatch ? aMatch[1].toLowerCase() : null,
        hasAudio: !!aMatch,
        probed: true,
      })
    })
  })
}

// Stable cache path so re-playing the same file doesn't re-convert every time.
function preparedCachePath(filePath: string): string {
  let key = filePath
  try {
    const st = fs.statSync(filePath)
    key = `${filePath}|${st.size}|${Math.round(st.mtimeMs)}`
  } catch { /* use path only */ }
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0
  return path.join(app.getPath('temp'), `adventshow-prep-${(hash >>> 0).toString(36)}.mp4`)
}

function runFFmpeg(args: string[]): Promise<void> {
  const ffmpeg = getFFmpegPath()
  // Show the "preparing" overlay only while ffmpeg actually runs (a quick remux or
  // a full transcode) — never during the codec probe, so compatible files that need
  // no work play instantly without a flashing spinner.
  if (isWinAlive(win)) win.webContents.send('video:converting', true)
  return new Promise((resolve, reject) => {
    const proc = execFile(ffmpeg, args, { timeout: 600000, maxBuffer: 1024 * 1024 * 64 }, (err) => {
      if (isWinAlive(win)) win.webContents.send('video:converting', false)
      if (err) {
        console.error('[FFmpeg] failed:', err)
        reject(new Error('Conversia video a eșuat'))
      } else {
        resolve()
      }
    })
    proc.stderr?.on('data', (d: Buffer) => {
      const line = d.toString()
      if (line.includes('time=') && isWinAlive(win)) {
        win.webContents.send('video:convert-progress', line.trim())
      }
    })
  })
}

// Decide whether a file can be played as-is, fast-remuxed, or must be
// transcoded — and return a Chromium-friendly path to feed the <video> element.
async function prepareVideoForPlayback(filePath: string): Promise<{ servePath: string; converted: boolean }> {
  const ext = path.extname(filePath).toLowerCase()
  const info = await probeMedia(filePath)

  // Fallback when probing isn't possible: trust the container extension.
  if (!info.probed) {
    if (PLAYABLE_CONTAINERS.has(ext)) return { servePath: filePath, converted: false }
    const out = preparedCachePath(filePath)
    if (!fileIsUsable(out)) {
      await runFFmpeg(['-i', filePath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-y', out])
    }
    return { servePath: out, converted: true }
  }

  const videoOk = !info.vcodec || PLAYABLE_VIDEO_CODECS.has(info.vcodec)
  const isMp4Like = ext === '.mp4' || ext === '.m4v' || ext === '.mov'
  // Inside a browser-friendly container with playable codecs → play directly.
  if (PLAYABLE_CONTAINERS.has(ext) && videoOk) {
    const audioFineHere = !info.hasAudio
      || (isMp4Like ? MP4_AUDIO_CODECS.has(info.acodec!) : PLAYABLE_AUDIO_CODECS.has(info.acodec!))
    if (audioFineHere) return { servePath: filePath, converted: false }
  }

  // Otherwise produce an .mp4, copying any stream that's already compatible.
  const out = preparedCachePath(filePath)
  if (fileIsUsable(out)) return { servePath: out, converted: true }

  const args = ['-i', filePath]
  // video: keep H.264 as-is, otherwise transcode (covers HEVC, MPEG-4, WMV, VC-1…)
  args.push('-map', '0:v:0?', '-c:v', info.vcodec === 'h264' ? 'copy' : 'libx264')
  if (info.vcodec !== 'h264') args.push('-preset', 'veryfast', '-crf', '23')
  // audio: keep AAC/MP3 as-is, otherwise transcode to AAC (covers AC-3, DTS, Opus, FLAC…)
  if (info.hasAudio) {
    const audioCopy = info.acodec ? MP4_AUDIO_CODECS.has(info.acodec) : false
    args.push('-map', '0:a:0?', '-c:a', audioCopy ? 'copy' : 'aac')
    if (!audioCopy) args.push('-b:a', '192k')
  }
  args.push('-movflags', '+faststart', '-y', out)
  await runFFmpeg(args)
  return { servePath: out, converted: true }
}

function fileIsUsable(p: string): boolean {
  try { return fs.statSync(p).size > 10000 } catch { return false }
}

// ── yt-dlp (YouTube streaming) ────────────────────────────────────────────────

function getYtDlpDir(): string {
  return path.join(app.getPath('userData'), 'yt-dlp')
}

function getYtDlpBinaryName(): string {
  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
}

function getYtDlpPath(): string {
  return path.join(getYtDlpDir(), getYtDlpBinaryName())
}

function getYtDlpDownloadUrl(): string {
  const base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'
  switch (process.platform) {
    case 'win32': return `${base}/yt-dlp.exe`
    case 'darwin': return `${base}/yt-dlp_macos`
    default: return `${base}/yt-dlp_linux`
  }
}

function isYtDlpInstalled(): boolean {
  return fs.existsSync(getYtDlpPath())
}

async function downloadYtDlp(): Promise<{ success: boolean; error?: string }> {
  try {
    const dir = getYtDlpDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const url = getYtDlpDownloadUrl()
    console.log('[yt-dlp] Downloading from:', url)
    const response = await net.fetch(url, { headers: { 'User-Agent': 'AdventShow' } })
    if (!response.ok) return { success: false, error: `HTTP ${response.status}` }

    const buffer = Buffer.from(await response.arrayBuffer())
    const dest = getYtDlpPath()
    fs.writeFileSync(dest, buffer)

    // Make executable on Unix
    if (process.platform !== 'win32') {
      fs.chmodSync(dest, 0o755)
    }
    console.log('[yt-dlp] Downloaded to:', dest)
    return { success: true }
  } catch (err: any) {
    console.error('[yt-dlp] Download failed:', err)
    return { success: false, error: err.message ?? 'Descărcarea a eșuat' }
  }
}

function getYtDlpVersion(): Promise<string> {
  return new Promise((resolve) => {
    if (!isYtDlpInstalled()) { resolve('Nu este instalat'); return }
    execFile(getYtDlpPath(), ['--version'], { timeout: 10000 }, (err, stdout) => {
      if (err) { resolve('Necunoscut'); return }
      resolve(stdout.trim())
    })
  })
}

async function updateYtDlp(): Promise<{ success: boolean; version?: string; error?: string }> {
  if (!isYtDlpInstalled()) {
    const dl = await downloadYtDlp()
    if (!dl.success) return { success: false, error: dl.error }
  }
  return new Promise((resolve) => {
    execFile(getYtDlpPath(), ['--update'], { timeout: 60000 }, async (err) => {
      if (err) {
        // If --update fails, try re-downloading
        const dl = await downloadYtDlp()
        if (!dl.success) {
          resolve({ success: false, error: 'Actualizarea a eșuat' })
          return
        }
      }
      const ver = await getYtDlpVersion()
      resolve({ success: true, version: ver })
    })
  })
}

function getYouTubeStreamUrl(videoUrl: string): Promise<{ url: string; error?: string }> {
  return new Promise((resolve) => {
    if (!isYtDlpInstalled()) {
      resolve({ url: '', error: 'yt-dlp nu este instalat. Apasă butonul „Instalează yt-dlp" de mai jos.' })
      return
    }
    const ytdlpBin = getYtDlpPath()
    const args = [
      '--get-url',
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--no-playlist',
      videoUrl,
    ]
    debugLog('[yt-dlp] Running:', ytdlpBin, args.join(' '))
    execFile(ytdlpBin, args, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        const errorDetail = stderr?.trim() || err.message || 'Unknown error'
        debugLog('[yt-dlp] Stream URL failed. stderr:', stderr, 'err:', err.message)
        console.error('[yt-dlp] Stream URL failed:', errorDetail)
        resolve({
          url: '',
          error: `Eroare yt-dlp: ${errorDetail.length > 200 ? errorDetail.substring(0, 200) + '...' : errorDetail}`,
        })
        return
      }
      // yt-dlp may return multiple URLs (video + audio) on separate lines; take the first
      const urls = stdout.trim().split('\n').filter(Boolean)
      debugLog('[yt-dlp] Got', urls.length, 'URL(s), first:', urls[0]?.substring(0, 80))
      resolve({ url: urls[0] ?? '' })
    })
  })
}

// ── YouTube Playlist ──────────────────────────────────────────────────────────

interface YouTubeEntry {
  id: string
  url: string
  title: string
  fileName: string
  status: 'downloading' | 'ready' | 'error'
  error?: string
  addedAt: string
}

function getYouTubeDir(): string {
  const settings = readSettings()
  if (settings.downloadFolder) {
    debugLog('[YouTube] Custom download folder:', settings.downloadFolder, 'exists:', fs.existsSync(settings.downloadFolder))
    if (fs.existsSync(settings.downloadFolder)) {
      return settings.downloadFolder
    }
  }
  return path.join(app.getPath('userData'), 'youtube-videos')
}

function getYouTubePlaylistPath(): string {
  return path.join(app.getPath('userData'), 'youtube-playlist.json')
}

function ensureYouTubeDir() {
  const dir = getYouTubeDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function readYouTubePlaylist(): YouTubeEntry[] {
  try {
    return JSON.parse(fs.readFileSync(getYouTubePlaylistPath(), 'utf-8'))
  } catch { return [] }
}

function writeYouTubePlaylist(playlist: YouTubeEntry[]) {
  fs.writeFileSync(getYouTubePlaylistPath(), JSON.stringify(playlist, null, 2), 'utf-8')
}

function getYouTubeTitle(videoUrl: string): Promise<string> {
  return new Promise((resolve) => {
    if (!isYtDlpInstalled()) { resolve('YouTube video'); return }
    execFile(getYtDlpPath(), ['--get-title', '--no-playlist', videoUrl], { timeout: 15000 }, (err, stdout) => {
      if (err) { resolve('YouTube video'); return }
      resolve(stdout.trim() || 'YouTube video')
    })
  })
}

// Serialize downloads: adding several links at once shouldn't spawn many
// concurrent yt-dlp + ffmpeg processes (memory spikes, throttling, flaky muxes).
let ytDownloadChain: Promise<void> = Promise.resolve()

function startYouTubeDownload(entry: YouTubeEntry) {
  ytDownloadChain = ytDownloadChain.then(() => runYouTubeDownload(entry)).catch(() => { /* keep queue alive */ })
}

function runYouTubeDownload(entry: YouTubeEntry): Promise<void> {
  ensureYouTubeDir()
  const ytdlpBin = getYtDlpPath()
  const ffmpegBin = getFFmpegPath()
  const youtubeDir = getYouTubeDir()
  const tmpDir = path.join(youtubeDir, `_tmp_${entry.id}`)
  const finalFile = `${entry.id}.mp4`
  const finalPath = path.join(youtubeDir, finalFile)

  // Stage tracking: progress is scaled across 3 phases
  //   video download:  0–45%
  //   audio download: 45–90%
  //   ffmpeg mux:     90–100% (ffmpeg uses time= not %, so we send a steady 95%)
  let stage: 'video' | 'audio' | 'mux' = 'video'

  const updateStatus = (status: YouTubeEntry['status'], error?: string, fileName?: string) => {
    const pl = readYouTubePlaylist()
    const idx = pl.findIndex(e => e.id === entry.id)
    if (idx === -1) return
    pl[idx].status = status
    pl[idx].error = error
    if (fileName !== undefined) pl[idx].fileName = fileName
    writeYouTubePlaylist(pl)
    win?.webContents.send('youtube:status', entry.id, status, error ?? '')
  }

  const runStep = (bin: string, args: string[]): Promise<void> => new Promise((resolve, reject) => {
    debugLog(`[yt-dlp-download:${stage}]`, bin, args.join(' '))
    const proc = spawn(bin, args)
    const onData = (data: Buffer) => {
      const line = data.toString().trim()
      debugLog(`[yt-dlp-download:${stage}]`, line)
      const m = line.match(/([\d.]+)%/)
      if (m) {
        const pct = parseFloat(m[1])
        let scaled = pct
        if (stage === 'video') scaled = pct * 0.45
        else if (stage === 'audio') scaled = 45 + pct * 0.45
        win?.webContents.send('youtube:progress', entry.id, Math.min(99, scaled), line)
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${stage} exited with code ${code}`)))
    proc.on('error', reject)
  })

  return (async () => {
    try {
      // Clean any stale tmp + final from previous attempts so we never serve a half-baked file
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* fresh */ }
      try { fs.unlinkSync(finalPath) } catch { /* fresh */ }
      fs.mkdirSync(tmpDir, { recursive: true })

      // ── Stage 1: video stream only (prefer H.264 mp4 for Chromium compatibility)
      stage = 'video'
      await runStep(ytdlpBin, [
        '-f', 'bv*[vcodec^=avc1]/bv*[ext=mp4]/bv*',
        '-o', path.join(tmpDir, 'video.%(ext)s'),
        '--no-playlist', '--newline', '--no-mtime',
        '--retries', '10', '--fragment-retries', '10',
        entry.url,
      ])

      // ── Stage 2: audio stream only (prefer AAC m4a)
      stage = 'audio'
      await runStep(ytdlpBin, [
        '-f', 'ba[ext=m4a]/ba',
        '-o', path.join(tmpDir, 'audio.%(ext)s'),
        '--no-playlist', '--newline', '--no-mtime',
        '--retries', '10', '--fragment-retries', '10',
        entry.url,
      ])

      const tmpFiles = fs.readdirSync(tmpDir)
      const videoTmp = tmpFiles.find(f => f.startsWith('video.'))
      const audioTmp = tmpFiles.find(f => f.startsWith('audio.'))
      if (!videoTmp || !audioTmp) {
        throw new Error(`Streams lipsesc după descărcare: ${JSON.stringify(tmpFiles)}`)
      }

      // ── Stage 3: mux into mp4 with ffmpeg.
      //    -c:v copy: nu re-encodăm video (păstrăm calitatea, e rapid)
      //    -c:a aac: RE-ENCODĂM audio în AAC — garantează compatibilitate MP4/Chromium chiar
      //              dacă yt-dlp a returnat opus (din webm). Aici a fost regresia.
      stage = 'mux'
      win?.webContents.send('youtube:progress', entry.id, 95, '[mux] merging streams')
      await runStep(ffmpegBin, [
        '-i', path.join(tmpDir, videoTmp),
        '-i', path.join(tmpDir, audioTmp),
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart',
        '-y', finalPath,
      ])

      const stat = fs.statSync(finalPath)
      if (stat.size < 10000) throw new Error(`Fișierul final pare incomplet (${stat.size} bytes)`)

      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best effort */ }

      updateStatus('ready', undefined, finalFile)
      win?.webContents.send('youtube:progress', entry.id, 100, 'done')
    } catch (err: any) {
      debugLog('[yt-dlp-download] ERROR:', err.message)
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best effort */ }
      try { fs.unlinkSync(finalPath) } catch { /* best effort */ }
      updateStatus('error', err.message || String(err))
    }
  })()
}

// ── Projection state ──────────────────────────────────────────────────────────

interface ProjState {
  sections: any[]
  currentIndex: number
  hymnTitle: string
  hymnNumber: string
  contentType?: 'hymn' | 'bible'
  bibleRef?: string
}
let projState: ProjState | null = null

// ── Keep-alive: prevent system sleep / screensaver while the app is running ──
let powerSaveId: number | null = null

function startPowerSaveBlocker() {
  if (powerSaveId === null) {
    powerSaveId = powerSaveBlocker.start('prevent-display-sleep')
  }
}

function stopPowerSaveBlocker() {
  if (powerSaveId !== null && powerSaveBlocker.isStarted(powerSaveId)) {
    powerSaveBlocker.stop(powerSaveId)
  }
  powerSaveId = null
}

/** Safe check: window exists and is not destroyed */
function isWinAlive(w: BrowserWindow | null): w is BrowserWindow {
  return w !== null && !w.isDestroyed()
}

function sendSlideToProjection(index: number) {
  if (!projState || !isWinAlive(projectionWin)) return
  projState.currentIndex = index
  projectionWin.webContents.send('projection:slide', {
    sections: projState.sections,
    currentIndex: index,
    hymnTitle: projState.hymnTitle,
    hymnNumber: projState.hymnNumber,
    contentType: projState.contentType,
    bibleRef: projState.bibleRef,
  })
  if (isWinAlive(win)) win.webContents.send('projection:controller-sync', { currentIndex: index })
}

// ── Projection window ─────────────────────────────────────────────────────────

function createProjectionWindow() {
  const settings = readSettings()
  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()

  let targetDisplay =
    (settings.projectionDisplayId != null
      ? displays.find(d => d.id === settings.projectionDisplayId)
      : null)
    ?? displays.find(d => d.id !== primary.id)
    ?? primary

  const { x, y, width, height } = targetDisplay.bounds
  const isWin = process.platform === 'win32'

  debugLog('[Projection] Creating window on display', targetDisplay.id,
    `(${width}x${height} at ${x},${y})`, isWin ? '[Windows mode]' : '[macOS/Linux mode]')

  projectionWin = new BrowserWindow({
    x, y, width, height,
    fullscreen: !isWin,
    frame: false,
    transparent: !isWin,
    backgroundColor: isWin ? '#000000' : '#00000000',
    show: false,
    alwaysOnTop: targetDisplay.id === primary.id,
    ...(isWin ? { simpleFullscreen: true } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      // Allow file:// access for background images/videos
      webSecurity: false,
      // Allow video/audio autoplay without user gesture (fixes no-sound on Windows)
      autoplayPolicy: 'no-user-gesture-required',
    },
  })

  projectionWin.once('ready-to-show', () => {
    projectionWin?.show()
    setTimeout(() => win?.focus(), 200)
  })

  const projUrl = VITE_DEV_SERVER_URL
    ? `${VITE_DEV_SERVER_URL}?mode=projection`
    : `file://${path.join(RENDERER_DIST, 'index.html')}?mode=projection`

  projectionWin.loadURL(projUrl)

  projectionWin.on('closed', () => {
    projectionWin = null
    projState = null
    projectionReadyResolve = null
    projectionReadyPromise = null
    if (isWinAlive(win)) win.webContents.send('projection:closed')
  })

  resetProjectionReady()
  return projectionWin
}

function createWindow() {
  const settings = readSettings()
  const saved = settings.windowBounds

  // Validate saved bounds are on a visible display
  let bounds: Partial<Electron.BrowserWindowConstructorOptions> = {}
  if (saved) {
    const displays = screen.getAllDisplays()
    const visible = displays.some(d => {
      const db = d.bounds
      return saved.x >= db.x - 100 && saved.x < db.x + db.width + 100
        && saved.y >= db.y - 100 && saved.y < db.y + db.height + 100
    })
    if (visible) {
      bounds = { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
    }
  }

  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    ...bounds,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  // Save window bounds on move/resize (debounced)
  let boundsTimer: ReturnType<typeof setTimeout> | null = null
  const saveBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
      const b = win.getBounds()
      const s = readSettings()
      s.windowBounds = { x: b.x, y: b.y, width: b.width, height: b.height }
      writeSettings(s)
    }, 500)
  }
  win.on('moved', saveBounds)
  win.on('resized', saveBounds)

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function copySeedDbIfNeeded() {
  const userDbPath = path.join(app.getPath('userData'), 'hymns.db')
  const seedPaths = [
    path.join(process.resourcesPath ?? '', 'hymns.db'),
    path.join(process.env.APP_ROOT!, 'public', 'hymns.db'),
  ]
  function copyFromSeed() {
    for (const seedPath of seedPaths) {
      if (fs.existsSync(seedPath)) { fs.copyFileSync(seedPath, userDbPath); return true }
    }
    return false
  }
  if (!fs.existsSync(userDbPath)) {
    copyFromSeed()
  }
}

app.on('window-all-closed', () => {
  stopPowerSaveBlocker()
  if (process.platform !== 'darwin') { app.quit(); win = null }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// Register custom protocol so the renderer (loaded from http://localhost) can
// display local image/video files without CSP/CORS issues.
protocol.registerSchemesAsPrivileged([
  { scheme: 'localfile', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true } },
])

app.whenReady().then(() => {
  // Configure native macOS About panel
  app.setAboutPanelOptions({
    applicationName: 'AdventShow',
    applicationVersion: app.getVersion(),
    copyright: '© 2025 AdventTools  •  github.com/AdventTools',
    credits: [
      'Aplicație gratuită și open-source pentru proiecția imnurilor și versetelor biblice în biserici.',
      '',
      '── Dezvoltatori ──',
      'Ovidius Zanfir — concept, design, baza de date imnuri',
      'Samy Balasa — video, YouTube, Biblie, auto-update',
      '',
      '── Conținut ──',
      '922 imnuri din colecția „Imnuri Creștine"',
      'Biblia Cornilescu — 66 cărți, 31.102 versete',
      '',
      'github.com/AdventTools',
    ].join('\n'),
  })

  // Prevent system sleep / screensaver / hibernate while the app is running
  startPowerSaveBlocker()

  // Serve local files via localfile:///abs/path
  // Forward ALL request headers (including Range) so video streaming works.
  protocol.handle('localfile', (request) => {
    const raw = request.url.slice('localfile://'.length)
    const filePath = decodeURIComponent(raw.startsWith('/') ? raw : '/' + raw)
    debugLog('[localfile] request:', request.url.substring(0, 120), '-> filePath:', filePath.substring(0, 120))
    // Use pathToFileURL to properly encode file path (handles spaces, special chars)
    const fileUrl = `file://${encodeURI(filePath).replace(/#/g, '%23')}`
    debugLog('[localfile] fetching:', fileUrl.substring(0, 120))
    return net.fetch(fileUrl, {
      headers: Object.fromEntries(request.headers.entries()),
    })
  })

  copySeedDbIfNeeded()
  initDB()

  // Faster startup (especially on Windows): keep only the hymn DB ready on the
  // critical path. Bible seeding + seed-correction sync are deferred so the main
  // window paints first — they only matter once the user opens the Bible, which
  // is always well after the window is up. setImmediate runs them right after the
  // synchronous startup (window creation) finishes, so nothing is actually lost.
  setImmediate(() => {
    try {
      seedBibleFromJson()
      // Sync corrections from seed DB to user DB (e.g., fixed hymns)
      const seedPaths = [
        path.join(process.resourcesPath ?? '', 'hymns.db'),
        path.join(process.env.APP_ROOT!, 'public', 'hymns.db'),
      ]
      for (const sp of seedPaths) {
        if (fs.existsSync(sp)) { syncSeedCorrections(sp); break }
      }
    } catch (err) {
      debugLog('[startup] deferred seed/sync error:', String(err))
    }
  })

  debugLog('[App] Ready. Platform:', process.platform, 'Version:', app.getVersion(),
    'userData:', app.getPath('userData'))
  debugLog('[App] Displays:', screen.getAllDisplays().map(d =>
    `${d.id}(${d.bounds.width}x${d.bounds.height})`).join(', '))

  // ── Settings ──────────────────────────────────────────────────────────────
  ipcMain.handle('settings:get', () => readSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
    const merged = { ...readSettings(), ...patch }
    writeSettings(merged)
    debugLog('[Settings] Saved:', Object.keys(patch).join(', '))
  })

  // ── Screen / display info ─────────────────────────────────────────────────
  ipcMain.handle('shell:open-external', (_e, url: string) => {
    shell.openExternal(url)
  })

  ipcMain.handle('screen:get-displays', () => {
    const primary = screen.getPrimaryDisplay()
    return screen.getAllDisplays().map(d => ({
      id: d.id,
      label: d.id === primary.id ? 'Ecran principal' : `Ecran ${d.id}`,
      isPrimary: d.id === primary.id,
      width: d.bounds.width,
      height: d.bounds.height,
      x: d.bounds.x,
      y: d.bounds.y,
      scaleFactor: d.scaleFactor,
    }))
  })

  // ── Category CRUD ─────────────────────────────────────────────────────────
  ipcMain.handle('db:get-categories', () => getCategories())
  ipcMain.handle('db:create-category', (_e, name: string) => createCategory(name))
  ipcMain.handle('db:update-category', (_e, id: number, name: string) => updateCategory(id, name))
  ipcMain.handle('db:delete-category', (_e, id: number) => deleteCategory(id))

  // ── Hymn read/search ──────────────────────────────────────────────────────
  ipcMain.handle('db:get-all-hymns', (_e, categoryId?: number) => getAllHymns(categoryId))
  ipcMain.handle('db:get-hymn', (_e, number: string) => getHymnByNumber(number))
  ipcMain.handle('db:search-hymns', (_e, query: string, categoryId?: number) =>
    searchHymns(query, categoryId))
  ipcMain.handle('db:get-all-hymns-with-snippets', (_e, categoryId?: number) =>
    getAllHymnsWithSnippets(categoryId))
  ipcMain.handle('db:search-hymns-content', (_e, query: string, categoryId?: number) =>
    searchHymnsContent(query, categoryId))
  ipcMain.handle('db:get-hymn-with-sections', (_e, id: number) => {
    debugLog('[DB] getHymnWithSections id:', id)
    return getHymnWithSections(id)
  })
  ipcMain.handle('db:create-hymn-with-sections', (_e, payload: {
    number: string;
    title: string;
    categoryId?: number;
    sections: { type: 'strofa' | 'refren'; text: string }[];
  }) => createHymnWithSections(payload))

  // ── Hymn CRUD ─────────────────────────────────────────────────────────────
  ipcMain.handle('hymn:update', (_e, id: number, number: string, title: string) =>
    updateHymn(id, number, title))
  ipcMain.handle('hymn:set-category', (_e, id: number, categoryId?: number) =>
    updateHymnCategory(id, categoryId))
  ipcMain.handle('hymn:delete', (_e, id: number) => deleteHymn(id))
  ipcMain.handle('hymn:update-with-sections', (_e, id: number, payload: {
    number: string;
    title: string;
    sections: { type: 'strofa' | 'refren'; text: string }[];
  }) => updateHymnWithSections(id, payload))
  ipcMain.handle('db:clear-all', () => clearAllData())
  ipcMain.handle('db:export-json-backup', (_e, destPath: string) => {
    const backup = exportJsonBackup()
    fs.writeFileSync(destPath, JSON.stringify(backup, null, 2), 'utf-8')
    return {
      categories: backup.categories.length,
      hymns: backup.hymns.length,
      sections: backup.hymn_sections.length,
    }
  })
  ipcMain.handle('db:import-json-backup', (_e, filePath: string) => {
    const raw = fs.readFileSync(filePath, 'utf-8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('Fișier JSON invalid.')
    }
    return importJsonBackup(parsed)
  })

  // ── Section CRUD ──────────────────────────────────────────────────────────
  ipcMain.handle('section:add', (_e, hymnId: number, type: 'strofa' | 'refren', text: string) =>
    addSection(hymnId, type, text))
  ipcMain.handle('section:update', (_e, id: number, type: 'strofa' | 'refren', text: string) =>
    updateSection(id, type, text))
  ipcMain.handle('section:delete', (_e, id: number) => deleteSection(id))
  ipcMain.handle('section:reorder',
    (_e, sections: { id: number; order_index: number }[]) => reorderSections(sections))

  // ── Import ────────────────────────────────────────────────────────────────
  ipcMain.handle('db:import-presentations', async (_e, dirPath: string, categoryId?: number) => {
    try { return await importPresentationDirectory(dirPath, categoryId) }
    catch (err: any) {
      return { success: 0, failed: 0, errors: [err?.message ?? 'Unknown error'] }
    }
  })
  ipcMain.handle('db:import-presentation-files', async (_e, filePaths: string[], categoryId?: number) => {
    try { return await importPresentationFiles(filePaths, categoryId) }
    catch (err: any) {
      return { success: 0, failed: 0, errors: [err?.message ?? 'Unknown error'] }
    }
  })

  // ── Dialogs ───────────────────────────────────────────────────────────────
  ipcMain.handle('dialog:select-folder', async () => {
    const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    if (result.canceled) return undefined
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:select-presentation-files', async () => {
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PowerPoint', extensions: ['ppt', 'pptx'] }],
    })
    if (result.canceled) return undefined
    return result.filePaths
  })

  ipcMain.handle('dialog:save-file', async (_e, defaultName: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    })
    if (result.canceled) return undefined
    return result.filePath
  })

  ipcMain.handle('dialog:save-json-file', async (_e, defaultName: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled) return undefined
    return result.filePath
  })

  ipcMain.handle('dialog:select-json-file', async () => {
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled) return undefined
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:pick-media', async (_e, mediaType: 'image' | 'video') => {
    const filters = mediaType === 'image'
      ? [
          { name: 'Imagini', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif'] },
          { name: 'Toate fișierele', extensions: ['*'] },
        ]
      : [
          { name: 'Videoclipuri', extensions: ['mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'ogg', 'ogv', 'mpg', 'mpeg', 'ts', 'm2ts', 'mts', '3gp', 'divx', 'vob'] },
          { name: 'Toate fișierele', extensions: ['*'] },
        ]
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters,
    })
    if (result.canceled) return undefined
    return result.filePaths[0]
  })

  ipcMain.handle('db:export', async (_e, destPath: string) => {
    const userDbPath = path.join(app.getPath('userData'), 'hymns.db')
    fs.copyFileSync(userDbPath, destPath)
  })

  // ── Projection ────────────────────────────────────────────────────────────

  ipcMain.handle('projection:open', async (_e, sections: any[], hymnTitle: string, hymnNumber: string, startIndex?: number, contentType?: string, bibleRef?: string) => {
    debugLog('[Projection] Open request:', hymnTitle, hymnNumber, 'sections:', sections.length, 'type:', contentType)
    const idx = typeof startIndex === 'number' ? startIndex : 0
    projState = { sections, currentIndex: idx, hymnTitle, hymnNumber, contentType: contentType as any, bibleRef }
    if (projectionWin) {
      projectionWin.focus()
      // Already open & ready: send immediately
      sendSlideToProjection(idx)
    } else {
      createProjectionWindow()
      // Wait for the projection renderer to fully mount
      await waitForProjectionReady()
      sendSlideToProjection(idx)
    }
  })

  ipcMain.handle('projection:navigate', (_e, _sections: any[], index: number, _hymnTitle: string, _hymnNumber: string, contentType?: string, bibleRef?: string) => {
    if (!projState) return
    if (contentType) projState.contentType = contentType as any
    if (bibleRef) projState.bibleRef = bibleRef
    const minIndex = projState.contentType === 'bible' ? 0 : -1
    const clamped = Math.max(minIndex, Math.min(index, projState.sections.length - 1))
    sendSlideToProjection(clamped)
  })

  ipcMain.handle('projection:update-hymn', (_e, sections: any[], hymnTitle: string, hymnNumber: string, startIndex?: number, contentType?: string, bibleRef?: string) => {
    const idx = typeof startIndex === 'number' ? startIndex : 0
    projState = { sections, currentIndex: idx, hymnTitle, hymnNumber, contentType: contentType as any, bibleRef }
    sendSlideToProjection(idx)
  })

  ipcMain.handle('projection:key-request', (_e, action: 'prev' | 'next' | 'close' | 'zoom-in' | 'zoom-out') => {
    if (action === 'close') { if (isWinAlive(projectionWin)) projectionWin.close(); return }
    if (action === 'zoom-in' || action === 'zoom-out') {
      if (isWinAlive(projectionWin)) projectionWin.webContents.send('projection:zoom', action)
      return
    }
    if (!projState) return
    const minIndex = projState.contentType === 'bible' ? 0 : -1  // Bible has no title slide
    const newIndex = action === 'next'
      ? Math.min(projState.currentIndex + 1, projState.sections.length - 1)
      : Math.max(projState.currentIndex - 1, minIndex)
    sendSlideToProjection(newIndex)
  })

  // Projection renderer signals it has mounted and IPC listeners are registered
  ipcMain.on('projection:renderer-ready', () => {
    debugLog('[projection:renderer-ready] Renderer is ready!')
    if (projectionReadyResolve) {
      projectionReadyResolve()
    }
  })

  ipcMain.handle('projection:close', () => {
    if (isWinAlive(projectionWin)) projectionWin.close()
    projectionWin = null
    projState = null
  })

  // ── Bible ───────────────────────────────────────────────────────────────────
  ipcMain.handle('bible:get-books', () => getBibleBooks())
  ipcMain.handle('bible:get-chapters', (_e, bookId: number) => getBibleChapters(bookId))
  ipcMain.handle('bible:get-verses', (_e, bookId: number, chapter: number) =>
    getBibleVerses(bookId, chapter))
  ipcMain.handle('bible:search', (_e, query: string, bookId?: number, chapter?: number) =>
    searchBible(query, bookId, chapter))
  ipcMain.handle('bible:get-verse-range',
    (_e, bookId: number, chapter: number, startVerse: number, endVerse: number) =>
      getBibleVerseRange(bookId, chapter, startVerse, endVerse))
  ipcMain.handle('bible:has-data', () => hasBibleData())

  // ── Update (electron-updater) ─────────────────────────────────────────────
  ipcMain.handle('update:check', async () => {
    if (!updatesSupported()) {
      debugLog('[Update] check skipped — not packaged (dev mode)')
      return { available: false }
    }
    try {
      wireAutoUpdater()
      const result = await autoUpdater.checkForUpdates()
      const latest = result?.updateInfo?.version ?? null
      const current = app.getVersion()
      const available = !!latest && latest !== current
      debugLog(`[Update] check: current=${current} latest=${latest} available=${available}`)
      return { available, version: latest ?? undefined }
    } catch (err: any) {
      debugLog('[Update] check failed:', err?.message ?? String(err))
      return { available: false }
    }
  })
  ipcMain.handle('update:download', async () => {
    if (!updatesSupported()) return
    try {
      wireAutoUpdater()
      await autoUpdater.downloadUpdate()
    } catch (err: any) {
      debugLog('[Update] download failed:', err?.message ?? String(err))
      if (isWinAlive(win)) win.webContents.send('update:error', err?.message ?? 'Descărcarea a eșuat')
    }
  })
  ipcMain.handle('update:install', () => {
    if (!updatesSupported()) return
    try {
      // isSilent=true (no installer UI), isForceRunAfter=true (relaunch after install).
      autoUpdater.quitAndInstall(true, true)
    } catch (err: any) {
      debugLog('[Update] install failed:', err?.message ?? String(err))
      if (isWinAlive(win)) win.webContents.send('update:error', err?.message ?? 'Instalarea a eșuat')
    }
  })

  ipcMain.handle('update:open-log', () => {
    const logPath = getLogPath()
    if (fs.existsSync(logPath)) {
      shell.openPath(logPath)
    } else {
      shell.openPath(app.getPath('userData'))
    }
  })

  // ── Video ───────────────────────────────────────────────────────────────────
  ipcMain.handle('video:pick-file', async () => {
    if (!win) return undefined
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: 'Videoclipuri', extensions: ['mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'ogg', 'ogv', 'mpg', 'mpeg', 'ts', 'm2ts', 'mts', '3gp', 'divx', 'vob'] },
        { name: 'Toate fișierele', extensions: ['*'] },
      ],
    })
    if (result.canceled) return undefined
    return result.filePaths[0]
  })

  // Prepare video (convert if needed) without opening projection
  ipcMain.handle('video:prepare', async (_e, filePath: string) => {
    debugLog('[video:prepare] Preparing file:', filePath)
    try {
      const { servePath, converted } = await prepareVideoForPlayback(filePath)
      const videoUrl = pathToFileURL(servePath).href
      debugLog('[video:prepare] Prepared URL:', videoUrl, 'converted:', converted)
      return { url: videoUrl, name: path.basename(filePath), converted }
    } catch (err: any) {
      debugLog('[video:prepare] Failed:', err.message)
      win?.webContents.send('video:converting', false)
      return { error: err.message ?? 'Conversia video a eșuat' }
    }
  })

  // Open projection and start playback
  ipcMain.handle('video:start-playback', async (_e, url: string, name: string) => {
    // Fix cached broken file:// URLs from older versions (file://C:%5C... → file:///C:/...)
    if (url.startsWith('file://') && !url.startsWith('file:///')) {
      try {
        const decoded = decodeURIComponent(url.replace('file://', ''))
        url = pathToFileURL(decoded).href
        debugLog('[video:start-playback] Fixed legacy URL →', url.substring(0, 100))
      } catch { /* keep original */ }
    }
    debugLog('[video:start-playback] Starting playback:', url.substring(0, 100), 'name:', name)
    if (!isWinAlive(projectionWin)) {
      debugLog('[video:start-playback] Creating projection window...')
      createProjectionWindow()
    }
    // Wait for the projection renderer to signal it's ready (React mounted, IPC listeners registered)
    debugLog('[video:start-playback] Waiting for projection renderer ready...')
    await waitForProjectionReady()
    debugLog('[video:start-playback] Projection ready! Sending video:load + video:play')
    if (isWinAlive(projectionWin)) projectionWin.webContents.send('video:load', url, name)
    // Small delay for the <video> element to mount after state change
    setTimeout(() => { if (isWinAlive(projectionWin)) projectionWin.webContents.send('video:play') }, 200)
  })

  // Legacy load (kept for backward compat)
  ipcMain.handle('video:load', async (_e, filePath: string) => {
    debugLog('[video:load] Loading file:', filePath)
    let servePath = filePath
    let converted = false
    try {
      const prep = await prepareVideoForPlayback(filePath)
      servePath = prep.servePath
      converted = prep.converted
    } catch (err: any) {
      win?.webContents.send('video:converting', false)
      return { error: err.message ?? 'Conversia video a eșuat' }
    }
    const videoUrl = pathToFileURL(servePath).href
    if (!isWinAlive(projectionWin)) createProjectionWindow()
    const sendVideo = () => {
      if (isWinAlive(projectionWin)) projectionWin.webContents.send('video:load', videoUrl, path.basename(filePath))
    }
    if (isWinAlive(projectionWin) && projectionWin.webContents.isLoading()) {
      projectionWin.webContents.once('did-finish-load', sendVideo)
    } else {
      setTimeout(sendVideo, 300)
    }
    return { url: videoUrl, name: path.basename(filePath), converted }
  })

  ipcMain.handle('video:play', () => {
    debugLog('[video:play] Sending play to projection')
    if (isWinAlive(projectionWin)) projectionWin.webContents.send('video:play')
  })
  ipcMain.handle('video:pause', () => {
    debugLog('[video:pause] Sending pause to projection')
    if (isWinAlive(projectionWin)) projectionWin.webContents.send('video:pause')
  })
  ipcMain.handle('video:stop', () => {
    debugLog('[video:stop] Sending stop to projection')
    if (isWinAlive(projectionWin)) {
      projectionWin.webContents.send('video:stop')
      // Close the projection window so it doesn't stay as a black screen
      setTimeout(() => {
        if (isWinAlive(projectionWin)) {
          projectionWin.close()
        }
      }, 300)
    }
  })
  ipcMain.handle('video:seek', (_e, time: number) => { if (isWinAlive(projectionWin)) projectionWin.webContents.send('video:seek', time) })
  ipcMain.handle('video:volume', (_e, vol: number) => { if (isWinAlive(projectionWin)) projectionWin.webContents.send('video:volume', vol) })

  // Legacy load-url (kept for backward compat)
  ipcMain.handle('video:load-url', (_e, url: string) => {
    debugLog('[video:load-url] Loading URL:', url.substring(0, 120) + '...')
    if (!isWinAlive(projectionWin)) createProjectionWindow()
    const sendVideo = () => {
      if (isWinAlive(projectionWin)) projectionWin.webContents.send('video:load', url, 'YouTube')
    }
    if (isWinAlive(projectionWin) && projectionWin.webContents.isLoading()) {
      projectionWin.webContents.once('did-finish-load', sendVideo)
    } else {
      setTimeout(sendVideo, 300)
    }
    return { url, name: 'YouTube' }
  })

  // ── yt-dlp ──────────────────────────────────────────────────────────────────
  ipcMain.handle('ytdlp:is-installed', () => {
    const installed = isYtDlpInstalled()
    debugLog('[ytdlp:is-installed]', installed, 'path:', getYtDlpPath())
    return installed
  })
  ipcMain.handle('ytdlp:install', async () => {
    debugLog('[ytdlp:install] Starting download...')
    const result = await downloadYtDlp()
    debugLog('[ytdlp:install] Result:', result)
    return result
  })
  ipcMain.handle('ytdlp:version', () => getYtDlpVersion())
  ipcMain.handle('ytdlp:update', () => updateYtDlp())
  ipcMain.handle('ytdlp:get-stream-url', async (_e, videoUrl: string) => {
    debugLog('[ytdlp:get-stream-url] URL:', videoUrl)
    if (!isYtDlpInstalled()) {
      debugLog('[ytdlp:get-stream-url] yt-dlp not installed, auto-installing...')
      const dl = await downloadYtDlp()
      debugLog('[ytdlp:get-stream-url] Install result:', dl)
      if (!dl.success) return { url: '', error: 'Nu s-a putut instala yt-dlp: ' + (dl.error ?? '') }
    }
    const result = await getYouTubeStreamUrl(videoUrl)
    debugLog('[ytdlp:get-stream-url] Result:', { url: result.url ? result.url.substring(0, 80) + '...' : '', error: result.error })
    return result
  })

  // ── YouTube Playlist ────────────────────────────────────────────────────────
  ipcMain.handle('youtube:get-playlist', () => {
    return readYouTubePlaylist()
  })

  ipcMain.handle('youtube:add', async (_e, url: string, userTitle?: string) => {
    debugLog('[youtube:add] URL:', url, 'title:', userTitle)
    if (!isYtDlpInstalled()) {
      debugLog('[youtube:add] yt-dlp not installed, auto-installing...')
      const dl = await downloadYtDlp()
      if (!dl.success) return { error: 'Nu s-a putut instala yt-dlp: ' + (dl.error ?? '') }
    }
    ensureYouTubeDir()
    const id = Date.now().toString()

    // Get title
    let title = userTitle || ''
    if (!title) {
      try {
        title = await getYouTubeTitle(url)
      } catch {
        title = 'YouTube video'
      }
    }

    const entry: YouTubeEntry = {
      id,
      url,
      title,
      fileName: '',
      status: 'downloading',
      addedAt: new Date().toISOString(),
    }

    const playlist = readYouTubePlaylist()
    playlist.push(entry)
    writeYouTubePlaylist(playlist)

    // Start download in background
    startYouTubeDownload(entry)

    return { entry }
  })

  ipcMain.handle('youtube:update-title', (_e, id: string, title: string) => {
    const playlist = readYouTubePlaylist()
    const idx = playlist.findIndex(e => e.id === id)
    if (idx !== -1) {
      playlist[idx].title = title
      writeYouTubePlaylist(playlist)
    }
  })

  ipcMain.handle('youtube:remove', (_e, id: string) => {
    debugLog('[youtube:remove] Removing entry:', id)
    const playlist = readYouTubePlaylist()
    const filtered = playlist.filter(e => e.id !== id)
    writeYouTubePlaylist(filtered)
  })

  ipcMain.handle('youtube:delete', (_e, id: string) => {
    debugLog('[youtube:delete] Deleting entry + file:', id)
    const playlist = readYouTubePlaylist()
    const entry = playlist.find(e => e.id === id)
    if (entry?.fileName) {
      const filePath = path.join(getYouTubeDir(), entry.fileName)
      try { fs.unlinkSync(filePath) } catch { /* ignore */ }
    }
    writeYouTubePlaylist(playlist.filter(e => e.id !== id))
  })

  ipcMain.handle('youtube:reorder', (_e, orderedIds: string[]) => {
    const playlist = readYouTubePlaylist()
    const map = new Map(playlist.map(e => [e.id, e]))
    const reordered = orderedIds.map(id => map.get(id)).filter(Boolean) as YouTubeEntry[]
    // Add any entries that weren't in orderedIds (safety)
    for (const e of playlist) {
      if (!orderedIds.includes(e.id)) reordered.push(e)
    }
    writeYouTubePlaylist(reordered)
  })

  ipcMain.handle('youtube:retry-download', (_e, id: string) => {
    debugLog('[youtube:retry-download] Retrying:', id)
    const playlist = readYouTubePlaylist()
    const idx = playlist.findIndex(e => e.id === id)
    if (idx === -1) return
    playlist[idx].status = 'downloading'
    playlist[idx].error = undefined
    writeYouTubePlaylist(playlist)
    startYouTubeDownload(playlist[idx])
  })

  ipcMain.handle('youtube:get-download-folder', () => {
    return getYouTubeDir()
  })

  ipcMain.handle('playlist:get-file-path', (_e, id: string) => {
    const playlist = readYouTubePlaylist()
    const entry = playlist.find(e => e.id === id) as any
    if (!entry) return null
    if (entry.localUrl) {
      // localfile:///path → /path
      const raw = (entry.localUrl as string).replace(/^localfile:\/\//, '')
      return decodeURIComponent(raw)
    }
    if (entry.fileName) {
      return path.join(getYouTubeDir(), entry.fileName)
    }
    return null
  })

  ipcMain.handle('playlist:reveal-in-folder', (_e, filePath: string) => {
    if (filePath && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath)
    }
  })

  ipcMain.handle('playlist:add-local', (_e, url: string, name: string) => {
    const playlist = readYouTubePlaylist()
    const entry: YouTubeEntry = {
      id: Date.now().toString(),
      url: '',  // local file, no remote URL
      title: name,
      fileName: '',  // not in youtube dir, url serves directly
      status: 'ready',
      addedAt: new Date().toISOString(),
    }
      // Store the localfile URL in a special field
      ; (entry as any).localUrl = url
    playlist.push(entry)
    writeYouTubePlaylist(playlist)
    return { entry: { ...entry, localUrl: url } }
  })

  ipcMain.handle('playlist:get-file-url', (_e, id: string) => {
    const playlist = readYouTubePlaylist()
    const entry = playlist.find(e => e.id === id) as any
    if (!entry) return { error: 'Intrarea nu a fost găsită' }
    // Local file: has localUrl
    if (entry.localUrl) {
      return { url: entry.localUrl, name: entry.title }
    }
    // YouTube downloaded file
    if (!entry.fileName) return { error: 'Fișierul nu este disponibil' }
    let filePath = path.join(getYouTubeDir(), entry.fileName)
    // If stored file doesn't exist, try to find a better match (e.g. merged .mp4 vs audio-only .m4a)
    if (!fs.existsSync(filePath)) {
      const audioOnly = ['.m4a', '.opus', '.ogg', '.aac', '.mp3']
      const files = fs.readdirSync(getYouTubeDir()).filter(f => f.startsWith(entry.id + '.'))
      const better =
        files.find(f => f === entry.id + '.mp4') ||
        files.find(f => f.endsWith('.mp4')) ||
        files.find(f => f.endsWith('.webm') || f.endsWith('.mkv')) ||
        files.find(f => !audioOnly.some(ext => f.endsWith(ext))) ||
        files[0]
      if (better) {
        filePath = path.join(getYouTubeDir(), better)
        // Update playlist entry for future lookups
        const pl = readYouTubePlaylist()
        const pi = pl.findIndex(e => e.id === entry.id)
        if (pi !== -1) { pl[pi].fileName = better; writeYouTubePlaylist(pl) }
      }
    }
    if (!fs.existsSync(filePath)) return { error: 'Fișierul nu mai există pe disc' }
    const fileUrl = `file://${encodeURI(filePath).replace(/#/g, '%23')}`
    return { url: fileUrl, name: entry.title }
  })

  ipcMain.handle('youtube:get-file-url', (_e, id: string) => {
    const playlist = readYouTubePlaylist()
    const entry = playlist.find(e => e.id === id)
    if (!entry?.fileName) return { error: 'Fișierul nu este disponibil' }
    const filePath = path.join(getYouTubeDir(), entry.fileName)
    if (!fs.existsSync(filePath)) return { error: 'Fișierul nu mai există pe disc' }
    const url = `file://${encodeURI(filePath).replace(/#/g, '%23')}`
    return { url, name: entry.title }
  })

  // Relay video status from projection window to main window
  ipcMain.on('video:status-from-projection', (_e, data) => {
    win?.webContents.send('video:status', data)
  })

  createWindow()
})
