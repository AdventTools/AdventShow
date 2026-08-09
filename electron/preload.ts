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
    hymnsToReview: () => ipcRenderer.invoke('db:hymns-to-review'),
    countToReview: () => ipcRenderer.invoke('db:count-to-review'),
    markReviewed: (id: number) => ipcRenderer.invoke('db:mark-reviewed', id),
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
    setUiZoom: (factor: number) => ipcRenderer.invoke('settings:set-ui-zoom', factor),
  },

  contrib: {
    status: () => ipcRenderer.invoke('contrib:status'),
    // ce s-a hotărât cu propunerile trimise și ce alege omul mai departe
    decisions: () => ipcRenderer.invoke('contrib:decisions'),
    refreshDecisions: () => ipcRenderer.invoke('contrib:refresh-decisions') as Promise<number>,
    resolveDecision: (hash: string, alegere: 'pastrat' | 'revenit' | 'sters') =>
      ipcRenderer.invoke('contrib:resolve-decision', hash, alegere) as
        Promise<{ ok: boolean; error?: string }>,
    // imnuri cu variantă oficială mai nouă, sau cu varianta proprie înlocuită
    hymnStates: () => ipcRenderer.invoke('contrib:hymn-states'),
    applyHymnState: (key: string, alegere: 'adopta-oficial' | 'pastreaza-al-meu' | 'pune-la-loc-al-meu') =>
      ipcRenderer.invoke('contrib:apply-hymn-state', key, alegere) as
        Promise<{ ok: boolean; error?: string }>,
    onDecisions: (cb: (n: number) => void) =>
      ipcRenderer.on('contrib:decisions', (_e, n) => cb(n)),
    offDecisions: () => ipcRenderer.removeAllListeners('contrib:decisions'),
  },

  registry: {
    submit: () => ipcRenderer.invoke('registry:submit'),
    unlockRequest: (phone: string) => ipcRenderer.invoke('registry:unlock-request', phone),
    unlockVerify: (code: string) => ipcRenderer.invoke('registry:unlock-verify', code),
  },

  presentation: {
    pickFile: () => ipcRenderer.invoke('presentation:pick-file'),
    parse: (filePath: string) => ipcRenderer.invoke('presentation:parse', filePath),
    parseHymn: (filePath: string) => ipcRenderer.invoke('import:parse-hymn', filePath),
  },

  templates: {
    list: () => ipcRenderer.invoke('templates:list'),
    load: (file: string) => ipcRenderer.invoke('templates:load', file),
    save: (name: string, data: unknown, file?: string) => ipcRenderer.invoke('templates:save', name, data, file),
    delete: (file: string) => ipcRenderer.invoke('templates:delete', file),
    reorder: (files: string[]) => ipcRenderer.invoke('templates:reorder', files),
    resetBuiltin: (file: string) => ipcRenderer.invoke('templates:reset-builtin', file),
  },

  screen: {
    getDisplays: () => ipcRenderer.invoke('screen:get-displays'),
  },

  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),

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
    sendKeyRequest: (action: 'prev' | 'next' | 'close' | 'zoom-in' | 'zoom-out' | 'zoom-reset') =>
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
    onZoom: (cb: (action: 'zoom-in' | 'zoom-out' | 'zoom-reset') => void) =>
      ipcRenderer.on('projection:zoom', (_e, action) => cb(action)),
    offZoom: () => ipcRenderer.removeAllListeners('projection:zoom'),
    reportZoom: (level: number) => ipcRenderer.invoke('projection:zoom-report', level),
    onZoomLevel: (cb: (level: number) => void) =>
      ipcRenderer.on('projection:zoom-level', (_e, level) => cb(level)),
    offZoomLevel: () => ipcRenderer.removeAllListeners('projection:zoom-level'),
    signalReady: () => ipcRenderer.send('projection:renderer-ready'),
    // Special full-screen modes (timer/clock/free text)
    showTimer: (data: any) => ipcRenderer.invoke('projection:show-timer', data),
    showText: (data: any) => ipcRenderer.invoke('projection:show-text', data),
    updateText: (data: unknown) => ipcRenderer.invoke('projection:update-text', data),
    onTimer: (cb: (data: any) => void) =>
      ipcRenderer.on('projection:timer', (_e, data) => cb(data)),
    offTimer: () => ipcRenderer.removeAllListeners('projection:timer'),
    onText: (cb: (data: any) => void) =>
      ipcRenderer.on('projection:text', (_e, data) => cb(data)),
    offText: () => ipcRenderer.removeAllListeners('projection:text'),
  },

  update: {
    check: () => ipcRenderer.invoke('update:check') as Promise<{ available: boolean; version?: string; isDelta?: boolean }>,
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    openLogFile: () => ipcRenderer.invoke('update:open-log'),
    onProgress: (cb: (data: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) =>
      ipcRenderer.on('update:download-progress', (_e, data) => cb(data)),
    offProgress: () => ipcRenderer.removeAllListeners('update:download-progress'),
    onDownloaded: (cb: (data: { version: string }) => void) =>
      ipcRenderer.on('update:downloaded', (_e, data) => cb(data)),
    offDownloaded: () => ipcRenderer.removeAllListeners('update:downloaded'),
    onError: (cb: (msg: string) => void) =>
      ipcRenderer.on('update:error', (_e, msg) => cb(msg)),
    offError: () => ipcRenderer.removeAllListeners('update:error'),
    // canal: stable (implicit) sau beta
    getChannel: () => ipcRenderer.invoke('update:get-channel') as Promise<'stable' | 'beta'>,
    setChannel: (channel: 'stable' | 'beta') =>
      ipcRenderer.invoke('update:set-channel', channel) as Promise<'stable' | 'beta'>,
    // update obligatoriu — decis în hangar, nu în aplicație
    forcedState: () => ipcRenderer.invoke('update:forced-state') as
      Promise<{ required: boolean; version: string | null; reason: string }>,
    downloadPage: () => ipcRenderer.invoke('update:download-page') as Promise<string>,
    onForced: (cb: (data: { version: string | null; reason: string; notes: string }) => void) =>
      ipcRenderer.on('update:forced', (_e, data) => cb(data)),
    offForced: () => ipcRenderer.removeAllListeners('update:forced'),
    // update obligatoriu descărcat, dar amânat cât timp proiecția e pe ecran
    onForcedWaiting: (cb: (data: { version: string | null }) => void) =>
      ipcRenderer.on('update:forced-waiting', (_e, data) => cb(data)),
    offForcedWaiting: () => ipcRenderer.removeAllListeners('update:forced-waiting'),
  },

  feedback: {
    send: (payload: {
      kind: 'bug' | 'suggestion'
      subject: string
      body: string
      severity?: 'low' | 'medium' | 'high' | 'critical'
      contact?: string
      attachLog?: boolean
    }) => ipcRenderer.invoke('feedback:send', payload) as
      Promise<{ ok: true } | { ok: false; reason: 'rate-limit' | 'refused' | 'offline'; message: string }>,
    pending: () => ipcRenderer.invoke('feedback:pending') as Promise<number>,
    retryPending: () => ipcRenderer.invoke('feedback:retry-pending') as Promise<number>,
    logPreview: () => ipcRenderer.invoke('feedback:log-preview') as Promise<string>,
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
    // Playback error from projection → main window
    sendError: (msg: string) => ipcRenderer.send('video:error-from-projection', msg),
    onError: (cb: (msg: string) => void) =>
      ipcRenderer.on('video:error', (_e, msg) => cb(msg)),
    offError: () => ipcRenderer.removeAllListeners('video:error'),
  },

  ytdlp: {
    isInstalled: () => ipcRenderer.invoke('ytdlp:is-installed') as Promise<boolean>,
    install: () => ipcRenderer.invoke('ytdlp:install') as Promise<{ success: boolean; error?: string }>,
    version: () => ipcRenderer.invoke('ytdlp:version') as Promise<string>,
    health: () => ipcRenderer.invoke('ytdlp:health') as Promise<{ installed: boolean; version: string; staleDays: number }>,
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
