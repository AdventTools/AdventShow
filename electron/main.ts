import { app, BrowserWindow, dialog, ipcMain, net, protocol, screen } from 'electron'
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
  getCategories,
  getHymnByNumber,
  getHymnWithSections,
  importJsonBackup,
  initDB,
  reorderSections,
  searchHymns,
  updateCategory,
  updateHymn,
  updateHymnCategory,
  updateSection,
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

// ── Projection state ──────────────────────────────────────────────────────────

interface ProjState {
  sections: any[]
  currentIndex: number
  hymnTitle: string
  hymnNumber: string
}
let projState: ProjState | null = null

function sendSlideToProjection(index: number) {
  if (!projState || !projectionWin) return
  projState.currentIndex = index
  projectionWin.webContents.send('projection:slide', {
    sections: projState.sections,
    currentIndex: index,
    hymnTitle: projState.hymnTitle,
    hymnNumber: projState.hymnNumber,
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
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

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
  if (fs.existsSync(userDbPath)) return
  const seedPaths = [
    path.join(process.resourcesPath ?? '', 'hymns.db'),
    path.join(process.env.APP_ROOT!, 'public', 'hymns.db'),
  ]
  for (const seedPath of seedPaths) {
    if (fs.existsSync(seedPath)) { fs.copyFileSync(seedPath, userDbPath); return }
  }
}

app.on('window-all-closed', () => {
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

  ipcMain.handle('projection:open', (_e, sections: any[], hymnTitle: string, hymnNumber: string) => {
    projState = { sections, currentIndex: -1, hymnTitle, hymnNumber }
    if (projectionWin) {
      projectionWin.focus()
    } else {
      createProjectionWindow()
    }
    const sendInitial = () => sendSlideToProjection(-1)
    if (projectionWin?.webContents.isLoading()) {
      projectionWin.webContents.once('did-finish-load', sendInitial)
    } else {
      setTimeout(sendInitial, 300)
    }
  })

  ipcMain.handle('projection:navigate', (_e, _sections: any[], index: number) => {
    if (!projState) return
    const clamped = Math.max(0, Math.min(index, projState.sections.length - 1))
    sendSlideToProjection(clamped)
  })

  ipcMain.handle('projection:key-request', (_e, action: 'prev' | 'next' | 'close') => {
    if (action === 'close') { projectionWin?.close(); return }
    if (!projState) return
    const newIndex = action === 'next'
      ? Math.min(projState.currentIndex + 1, projState.sections.length - 1)
      : Math.max(projState.currentIndex - 1, -1)   // -1 = title slide
    sendSlideToProjection(newIndex)
  })

  ipcMain.handle('projection:close', () => {
    projectionWin?.close()
    projectionWin = null
    projState = null
  })

  createWindow()
})
