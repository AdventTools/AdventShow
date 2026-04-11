import { app, BrowserWindow, dialog, ipcMain, net, powerSaveBlocker, protocol, screen, shell } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
  windowBounds?: { x: number; y: number; width: number; height: number }
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

// ── GitHub Update Checker ─────────────────────────────────────────────────────

const GITHUB_REPO = 'AdventTools/AdventShow'
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

interface UpdateInfo {
  available: boolean
  version?: string
  changelog?: string
  downloadUrl?: string
}

function compareVersions(local: string, remote: string): number {
  const a = local.replace(/^v/, '').split('.').map(Number)
  const b = remote.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((b[i] ?? 0) > (a[i] ?? 0)) return 1
    if ((b[i] ?? 0) < (a[i] ?? 0)) return -1
  }
  return 0
}

function getPlatformAssetPattern(): RegExp {
  switch (process.platform) {
    case 'win32': return /-Setup\.exe$/i
    case 'darwin': return /\.dmg$/i
    case 'linux': return /\.AppImage$/i
    default: return /\.AppImage$/i
  }
}

async function checkForUpdate(): Promise<UpdateInfo> {
  try {
    const response = await net.fetch(GITHUB_API_URL, {
      headers: { 'User-Agent': 'AdventShow-Updater' }
    })
    if (!response.ok) {
      console.warn(`[Update] GitHub API returned ${response.status}`)
      return { available: false }
    }
    const data = await response.json() as {
      tag_name: string
      body?: string
      assets?: { name: string; browser_download_url: string }[]
    }

    const remoteVersion = data.tag_name ?? ''
    const localVersion = app.getVersion()

    if (compareVersions(localVersion, remoteVersion) <= 0) {
      return { available: false }
    }

    const pattern = getPlatformAssetPattern()
    const asset = data.assets?.find(a => pattern.test(a.name))

    return {
      available: true,
      version: remoteVersion,
      changelog: data.body ?? '',
      downloadUrl: asset?.browser_download_url ?? `https://github.com/${GITHUB_REPO}/releases/latest`,
    }
  } catch (err) {
    console.warn('[Update] Check failed:', err)
    return { available: false }
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
      resolve({ url: '', error: 'yt-dlp nu este instalat. Instalează-l din Setări.' })
      return
    }
    const args = [
      '--get-url',
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--no-playlist',
      videoUrl,
    ]
    execFile(getYtDlpPath(), args, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[yt-dlp] Stream URL failed:', stderr || err.message)
        resolve({
          url: '',
          error: 'Nu s-a putut obține video-ul. YouTube poate bloca temporar această funcție. Încearcă din nou mai târziu sau descarcă video-ul manual.',
        })
        return
      }
      // yt-dlp may return multiple URLs (video + audio) on separate lines; take the first
      const urls = stdout.trim().split('\n').filter(Boolean)
      resolve({ url: urls[0] ?? '' })
    })
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

