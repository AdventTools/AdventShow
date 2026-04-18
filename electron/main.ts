import { app, BrowserWindow, dialog, ipcMain, net, powerSaveBlocker, protocol, screen, shell } from 'electron'
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
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

// ── Delta Update System ───────────────────────────────────────────────────────
// Downloads only app.asar (~2MB) instead of the full Electron bundle (~150MB).
// Falls back to full update only when the Electron version changes.
// Works on all platforms without code signing issues because the Electron
// framework stays untouched — only the app code is replaced.

const GITHUB_OWNER = 'AdventTools'
const GITHUB_REPO = 'AdventShow'

interface UpdateState {
  latestVersion: string | null
  downloadedInstallerPath: string | null
}

const updateState: UpdateState = {
  latestVersion: null,
  downloadedInstallerPath: null,
}

// Fetch JSON from GitHub API or raw URL
function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'User-Agent': 'AdventShow-Updater', Accept: 'application/json' },
    }, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchJson<T>(res.headers.location).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data) as T) }
        catch (e) { reject(e) }
      })
    })
    request.on('error', reject)
    request.setTimeout(15000, () => { request.destroy(); reject(new Error('Timeout')) })
  })
}

// Download a file from URL with progress reporting
function downloadFile(url: string, dest: string, onProgress?: (percent: number, transferred: number, total: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'User-Agent': 'AdventShow-Updater', Accept: 'application/octet-stream' },
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFile(res.headers.location, dest, onProgress).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      const total = parseInt(res.headers['content-length'] || '0', 10)
      let transferred = 0
      const file = fs.createWriteStream(dest)
      res.on('data', (chunk: Buffer) => {
        transferred += chunk.length
        if (onProgress && total > 0) {
          onProgress(Math.round((transferred / total) * 100), transferred, total)
        }
      })
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
      file.on('error', (err) => { try { fs.unlinkSync(dest) } catch { /* ignore — fișierul poate că nici nu a fost creat */ }; reject(err) })
    })
    request.on('error', reject)
    request.setTimeout(120000, () => { request.destroy(); reject(new Error('Download timeout')) })
  })
}

// Check for updates by fetching the latest GitHub release
async function checkForUpdate(): Promise<{ available: boolean; version?: string }> {
  try {
    const releaseUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
    const release = await fetchJson<{ tag_name: string }>(releaseUrl)
    const latestVersion = release.tag_name.replace(/^v/, '')
    const current = app.getVersion()

    if (latestVersion === current) {
      debugLog(`[Update] Already up to date: ${current}`)
      return { available: false }
    }

    // Simple semver comparison: only update if latest > current
    const cmp = (a: string, b: string) => {
      const pa = a.split('.').map(Number), pb = b.split('.').map(Number)
      for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0) }
      return 0
    }
    if (cmp(latestVersion, current) <= 0) {
      debugLog(`[Update] Current ${current} >= latest ${latestVersion}, no update`)
      return { available: false }
    }

    updateState.latestVersion = latestVersion
    debugLog(`[Update] Update available: ${current} → ${latestVersion}`)
    return { available: true, version: latestVersion }
  } catch (err: any) {
    debugLog('[Update] Check failed:', err.message)
    return { available: false }
  }
}

function getInstallerAssetName(): string {
  switch (process.platform) {
    case 'darwin': return `AdventShow-Mac-${updateState.latestVersion}.dmg`
    case 'win32': return 'AdventShow-Setup.exe'
    case 'linux': return 'AdventShow-Linux.AppImage'
    default: return 'AdventShow-Linux.AppImage'
  }
}

// Download the full installer from the latest release
async function downloadUpdate(): Promise<void> {
  if (!updateState.latestVersion) throw new Error('No update available')

  const releaseUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
  const release = await fetchJson<{ assets: { name: string; browser_download_url: string }[] }>(releaseUrl)

  const assetName = getInstallerAssetName()
  const asset = release.assets.find(a => a.name === assetName)
  if (!asset) throw new Error(`Asset ${assetName} not found in release`)

  const tempDir = path.join(app.getPath('temp'), `adventshow-update-${Date.now()}`)
  fs.mkdirSync(tempDir, { recursive: true })
  const destFile = path.join(tempDir, assetName)

  debugLog(`[Update] Downloading ${assetName}...`)

  await downloadFile(asset.browser_download_url, destFile, (percent, transferred, total) => {
    if (isWinAlive(win)) win.webContents.send('update:download-progress', {
      percent,
      bytesPerSecond: 0,
      transferred,
      total,
    })
  })

  updateState.downloadedInstallerPath = destFile
  debugLog(`[Update] Downloaded to ${destFile}`)
  if (isWinAlive(win)) win.webContents.send('update:downloaded', { version: updateState.latestVersion })
}

