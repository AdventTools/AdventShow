import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  db: {
    getAllHymns: (categoryId?: number) => ipcRenderer.invoke('db:get-all-hymns', categoryId),
    getHymn: (number: string) => ipcRenderer.invoke('db:get-hymn', number),
    searchHymns: (query: string, categoryId?: number) => ipcRenderer.invoke('db:search-hymns', query, categoryId),
    getAllHymnsWithSnippets: (categoryId?: number) => ipcRenderer.invoke('db:get-all-hymns-with-snippets', categoryId),
    searchHymnsContent: (query: string, categoryId?: number) => ipcRenderer.invoke('db:search-hymns-content', query, categoryId),
    getHymnWithSections: (id: number) => ipcRenderer.invoke('db:get-hymn-with-sections', id),
    createHymnWithSections: (payload: {
      number: string;
      title: string;
      categoryId?: number;
      sections: { type: 'strofa' | 'refren'; text: string }[];
    }) => ipcRenderer.invoke('db:create-hymn-with-sections', payload),
    updateHymnWithSections: (id: number, payload: {
      number: string;
      title: string;
      sections: { type: 'strofa' | 'refren'; text: string }[];
    }) => ipcRenderer.invoke('hymn:update-with-sections', id, payload),
    importPresentations: (dirPath: string, categoryId?: number) => ipcRenderer.invoke('db:import-presentations', dirPath, categoryId),
    importPresentationFiles: (filePaths: string[], categoryId?: number) => ipcRenderer.invoke('db:import-presentation-files', filePaths, categoryId),
    clearAll: () => ipcRenderer.invoke('db:clear-all'),
    getCategories: () => ipcRenderer.invoke('db:get-categories'),
    createCategory: (name: string) => ipcRenderer.invoke('db:create-category', name),
    updateCategory: (id: number, name: string) => ipcRenderer.invoke('db:update-category', id, name),
    deleteCategory: (id: number) => ipcRenderer.invoke('db:delete-category', id),
    exportDb: (destPath: string) => ipcRenderer.invoke('db:export', destPath),
    exportJsonBackup: (destPath: string) => ipcRenderer.invoke('db:export-json-backup', destPath),
    importJsonBackup: (filePath: string) => ipcRenderer.invoke('db:import-json-backup', filePath),
  },

  hymn: {
    update: (id: number, number: string, title: string) =>
      ipcRenderer.invoke('hymn:update', id, number, title),
    setCategory: (id: number, categoryId?: number) =>
      ipcRenderer.invoke('hymn:set-category', id, categoryId),
    delete: (id: number) => ipcRenderer.invoke('hymn:delete', id),
  },

  section: {
    add: (hymnId: number, type: 'strofa' | 'refren', text: string) =>
      ipcRenderer.invoke('section:add', hymnId, type, text),
    update: (id: number, type: 'strofa' | 'refren', text: string) =>
      ipcRenderer.invoke('section:update', id, type, text),
    delete: (id: number) => ipcRenderer.invoke('section:delete', id),
    reorder: (sections: { id: number; order_index: number }[]) =>
      ipcRenderer.invoke('section:reorder', sections),
  },

  dialog: {
    selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
    selectPresentationFiles: () => ipcRenderer.invoke('dialog:select-presentation-files'),
    saveFile: (defaultName: string) => ipcRenderer.invoke('dialog:save-file', defaultName),
    saveJsonFile: (defaultName: string) => ipcRenderer.invoke('dialog:save-json-file', defaultName),
    selectJsonFile: () => ipcRenderer.invoke('dialog:select-json-file'),
    pickMedia: (mediaType: 'image' | 'video') => ipcRenderer.invoke('dialog:pick-media', mediaType),
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),
  },

  screen: {
    getDisplays: () => ipcRenderer.invoke('screen:get-displays'),
  },

  bible: {
    getBooks: () => ipcRenderer.invoke('bible:get-books'),
    getChapters: (bookId: number) => ipcRenderer.invoke('bible:get-chapters', bookId),
    getVerses: (bookId: number, chapter: number) =>
      ipcRenderer.invoke('bible:get-verses', bookId, chapter),
    search: (query: string, bookId?: number, chapter?: number) =>
      ipcRenderer.invoke('bible:search', query, bookId, chapter),
    getVerseRange: (bookId: number, chapter: number, startVerse: number, endVerse: number) =>
      ipcRenderer.invoke('bible:get-verse-range', bookId, chapter, startVerse, endVerse),
    hasData: () => ipcRenderer.invoke('bible:has-data'),
  },

  projection: {
    open: (sections: any[], hymnTitle: string, hymnNumber: string, startIndex?: number, contentType?: string, bibleRef?: string) =>
      ipcRenderer.invoke('projection:open', sections, hymnTitle, hymnNumber, startIndex, contentType, bibleRef),
    navigate: (sections: any[], index: number, hymnTitle: string, hymnNumber: string, contentType?: string, bibleRef?: string) =>
      ipcRenderer.invoke('projection:navigate', sections, index, hymnTitle, hymnNumber, contentType, bibleRef),
    updateHymn: (sections: any[], hymnTitle: string, hymnNumber: string, startIndex?: number, contentType?: string, bibleRef?: string) =>
      ipcRenderer.invoke('projection:update-hymn', sections, hymnTitle, hymnNumber, startIndex, contentType, bibleRef),
    close: () => ipcRenderer.invoke('projection:close'),
    sendKeyRequest: (action: 'prev' | 'next' | 'close') =>
      ipcRenderer.invoke('projection:key-request', action),
    onSlide: (cb: (data: any) => void) =>
      ipcRenderer.on('projection:slide', (_e, data) => cb(data)),
    offSlide: () => ipcRenderer.removeAllListeners('projection:slide'),
    onControllerSync: (cb: (data: { currentIndex: number }) => void) =>
      ipcRenderer.on('projection:controller-sync', (_e, data) => cb(data)),
    offControllerSync: () => ipcRenderer.removeAllListeners('projection:controller-sync'),
    onClosed: (cb: () => void) =>
      ipcRenderer.on('projection:closed', () => cb()),
    offClosed: () => ipcRenderer.removeAllListeners('projection:closed'),
    signalReady: () => ipcRenderer.send('projection:renderer-ready'),
  },

  update: {
    check: () => ipcRenderer.invoke('update:check') as Promise<{ available: boolean; version?: string; isDelta?: boolean }>,
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onProgress: (cb: (data: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) =>
      ipcRenderer.on('update:download-progress', (_e, data) => cb(data)),
    offProgress: () => ipcRenderer.removeAllListeners('update:download-progress'),
    onDownloaded: (cb: (data: { version: string }) => void) =>
      ipcRenderer.on('update:downloaded', (_e, data) => cb(data)),
    offDownloaded: () => ipcRenderer.removeAllListeners('update:downloaded'),
    onError: (cb: (msg: string) => void) =>
      ipcRenderer.on('update:error', (_e, msg) => cb(msg)),
    offError: () => ipcRenderer.removeAllListeners('update:error'),
  },

  video: {
    pickFile: () => ipcRenderer.invoke('video:pick-file') as Promise<string | undefined>,
    prepare: (filePath: string) => ipcRenderer.invoke('video:prepare', filePath) as Promise<{ url?: string; name?: string; converted?: boolean; error?: string }>,
    startPlayback: (url: string, name: string) => ipcRenderer.invoke('video:start-playback', url, name),
    load: (filePath: string) => ipcRenderer.invoke('video:load', filePath) as Promise<{ url?: string; name?: string; converted?: boolean; error?: string }>,
    play: () => ipcRenderer.invoke('video:play'),
    pause: () => ipcRenderer.invoke('video:pause'),
    stop: () => ipcRenderer.invoke('video:stop'),
    seek: (time: number) => ipcRenderer.invoke('video:seek', time),
    volume: (vol: number) => ipcRenderer.invoke('video:volume', vol),
    loadUrl: (url: string) => ipcRenderer.invoke('video:load-url', url) as Promise<{ url: string; name: string }>,
    // Events from projection → main → renderer
    onStatus: (cb: (data: { currentTime: number; duration: number; paused: boolean }) => void) =>
      ipcRenderer.on('video:status', (_e, data) => cb(data)),
    offStatus: () => ipcRenderer.removeAllListeners('video:status'),
    // Events from projection window
    onLoad: (cb: (url: string, name: string) => void) =>
      ipcRenderer.on('video:load', (_e, url, name) => cb(url, name)),
    offLoad: () => ipcRenderer.removeAllListeners('video:load'),
    onPlay: (cb: () => void) => ipcRenderer.on('video:play', () => cb()),
    offPlay: () => ipcRenderer.removeAllListeners('video:play'),
    onPause: (cb: () => void) => ipcRenderer.on('video:pause', () => cb()),
    offPause: () => ipcRenderer.removeAllListeners('video:pause'),
    onStop: (cb: () => void) => ipcRenderer.on('video:stop', () => cb()),
    offStop: () => ipcRenderer.removeAllListeners('video:stop'),
    onSeek: (cb: (time: number) => void) => ipcRenderer.on('video:seek', (_e, time) => cb(time)),
    offSeek: () => ipcRenderer.removeAllListeners('video:seek'),
    onVolume: (cb: (vol: number) => void) => ipcRenderer.on('video:volume', (_e, vol) => cb(vol)),
    offVolume: () => ipcRenderer.removeAllListeners('video:volume'),
    onConverting: (cb: (converting: boolean) => void) => ipcRenderer.on('video:converting', (_e, v) => cb(v)),
    offConverting: () => ipcRenderer.removeAllListeners('video:converting'),
    onConvertProgress: (cb: (line: string) => void) => ipcRenderer.on('video:convert-progress', (_e, line) => cb(line)),
    offConvertProgress: () => ipcRenderer.removeAllListeners('video:convert-progress'),
    // Send status back from projection
    sendStatus: (data: { currentTime: number; duration: number; paused: boolean }) =>
      ipcRenderer.send('video:status-from-projection', data),
  },

  ytdlp: {
    isInstalled: () => ipcRenderer.invoke('ytdlp:is-installed') as Promise<boolean>,
    install: () => ipcRenderer.invoke('ytdlp:install') as Promise<{ success: boolean; error?: string }>,
    version: () => ipcRenderer.invoke('ytdlp:version') as Promise<string>,
    update: () => ipcRenderer.invoke('ytdlp:update') as Promise<{ success: boolean; version?: string; error?: string }>,
    getStreamUrl: (videoUrl: string) => ipcRenderer.invoke('ytdlp:get-stream-url', videoUrl) as Promise<{ url: string; error?: string }>,
  },

  youtube: {
    getPlaylist: () => ipcRenderer.invoke('youtube:get-playlist'),
    add: (url: string, title?: string) => ipcRenderer.invoke('youtube:add', url, title),
    updateTitle: (id: string, title: string) => ipcRenderer.invoke('youtube:update-title', id, title),
    remove: (id: string) => ipcRenderer.invoke('youtube:remove', id),
    delete: (id: string) => ipcRenderer.invoke('youtube:delete', id),
    reorder: (orderedIds: string[]) => ipcRenderer.invoke('youtube:reorder', orderedIds),
    retryDownload: (id: string) => ipcRenderer.invoke('youtube:retry-download', id),
    getFileUrl: (id: string) => ipcRenderer.invoke('youtube:get-file-url', id),
    onProgress: (cb: (id: string, percent: number, line: string) => void) =>
      ipcRenderer.on('youtube:progress', (_e, id, percent, line) => cb(id, percent, line)),
    offProgress: () => ipcRenderer.removeAllListeners('youtube:progress'),
    onStatus: (cb: (id: string, status: string, error: string) => void) =>
      ipcRenderer.on('youtube:status', (_e, id, status, error) => cb(id, status, error)),
    offStatus: () => ipcRenderer.removeAllListeners('youtube:status'),
  },

  playlist: {
    addLocal: (url: string, name: string) => ipcRenderer.invoke('playlist:add-local', url, name),
    getFileUrl: (id: string) => ipcRenderer.invoke('playlist:get-file-url', id),
    getFilePath: (id: string) => ipcRenderer.invoke('playlist:get-file-path', id) as Promise<string | null>,
    revealInFolder: (filePath: string) => ipcRenderer.invoke('playlist:reveal-in-folder', filePath),
    getDownloadFolder: () => ipcRenderer.invoke('youtube:get-download-folder') as Promise<string>,
  },
})