function sendSlideToProjection(index: number) {
  if (!projState || !projectionWin) return
  projState.currentIndex = index
  projectionWin.webContents.send('projection:slide', {
    sections: projState.sections,
    currentIndex: index,
    hymnTitle: projState.hymnTitle,
    hymnNumber: projState.hymnNumber,
    contentType: projState.contentType,
    bibleRef: projState.bibleRef,
  })
  win?.webContents.send('projection:controller-sync', { currentIndex: index })
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

  projectionWin = new BrowserWindow({
    x, y, width, height,
    fullscreen: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    alwaysOnTop: targetDisplay.id === primary.id,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      // Allow file:// access for background images/videos
      webSecurity: false,
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
    win?.webContents.send('projection:closed')
  })

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
  // Prevent system sleep / screensaver / hibernate while the app is running
  startPowerSaveBlocker()

  // Serve local files via localfile:///abs/path
  // Forward ALL request headers (including Range) so video streaming works.
  protocol.handle('localfile', (request) => {
    const raw = request.url.slice('localfile://'.length)
    const filePath = decodeURIComponent(raw.startsWith('/') ? raw : '/' + raw)
    return net.fetch(`file://${filePath}`, {
      headers: Object.fromEntries(request.headers.entries()),
    })
  })

  copySeedDbIfNeeded()
  initDB()
  seedBibleFromJson()

  // ── Settings ──────────────────────────────────────────────────────────────
  ipcMain.handle('settings:get', () => readSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
    writeSettings({ ...readSettings(), ...patch })
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
  ipcMain.handle('db:get-hymn-with-sections', (_e, id: number) => getHymnWithSections(id))
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

  ipcMain.handle('projection:open', (_e, sections: any[], hymnTitle: string, hymnNumber: string, startIndex?: number, contentType?: string, bibleRef?: string) => {
    const idx = typeof startIndex === 'number' ? startIndex : 0
    projState = { sections, currentIndex: idx, hymnTitle, hymnNumber, contentType: contentType as any, bibleRef }
    if (projectionWin) {
      projectionWin.focus()
    } else {
      createProjectionWindow()
    }
    const sendInitial = () => sendSlideToProjection(idx)
    if (projectionWin?.webContents.isLoading()) {
      projectionWin.webContents.once('did-finish-load', sendInitial)
    } else {
      setTimeout(sendInitial, 300)
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

  ipcMain.handle('projection:key-request', (_e, action: 'prev' | 'next' | 'close') => {
    if (action === 'close') { projectionWin?.close(); return }
    if (!projState) return
    const minIndex = projState.contentType === 'bible' ? 0 : -1  // Bible has no title slide
    const newIndex = action === 'next'
      ? Math.min(projState.currentIndex + 1, projState.sections.length - 1)
      : Math.max(projState.currentIndex - 1, minIndex)
    sendSlideToProjection(newIndex)
  })

  ipcMain.handle('projection:close', () => {
    projectionWin?.close()
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

  // ── Update ──────────────────────────────────────────────────────────────────
  ipcMain.handle('update:check', () => checkForUpdate())
  ipcMain.handle('update:open-download', async (_e, url: string) => {
    if (url) await shell.openExternal(url)
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

  ipcMain.handle('video:load', async (_e, filePath: string) => {
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
    const videoUrl = `localfile://${servePath.replace(/#/g, '%23')}`
    projectionWin?.webContents.send('video:load', videoUrl, path.basename(filePath))
    return { url: videoUrl, name: path.basename(filePath), converted }
  })

  ipcMain.handle('video:play', () => projectionWin?.webContents.send('video:play'))
  ipcMain.handle('video:pause', () => projectionWin?.webContents.send('video:pause'))
  ipcMain.handle('video:stop', () => projectionWin?.webContents.send('video:stop'))
  ipcMain.handle('video:seek', (_e, time: number) => projectionWin?.webContents.send('video:seek', time))
  ipcMain.handle('video:volume', (_e, vol: number) => projectionWin?.webContents.send('video:volume', vol))

  ipcMain.handle('video:load-url', (_e, url: string) => {
    projectionWin?.webContents.send('video:load', url, 'YouTube')
    return { url, name: 'YouTube' }
  })

  // ── yt-dlp ──────────────────────────────────────────────────────────────────
  ipcMain.handle('ytdlp:is-installed', () => isYtDlpInstalled())
  ipcMain.handle('ytdlp:install', () => downloadYtDlp())
  ipcMain.handle('ytdlp:version', () => getYtDlpVersion())
  ipcMain.handle('ytdlp:update', () => updateYtDlp())
  ipcMain.handle('ytdlp:get-stream-url', async (_e, videoUrl: string) => {
    if (!isYtDlpInstalled()) {
      const dl = await downloadYtDlp()
      if (!dl.success) return { url: '', error: 'Nu s-a putut instala yt-dlp: ' + (dl.error ?? '') }
    }
    return getYouTubeStreamUrl(videoUrl)
  })

  // Relay video status from projection window to main window
  ipcMain.on('video:status-from-projection', (_e, data) => {
    win?.webContents.send('video:status', data)
  })

  createWindow()
})