// Install update: run the installer and quit
async function installUpdate(): Promise<void> {
  if (!updateState.downloadedInstallerPath || !fs.existsSync(updateState.downloadedInstallerPath)) {
    throw new Error('Downloaded installer not found')
  }

  const installer = updateState.downloadedInstallerPath
  debugLog(`[Update] Installing: ${installer}`)

  if (process.platform === 'win32') {
    // Run NSIS installer silently — it handles closing the running app
    spawn(installer, ['/S'], { detached: true, stdio: 'ignore' }).unref()
    app.quit()
  } else if (process.platform === 'darwin') {
    // Open the DMG — user drags app to Applications
    shell.openPath(installer)
    app.quit()
  } else {
    // Linux: replace the AppImage
    const currentPath = process.env.APPIMAGE
    if (currentPath) {
      const tempDir = path.dirname(installer)
      const script = path.join(tempDir, 'update.sh')
      fs.writeFileSync(script, [
        '#!/bin/bash',
        'sleep 2',
        `cp -f "${installer}" "${currentPath}"`,
        `chmod +x "${currentPath}"`,
        `"${currentPath}" &`,
        `rm -rf "${tempDir}"`,
      ].join('\n'), { mode: 0o755 })
      spawn('bash', [script], { detached: true, stdio: 'ignore' }).unref()
      app.quit()
    } else {
      // Not running as AppImage — just open the downloaded file
      shell.openPath(installer)
    }
  }
}

// ── Video conversion (FFmpeg) ─────────────────────────────────────────────────

function getFFmpegPath(): string {
  try {
    // ffmpeg-static provides the binary path
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ffmpegStatic = require('ffmpeg-static') as string
    // In packaged app, fix the path
    if (app.isPackaged && ffmpegStatic.includes('app.asar')) {
      return ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
    }
    return ffmpegStatic
  } catch {
    return 'ffmpeg' // fallback to system ffmpeg
  }
}

const NATIVE_VIDEO_EXTS = new Set(['.mp4', '.webm', '.ogg', '.mov'])

function needsConversion(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return !NATIVE_VIDEO_EXTS.has(ext)
}

function convertToMp4(inputPath: string): Promise<{ outputPath: string }> {
  const outputPath = path.join(app.getPath('temp'), `adventshow-converted-${Date.now()}.mp4`)
  const ffmpeg = getFFmpegPath()

  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      '-y', outputPath
    ]
    const proc = execFile(ffmpeg, args, { timeout: 300000 }, (err) => {
      if (err) {
        console.error('[FFmpeg] Conversion failed:', err)
        reject(new Error('Conversia video a eșuat'))
      } else {
        console.log('[FFmpeg] Converted:', inputPath, '->', outputPath)
        resolve({ outputPath })
      }
    })
    proc.stderr?.on('data', (d: Buffer) => {
      const line = d.toString()
      // Send progress to renderer if it contains time info
      if (line.includes('time=') && win) {
        win.webContents.send('video:convert-progress', line.trim())
      }
    })
  })
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

function startYouTubeDownload(entry: YouTubeEntry) {
  ensureYouTubeDir()
  const ytdlpBin = getYtDlpPath()
  const outputTemplate = path.join(getYouTubeDir(), `${entry.id}.%(ext)s`)
  const args = [
    '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '--merge-output-format', 'mp4',
    '-o', outputTemplate,
    '--newline',
    '--no-playlist',
    entry.url,
  ]
  debugLog('[yt-dlp-download] Starting:', ytdlpBin, args.join(' '))

  const proc = spawn(ytdlpBin, args)

  const onData = (data: Buffer) => {
    const line = data.toString().trim()
    debugLog('[yt-dlp-download] output:', line)
    // Parse progress lines: [download]  45.2% of ~123.45MiB ...
    if (line.includes('%')) {
      const match = line.match(/([\d.]+)%/)
      if (match) {
        win?.webContents.send('youtube:progress', entry.id, parseFloat(match[1]), line)
      }
    }
  }

  proc.stdout.on('data', onData)
  proc.stderr.on('data', onData)

  proc.on('close', (code) => {
    debugLog('[yt-dlp-download] Process exited with code:', code)
    const playlist = readYouTubePlaylist()
    const idx = playlist.findIndex(e => e.id === entry.id)
    if (idx === -1) return

    if (code === 0) {
      // Find the downloaded file — prefer merged .mp4 over intermediate fragments
      const files = fs.readdirSync(getYouTubeDir()).filter(f => f.startsWith(entry.id + '.'))
      debugLog('[yt-dlp-download] Downloaded files:', files)
      // Priority: exact id.mp4 (merged) > .mp4 > .webm > .mkv > anything not audio-only
      const audioOnly = ['.m4a', '.opus', '.ogg', '.aac', '.mp3']
      const downloadedFile =
        files.find(f => f === entry.id + '.mp4') ||
        files.find(f => f.endsWith('.mp4') && !f.includes('.f')) ||
        files.find(f => f.endsWith('.mp4')) ||
        files.find(f => f.endsWith('.webm') || f.endsWith('.mkv')) ||
        files.find(f => !audioOnly.some(ext => f.endsWith(ext))) ||
        files[0]
      if (downloadedFile) {
        playlist[idx].fileName = downloadedFile
        playlist[idx].status = 'ready'
        playlist[idx].error = undefined
      } else {
        playlist[idx].status = 'error'
        playlist[idx].error = 'Fișierul descărcat nu a fost găsit'
      }
    } else {
      playlist[idx].status = 'error'
      playlist[idx].error = `yt-dlp a returnat codul ${code}`
    }
    writeYouTubePlaylist(playlist)
    win?.webContents.send('youtube:status', entry.id, playlist[idx].status, playlist[idx].error ?? '')
  })

  proc.on('error', (err) => {
    debugLog('[yt-dlp-download] spawn error:', err.message)
    const playlist = readYouTubePlaylist()
    const idx = playlist.findIndex(e => e.id === entry.id)
    if (idx !== -1) {
      playlist[idx].status = 'error'
      playlist[idx].error = err.message
      writeYouTubePlaylist(playlist)
      win?.webContents.send('youtube:status', entry.id, 'error', err.message)
    }
  })
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
  seedBibleFromJson()

  // Sync corrections from seed DB to user DB (e.g., fixed hymns)
  const seedPaths = [
    path.join(process.resourcesPath ?? '', 'hymns.db'),
    path.join(process.env.APP_ROOT!, 'public', 'hymns.db'),
  ]
  for (const sp of seedPaths) {
    if (fs.existsSync(sp)) { syncSeedCorrections(sp); break }
  }

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
      ? [{ name: 'Imagini', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'] }]
      : [{ name: 'Videoclipuri', extensions: ['mp4', 'webm', 'mov', 'mkv', 'avi'] }]
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

  // ── Update (Delta) ──────────────────────────────────────────────────────────
  ipcMain.handle('update:check', async () => {
    try {
      const result = await checkForUpdate()
      debugLog(`[Update] check: ${JSON.stringify(result)}`)
      return result
    } catch {
      return { available: false }
    }
  })
  ipcMain.handle('update:download', async () => {
    try {
      await downloadUpdate()
    } catch (err: any) {
      debugLog('[Update] Download error:', err.message)
      if (isWinAlive(win)) win.webContents.send('update:error', err.message)
    }
  })
  ipcMain.handle('update:install', async () => {
    try {
      await installUpdate()
    } catch (err: any) {
      debugLog('[Update] Install error:', err.message)
      if (isWinAlive(win)) win.webContents.send('update:error', err.message)
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
      filters: [{ name: 'Videoclipuri', extensions: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'ogg'] }],
    })
    if (result.canceled) return undefined
    return result.filePaths[0]
  })

  // Prepare video (convert if needed) without opening projection
  ipcMain.handle('video:prepare', async (_e, filePath: string) => {
    debugLog('[video:prepare] Preparing file:', filePath)
    let servePath = filePath
    let converted = false
    if (needsConversion(filePath)) {
      try {
        debugLog('[video:prepare] Needs conversion, starting FFmpeg...')
        win?.webContents.send('video:converting', true)
        const result = await convertToMp4(filePath)
        servePath = result.outputPath
        converted = true
        debugLog('[video:prepare] Conversion done:', servePath)
      } catch (err: any) {
        debugLog('[video:prepare] Conversion failed:', err.message)
        win?.webContents.send('video:converting', false)
        return { error: err.message ?? 'Conversia video a eșuat' }
      } finally {
        win?.webContents.send('video:converting', false)
      }
    }
    const videoUrl = pathToFileURL(servePath).href
    debugLog('[video:prepare] Prepared URL:', videoUrl)
    return { url: videoUrl, name: path.basename(filePath), converted }
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
    if (needsConversion(filePath)) {
      try {
        win?.webContents.send('video:converting', true)
        const result = await convertToMp4(filePath)
        servePath = result.outputPath
        converted = true
      } catch (err: any) {
        win?.webContents.send('video:converting', false)
        return { error: err.message ?? 'Conversia video a eșuat' }
      } finally {
        win?.webContents.send('video:converting', false)
      }
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
